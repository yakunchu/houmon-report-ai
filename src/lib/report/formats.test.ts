import { describe, expect, it } from "vitest";
import yamamotoProfile from "../../../fixtures/yamamoto-hanako/profile.json";
import { unmaskText } from "../mask";
import type { MaskToken } from "../mask";
import { REPORT_ORDER } from "./fields";
import {
  anonymizePatientTokens,
  buildChat,
  buildEmail,
  buildPrintModel,
  CHAT_MAX_CHARS,
  EMAIL_BODY_TARGET,
  FAMILY_FALLBACK,
  firstSentence,
  isRequestNote,
  lastSentence,
  politeForEmail,
  mapPrintModelText,
  normalizeContactNotes,
  pharmacyNameOf,
  PRINT_NOTICE,
  PRINT_PAGES_TEXT,
  staffNameOf,
  splitSentences,
  truncateText,
  URGENT_NOTICE,
  type FormatArgs,
} from "./formats";
import { SAMPLE_PHARMACY_CONTACT, sampleFormatArgs } from "./sample-args";
import type { ReportDraft } from "./schema";

// すべて架空のデータ（fixtures/ の見本。sample-args.ts が組む）。
const CONTACT = SAMPLE_PHARMACY_CONTACT;

/**
 * 既定では連絡事項（contactNotes）を渡さず、従来どおり P の文から組む場合を調べる。
 * 渡す場合は over で contactNotes を指定する。
 */
function argsOf(who: "yamamoto" | "sasaki", over: Partial<FormatArgs> = {}): FormatArgs {
  const base = sampleFormatArgs(who === "yamamoto" ? "yamamoto-hanako" : "sasaki-kiyoshi");
  return { ...base, includePatientName: false, contactNotes: undefined, ...over };
}

describe("文の切り出し", () => {
  it("「。」で区切り、最初と最後の文を取る", () => {
    expect(firstSentence("A。B。C。")).toBe("A。");
    expect(lastSentence("A。B。C。")).toBe("C。");
  });
  it("文が 1 つなら最初も最後も同じ。空なら「—」", () => {
    expect(firstSentence("Aだけ。")).toBe(lastSentence("Aだけ。"));
    expect(firstSentence("")).toBe("—");
    expect(lastSentence("  ")).toBe("—");
  });
  it("「」の中の「。」では切らない", () => {
    expect(splitSentences("本人は「飲めた。大丈夫」と話した。次回確認する。")).toEqual([
      "本人は「飲めた。大丈夫」と話した。",
      "次回確認する。",
    ]);
  });
});

describe("truncateText", () => {
  it("収まるならそのまま、超えたら末尾を「…」にして max 文字にする", () => {
    expect(truncateText("あいうえお", 5)).toBe("あいうえお");
    expect(truncateText("あいうえおか", 5)).toBe("あいうえ…");
    expect(Array.from(truncateText("あ".repeat(50), 10)).length).toBe(10);
  });
});

const noNewline = (s: string): string => s.replace(/\n/g, "");

describe("メール", () => {
  it("件名は「【居宅療養管理指導報告】M月D日 訪問分（薬局名）」で、患者名を含まない", () => {
    for (const who of ["yamamoto", "sasaki"] as const) {
      for (const includePatientName of [false, true]) {
        const a = argsOf(who, { includePatientName });
        const { subject } = buildEmail(a);
        expect(subject).toMatch(/^【居宅療養管理指導報告】\d{1,2}月\d{1,2}日 訪問分（ジロー薬局）$/);
        expect(subject).not.toContain(a.header.patient.name.split(" ")[0]);
      }
    }
  });

  it("includePatientName が false なら氏名を入れず別送の案内を付ける。true なら導入の直後に氏名と生年月日が入る", () => {
    const off = buildEmail(argsOf("yamamoto", { includePatientName: false }));
    expect(off.body).not.toContain("山本");
    expect(off.body).toContain("患者様のお名前は別送の報告書に記載しています。");

    const on = buildEmail(argsOf("yamamoto", { includePatientName: true }));
    expect(on.body).toContain("患者：山本 花子（1940年4月1日）");
    expect(on.body).not.toContain("別送の報告書に記載");
    const lines = on.body.split("\n");
    const intro = lines.findIndex((l) => l.includes("別送（FAX／PDF）にてお送りします。"));
    expect(lines[intro + 1]).toBe("患者：山本 花子（1940年4月1日）");
  });

  it("並びは 宛名 → あいさつ → 導入 → 要旨 → 別送の案内 → よろしくお願いします → 署名", () => {
    const { body } = buildEmail(argsOf("yamamoto"));
    const order = [
      yamamotoProfile.recipients.careManager,
      "いつもお世話になっております。ジロー薬局の前田です。",
      "11月5日に訪問した患者様の報告書を、別送（FAX／PDF）にてお送りします。",
      "服薬状況：",
      "患者様のお名前は別送の報告書に記載しています。",
      "よろしくお願いいたします。",
      CONTACT,
    ].map((t) => body.indexOf(t));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
  });

  it("宛名があればそれを先頭に使い、無ければ宛先種別の汎用の宛名にする", () => {
    const withName = buildEmail(argsOf("yamamoto"));
    expect(withName.body.split("\n")[0]).toBe(yamamotoProfile.recipients.careManager);

    const base = argsOf("yamamoto");
    const none = buildEmail({ ...base, header: { ...base.header, addressee: "" } });
    expect(none.body.split("\n")[0]).toBe("ご担当のケアマネジャー様");
    const other = buildEmail({ ...base, header: { ...base.header, addressee: "" }, recipientType: "その他" });
    expect(other.body.split("\n")[0]).toBe("ご担当者様");
  });

  it("ケアマネ宛て: 要旨の 1 行目は P の最後の文（お願い）、2 行目は事実、3 行目は医師に提案したこと", () => {
    const a = argsOf("yamamoto");
    const { body } = buildEmail(a);
    const lines = body.split("\n");
    const start = lines.findIndex((l) => l.startsWith(politeForEmail(lastSentence(a.draft.soap.p))));
    expect(start).toBeGreaterThan(0);
    expect(lines[start]).toBe(politeForEmail(lastSentence(a.draft.soap.p)));
    expect(lines[start]).toContain("ケアマネジャー様には");
    // 連絡先が長く 300 字を超えるので、服薬状況の備考が先に落ちる
    expect(lines[start + 1]).toBe("服薬状況：悪／残薬：朝食後の一包化分 4日分、センノシド錠 要確認（未使用分）");
    expect(lines[start + 2]).toBe("残薬4日分は次回処方で日数調整を医師に提案します。");
    expect(body.trimEnd().endsWith(CONTACT)).toBe(true);
    expect(body).toContain(yamamotoProfile.pharmacy);
  });

  it("医師宛て: 要旨の 1 行目は処方提案（「先生には」で始まる P の最後の文）、医師への提案の行は付かない", () => {
    const a = argsOf("sasaki");
    const lines = buildEmail(a).body.split("\n");
    const start = lines.findIndex((l) => l.startsWith("先生には"));
    expect(start).toBeGreaterThan(0);
    expect(lines[start]).toBe(politeForEmail(lastSentence(a.draft.soap.p)));
    expect(lines[start + 1].startsWith("服薬状況：")).toBe(true);
    expect(lines[start + 2]).toBe("");
    expect(lines[0]).toContain("先生");
  });

  it("本文は 300 字（改行を除く）を目安にする。超えたら事実の行の備考から落とす", () => {
    for (const who of ["yamamoto", "sasaki"] as const) {
      expect(Array.from(noNewline(buildEmail(argsOf(who)).body)).length).toBeLessThanOrEqual(EMAIL_BODY_TARGET);
    }
    const a = argsOf("yamamoto");
    const draft: ReportDraft = {
      ...a.draft,
      adherence: { choice: "悪", note: "あ".repeat(60) },
      leftoverMedications: [{ drugName: "薬", amount: "1日分", note: "い".repeat(60) }],
    };
    const { body } = buildEmail({ ...a, draft });
    expect(body).not.toContain("あああ");
    expect(body).not.toContain("いいい");
  });

  it("連絡先が空なら署名は薬局名・担当だけ", () => {
    const { body } = buildEmail(argsOf("yamamoto", { pharmacyContact: "" }));
    expect(body.trimEnd().endsWith(yamamotoProfile.pharmacy)).toBe(true);
  });

  it("名前を入れない指定のときは、本文中の患者の記号も一般名にして、復元で名前が出ないようにする", () => {
    const a = argsOf("yamamoto");
    const draft: ReportDraft = {
      ...a.draft,
      soap: { ...a.draft.soap, p: "【患者A】さんに紙をお渡しした。ご家族にはご確認いただきたい。【患者A】さんの話を伝える。" },
    };
    const off = buildEmail({ ...a, draft, includePatientName: false });
    expect(off.body).not.toContain("【患者A】");
    expect(off.body).toContain("患者様さんの話を伝える。");
    const on = buildEmail({ ...a, draft, includePatientName: true });
    expect(on.body).toContain("【患者A】さんの話を伝える。");
    expect(anonymizePatientTokens("【患者A】の【住所】")).toBe("患者様の（省略）");
  });
});

describe("チャット", () => {
  it("山本さん・佐々木さんとも、改行を除いて 200 字以内", () => {
    for (const who of ["yamamoto", "sasaki"] as const) {
      for (const includePatientName of [false, true]) {
        const text = buildChat(argsOf(who, { includePatientName }));
        expect(Array.from(noNewline(text)).length).toBeLessThanOrEqual(CHAT_MAX_CHARS);
      }
    }
  });

  it("ケアマネ宛て: 要点（備考＋主な対応＋訪問日）→ 事実 → 【お願い】→ 署名。患者名は既定で入らない", () => {
    const a = argsOf("yamamoto");
    const lines = buildChat(a).split("\n");
    expect(lines[0]).toBe("朝の飲み忘れ 週3回程度。服薬カレンダーを食卓の見える位置に設置。（11/5 訪問）");
    expect(lines[1].startsWith("・残薬：")).toBe(true);
    expect(lines[2]).toBe("・便通 便秘（3日に1回）");
    expect(lines[3]).toBe(`【お願い】${lastSentence(a.draft.soap.p)}`);
    expect(lines[4]).toBe("ジロー薬局 前田");
    expect(lines).toHaveLength(5);
    expect(buildChat(a)).not.toContain("山本");
  });

  it("医師宛て: 1 行目は処方提案（「先生には」を含む）で、【お願い】の行は無い", () => {
    const a = argsOf("sasaki");
    const text = buildChat(a);
    const lines = text.split("\n");
    expect(lines[0]).toContain("先生には");
    expect(lines[0]).toBe(lastSentence(a.draft.soap.p));
    expect(text).not.toContain("【お願い】");
    expect(lines[1].startsWith("・残薬：")).toBe(true);
    expect(lines[lines.length - 1]).toBe("ジロー薬局 前田");
  });

  it("患者名を入れる指定のときだけ、1 行目の頭に氏名が付く", () => {
    const on = buildChat(argsOf("yamamoto", { includePatientName: true })).split("\n")[0];
    expect(on.startsWith("山本 花子様：")).toBe(true);
    expect(buildChat(argsOf("yamamoto")).split("\n")[0].startsWith("山本")).toBe(false);
  });

  it("長いときは 体調の行 → 残薬の備考 → 要点の対応 の順に省く", () => {
    const a = argsOf("yamamoto");
    const full = buildChat(a);
    const len = (t: string): number => Array.from(noNewline(t)).length;

    const noLife = buildChat(a, len(full) - 1);
    expect(noLife).not.toContain("・便通");
    expect(noLife).toContain("（未使用分）");
    expect(noLife).toContain("服薬カレンダー");

    const noLeftNote = buildChat(a, len(noLife) - 1);
    expect(noLeftNote).not.toContain("（未使用分）");
    expect(noLeftNote).toContain("服薬カレンダー");

    const noAction = buildChat(a, len(noLeftNote) - 1);
    expect(noAction).not.toContain("服薬カレンダー");
    expect(noAction).toContain("【お願い】");
  });

  it("備考を省いても長いときは、要点と【お願い】の行を切り詰めて 200 字（改行を除く）に収める", () => {
    const a = argsOf("yamamoto");
    const long = "あ".repeat(150) + "。" + "い".repeat(190) + "。";
    const draft: ReportDraft = { ...a.draft, soap: { ...a.draft.soap, p: long } };
    const text = buildChat({ ...a, draft });
    expect(Array.from(noNewline(text)).length).toBeLessThanOrEqual(CHAT_MAX_CHARS);
    const lines = text.split("\n");
    expect(lines.some((l) => l.startsWith("【お願い】い"))).toBe(true);
    expect(lines.some((l) => l.includes("…"))).toBe(true);
    expect(lines[lines.length - 1]).toBe("ジロー薬局 前田");

    // 医師宛ても同様
    const d = argsOf("sasaki");
    const t2 = buildChat({ ...d, draft: { ...d.draft, soap: { ...d.draft.soap, p: long } } });
    expect(Array.from(noNewline(t2)).length).toBeLessThanOrEqual(CHAT_MAX_CHARS);
  });
});

describe("印刷・FAX の構造", () => {
  it("並びは 宛名→報告日→表題→発信元・送信票→患者→連絡事項→服薬管理→生活状況→SOAP→定型→別紙（処方内容）", () => {
    const m = buildPrintModel(argsOf("yamamoto"));
    expect(Object.keys(m)).toEqual([
      "addressee",
      "reportDate",
      "title",
      "sender",
      "sendNote",
      "patientTitle",
      "patient",
      "contactTitle",
      "contact",
      "tableHead",
      "medication",
      "life",
      "soapTitle",
      "soap",
      "fixedTitle",
      "fixed",
      "appendixTitle",
      "prescriptionHeader",
      "prescriptionItems",
      "concomitant",
    ]);
    expect(m.title).toBe("居宅療養管理指導報告書");
    expect(m.contactTitle).toBe("連絡事項");
    expect(m.appendixTitle).toBe("別紙：処方内容");
  });

  it("宛名は宛先の名称、無ければ宛先種別の汎用の宛名。報告日は和暦でない年月日", () => {
    const m = buildPrintModel(argsOf("yamamoto"));
    expect(m.addressee).toBe(yamamotoProfile.recipients.careManager);
    expect(m.reportDate).toBe("2026年11月5日");
    const a = argsOf("yamamoto");
    expect(buildPrintModel({ ...a, header: { ...a.header, addressee: "" } }).addressee).toBe("ご担当のケアマネジャー様");
    expect(buildPrintModel({ ...a, header: { ...a.header, addressee: "" }, recipientType: "医療機関" }).addressee).toBe(
      "ご担当の先生",
    );
  });

  it("発信元は 薬局・担当・連絡先。送信票は小さく 2 行（送信日・枚数・急ぎは電話で／誤送信時の注意文）", () => {
    const m = buildPrintModel(argsOf("yamamoto"));
    expect(m.sender).toEqual([
      { label: "薬局", value: "ジロー薬局" },
      { label: "担当", value: "薬剤師 前田 二郎" },
      { label: "連絡先", value: CONTACT },
    ]);
    expect(m.sendNote).toHaveLength(2);
    expect(m.sendNote[0]).toContain("送信日 2026年11月5日");
    expect(m.sendNote[0]).toContain(PRINT_PAGES_TEXT);
    expect(m.sendNote[0]).toContain(URGENT_NOTICE);
    expect(m.sendNote[1]).toBe(PRINT_NOTICE);
    // 連絡先が空なら「—」
    expect(buildPrintModel(argsOf("yamamoto", { pharmacyContact: " " })).sender[2].value).toBe("—");
  });

  it("患者・訪問には患者・生年月日・年齢・性別・訪問日・次回訪問・訪問頻度・処方医が入る（名前は常に入る）", () => {
    const m = buildPrintModel(argsOf("yamamoto", { includePatientName: false }));
    expect(m.patient.map((x) => x.label)).toEqual([
      "患者",
      "生年月日",
      "年齢",
      "性別",
      "訪問日",
      "次回訪問",
      "訪問頻度",
      "処方医",
    ]);
    expect(m.patient[0].value).toContain("山本 花子");
    expect(m.patient[2].value).toBe("86歳");
  });

  it("連絡事項は宛先で変わる（contactNotes が無いとき: 医師＝処方提案＋残薬、ケアマネ＝お願い＋医師への提案＋服薬状況）", () => {
    const care = buildPrintModel(argsOf("yamamoto")).contact;
    const doc = buildPrintModel(argsOf("sasaki")).contact;
    expect(care).toHaveLength(3);
    expect(care[0].startsWith("ケアマネジャー様には")).toBe(true);
    expect(care[1]).toContain("医師に提案");
    expect(care[2]).toContain("服薬状況：悪");
    expect(doc).toHaveLength(2);
    expect(doc[0].startsWith("先生には")).toBe(true);
    expect(doc[1]).toBe("残薬：夕食後の一包化分 6日分");
    expect(care).not.toEqual(doc);

    // 同じ下書きでも、宛先を変えると中身が変わる
    const a = argsOf("yamamoto");
    const other = buildPrintModel({ ...a, recipientType: "その他" }).contact;
    expect(other).toHaveLength(2);
    expect(other[1]).toContain("残薬：");
    expect(other).not.toEqual(care);
    const asDoctor = buildPrintModel({ ...a, recipientType: "医療機関" }).contact;
    expect(asDoctor).toHaveLength(2);
    expect(asDoctor[1].startsWith("残薬：")).toBe(true);
  });

  it("連絡事項は contactNotes が渡されて空でなければそれを優先する（空白・空行は除き、最大 3 行）。空配列なら派生に戻る", () => {
    const derived = buildPrintModel(argsOf("yamamoto")).contact;
    const given = buildPrintModel(argsOf("yamamoto", { contactNotes: ["  一行目。 ", "", "二行目。", "三行目。", "四行目。"] })).contact;
    expect(given).toEqual(["一行目。", "二行目。", "三行目。"]);
    expect(buildPrintModel(argsOf("yamamoto", { contactNotes: [] })).contact).toEqual(derived);
    expect(buildPrintModel(argsOf("yamamoto", { contactNotes: ["", "  "] })).contact).toEqual(derived);
    expect(normalizeContactNotes(undefined)).toEqual([]);
    // 見本（fixtures の expected.json）の contactNotes をそのまま使う引数なら、AI が抜き出した 3 行が出る
    const sample = sampleFormatArgs("yamamoto-hanako");
    expect(buildPrintModel(sample).contact).toEqual(sample.contactNotes);
  });

  it("服薬管理と生活状況は 項目｜内容 の 2 列表。備考は内容の後ろに「（備考）」として続く", () => {
    const m = buildPrintModel(argsOf("yamamoto"));
    expect(m.tableHead).toEqual(["項目", "内容"]);
    expect(m.medication.title).toBe("服薬管理");
    expect(m.life.title).toBe("生活状況");
    expect(m.medication.rows.map((r) => r.item)).toEqual(["調剤形態", "服薬管理者", "管理方法", "服薬状況", "残薬"]);
    expect(m.life.rows.map((r) => r.item)).toEqual(
      REPORT_ORDER.filter((x) => x.key !== "soap")
        .map((x) => x.label)
        .filter((l) => !["服薬管理者", "管理方法", "服薬状況", "残薬"].includes(l)),
    );
    for (const r of [...m.medication.rows, ...m.life.rows]) expect(Object.keys(r)).toEqual(["item", "content"]);
    const byItem = Object.fromEntries([...m.medication.rows, ...m.life.rows].map((r) => [r.item, r.content]));
    expect(byItem["調剤形態"]).toBe(yamamotoProfile.dispensingForm);
    expect(byItem["服薬状況"]).toBe("悪（朝の飲み忘れ 週3回程度）");
    expect(byItem["食事・回数"]).toBe("3 回/日");
    expect(byItem["睡眠・日中"]).toBe("有 1時間0分（昼食後に昼寝）");
    expect(byItem["残薬"]).toBe("朝食後の一包化分 4日分、センノシド錠 要確認（センノシド錠：未使用分）");
    expect(byItem["食事・量"]).toBe("普通");
  });

  it("SOAP・定型欄のあとに別紙（処方内容）が来る。mapPrintModelText はすべての文字列に関数を掛ける", () => {
    const m = buildPrintModel(argsOf("sasaki"));
    expect(m.soap.map((x) => x.label)).toEqual(["S", "O", "A", "P"]);
    expect(m.fixed.map((x) => x.label)).toEqual(["指導相手", "後発品希望", "お薬手帳"]);
    expect(m.prescriptionItems).toHaveLength(5);
    expect(m.concomitant).toBe("なし");
    const upper = mapPrintModelText(m, (s) => s.replaceAll("佐々木", "●●●"));
    expect(JSON.stringify(upper)).not.toContain("佐々木");
    expect(JSON.stringify(m)).toContain("佐々木");
    expect(JSON.stringify(upper.medication)).toContain("服薬状況");
    expect(upper.contact).toHaveLength(m.contact.length);
    expect(upper.sender).toHaveLength(m.sender.length);
    expect(upper.sendNote).toHaveLength(2);
    expect(Object.keys(upper)).toEqual(Object.keys(m));
  });
});

describe("連絡事項（contactNotes）を渡したときのメール・チャット", () => {
  const care = ["ヘルパーの訪問時に服薬確認の声かけをご検討いただきたい。", "残薬4日分は次回処方で日数調整を医師に提案した。", "服薬状況は悪で、朝の飲み忘れがある。"];
  const doc = ["降圧薬・利尿薬の用量と服用時刻のご確認をご検討いただきたい。", "夕食後の飲み忘れが週2回程度ある。"];

  it("メール: 要旨は contactNotes を丁寧な形にして使う（1 件目＝お願い、2 件目以降＝事実）", () => {
    const { body } = buildEmail(argsOf("yamamoto", { contactNotes: care }));
    expect(body).toContain("ヘルパーの訪問時に服薬確認の声かけをご検討いただけますと幸いです。");
    expect(body).toContain("残薬4日分は次回処方で日数調整を医師に提案しました。");
    expect(body).toContain("服薬状況は悪で、朝の飲み忘れがある。");
    // 派生の事実行（服薬状況：／残薬：）は出ない
    expect(body).not.toContain("服薬状況：");
    expect(body.indexOf("ご検討いただけますと幸いです。")).toBeLessThan(body.indexOf("医師に提案しました。"));
  });

  it("メール: 300 字を超えるときは contactNotes の後ろの行から減らす（1 件目は残す）", () => {
    const long = ["あ".repeat(80) + "ご検討いただきたい。", "い".repeat(80) + "。", "う".repeat(80) + "。"];
    const { body } = buildEmail(argsOf("yamamoto", { contactNotes: long }));
    expect(body).toContain("ご検討いただけますと幸いです。");
    expect(body).not.toContain("う".repeat(80));
    expect(Array.from(body.replace(/\n/g, "")).length).toBeLessThanOrEqual(EMAIL_BODY_TARGET);
  });

  it("チャット（医師宛て）: 1 行目は 1 件目、2 件目以降は「・」の事実の行。【お願い】は無い", () => {
    const lines = buildChat(argsOf("sasaki", { contactNotes: doc })).split("\n");
    expect(lines[0]).toBe(doc[0]);
    expect(lines[1]).toBe(`・${doc[1]}`);
    expect(lines.some((l) => l.startsWith("【お願い】"))).toBe(false);
  });

  it("チャット（ケアマネ宛て）: 【お願い】は 1 件目、事実の行は 2 件目以降。200 字以内", () => {
    const text = buildChat(argsOf("yamamoto", { contactNotes: care }));
    const lines = text.split("\n");
    expect(lines[0]).toContain("11/5 訪問の報告です。");
    expect(lines).toContain(`・${care[1]}`);
    expect(lines).toContain(`【お願い】${care[0]}`);
    expect(Array.from(text.replace(/\n/g, "")).length).toBeLessThanOrEqual(CHAT_MAX_CHARS);
  });

  it("チャット: 長いときは事実の行を後ろから省く。それでも長ければ切り詰めて 200 字（改行を除く）に収める", () => {
    const long = ["あ".repeat(60) + "をお願いしたい。", "い".repeat(60) + "。", "う".repeat(60) + "。"];
    const text = buildChat(argsOf("yamamoto", { contactNotes: long }));
    expect(Array.from(text.replace(/\n/g, "")).length).toBeLessThanOrEqual(CHAT_MAX_CHARS);
    expect(text).toContain("【お願い】あ");
    const huge = buildChat(argsOf("yamamoto", { contactNotes: ["あ".repeat(400)] }));
    expect(Array.from(huge.replace(/\n/g, "")).length).toBeLessThanOrEqual(CHAT_MAX_CHARS);
  });

  it("チャット（その他宛て）: 1 件目が依頼文でなければ【お願い】は付けず、すべて「・」の事実の行にする", () => {
    const facts = ["残薬4日分がある。", "朝の飲み忘れが週3回程度ある。"];
    const text = buildChat(argsOf("yamamoto", { recipientType: "その他", contactNotes: facts }));
    const lines = text.split("\n");
    expect(lines.some((l) => l.startsWith("【お願い】"))).toBe(false);
    expect(lines).toContain(`・${facts[0]}`);
    expect(lines).toContain(`・${facts[1]}`);
  });

  it("依頼文の判定（isRequestNote）", () => {
    expect(isRequestNote("服薬確認をお願いしたい。")).toBe(true);
    expect(isRequestNote("声かけをご検討いただきたい。")).toBe(true);
    expect(isRequestNote("残薬4日分がある。")).toBe(false);
    expect(isRequestNote("残薬4日分は次回処方で日数調整を医師に提案した。")).toBe(false);
  });

  it("チャット: 患者名を入れない指定のとき、contactNotes の中の記号も一般名にする", () => {
    const text = buildChat(argsOf("yamamoto", { contactNotes: ["【患者A】様の服薬確認をお願いしたい。"] }));
    expect(text).not.toContain("【患者A】");
    expect(text).toContain("患者様");
  });
});

describe("注意書き", () => {
  it("急ぎ・急変は電話で、の文言", () => {
    expect(URGENT_NOTICE).toBe("急ぎ・急変は電話で。");
  });

  it("送信票の注意文と枚数の書き方（印刷は本紙 1 枚＋別紙 1 枚）", () => {
    expect(PRINT_NOTICE).toContain("誤って届いた場合");
    expect(PRINT_PAGES_TEXT).toContain("別紙");
  });
});

describe("薬局名", () => {
  it("最初の空白までを薬局名とする", () => {
    expect(pharmacyNameOf("ジロー薬局　薬剤師 前田 二郎")).toBe("ジロー薬局");
    expect(pharmacyNameOf("")).toBe("");
  });
  it("担当名は、薬局名のあとの語のうち職名でない最初の語。無ければ空", () => {
    expect(staffNameOf("ジロー薬局　薬剤師 前田 二郎")).toBe("前田");
    expect(staffNameOf("ジロー薬局 前田")).toBe("前田");
    expect(staffNameOf("ジロー薬局")).toBe("");
    expect(staffNameOf("ジロー薬局　薬剤師")).toBe("");
  });
});

describe("家族・その他の記号の扱い（患者名を入れない指定のとき、実名に戻らない）", () => {
  // すべて架空。患者と同じ姓の家族（山本 恵子）を【家族1】、別の姓の知人を【家族2】、医療機関名を【その他1】とする
  const tokens: MaskToken[] = [
    { token: "【家族1】", original: "山本 恵子", kind: "family" },
    { token: "【家族2】", original: "田村 一郎", kind: "family" },
    { token: "【その他1】", original: "架空みどりクリニック", kind: "other" },
  ];
  const back = (s: string) => unmaskText(s, tokens);

  function withTokens(over: Partial<FormatArgs> = {}): FormatArgs {
    const a = argsOf("yamamoto", over);
    const draft: ReportDraft = {
      ...a.draft,
      soap: {
        ...a.draft.soap,
        p: "【その他1】の【家族2】さんへ連絡する。【家族1】さんにカレンダーの管理を依頼した。",
      },
      bowelMovement: { ...a.draft.bowelMovement, choice: "便秘", note: "【家族1】さんの話では3日出ていない" },
    };
    return { ...a, draft, familyRelations: ["長女", ""] };
  }

  it("anonymizePatientTokens: 【家族N】は続柄、続柄が無ければ「ご家族」、【その他N】は「（省略）」にする", () => {
    expect(anonymizePatientTokens("【家族1】さんと【家族2】さんと【家族3】さん", ["長女", " "])).toBe(
      `長女さんと${FAMILY_FALLBACK}さんと${FAMILY_FALLBACK}さん`,
    );
    expect(anonymizePatientTokens("【その他12】へ")).toBe("（省略）へ");
    expect(anonymizePatientTokens("【家族1】")).toBe(FAMILY_FALLBACK);
  });

  it("メール: 名前を入れない既定では、家族の実名もその他の語も本文に出ない。続柄になる", () => {
    const body = back(buildEmail(withTokens()).body);
    expect(body).not.toContain("山本");
    expect(body).not.toContain("恵子");
    expect(body).not.toContain("田村");
    expect(body).not.toContain("架空みどりクリニック");
    expect(body).not.toMatch(/【/);
    expect(body).toContain("長女さんにカレンダーの管理を依頼しました。");
  });

  it("チャット: 名前を入れない既定では、家族の実名が出ない", () => {
    const text = back(buildChat(withTokens(), 1000));
    expect(text).not.toContain("山本");
    expect(text).not.toContain("恵子");
    expect(text).not.toContain("田村");
    expect(text).toContain("長女");
    expect(text).toContain("・便通 便秘（長女さんの話では3日出ていない）");
  });

  it("続柄を渡さないときは、家族はすべて「ご家族」になり、実名に戻らない", () => {
    const body = back(buildEmail({ ...withTokens(), familyRelations: undefined }).body);
    expect(body).not.toContain("恵子");
    expect(body).toContain("ご家族さんにカレンダーの管理を依頼しました。");
  });

  it("患者名を入れる指定のときは、これまでどおり記号が実名に戻る", () => {
    const body = back(buildEmail(withTokens({ includePatientName: true })).body);
    expect(body).toContain("山本 恵子さんにカレンダーの管理を依頼しました。");
  });
});

import { describe, expect, it } from "vitest";
import sasakiExpected from "../../../fixtures/sasaki-kiyoshi/expected.json";
import sasakiProfile from "../../../fixtures/sasaki-kiyoshi/profile.json";
import yamamotoExpected from "../../../fixtures/yamamoto-hanako/expected.json";
import yamamotoProfile from "../../../fixtures/yamamoto-hanako/profile.json";
import { unmaskText } from "../mask";
import type { MaskToken } from "../mask";
import { REPORT_ORDER } from "./fields";
import type { FixedFields, ReportHeader } from "./format";
import {
  anonymizePatientTokens,
  buildChat,
  buildEmail,
  buildPrintModel,
  CHAT_MAX_CHARS,
  EMAIL_BODY_TARGET,
  FAMILY_FALLBACK,
  firstSentence,
  lastSentence,
  politeForEmail,
  mapPrintModelText,
  pharmacyNameOf,
  PRINT_NOTICE,
  staffNameOf,
  splitSentences,
  truncateText,
  type FormatArgs,
} from "./formats";
import type { RecipientType, ReportDraft } from "./schema";

// すべて架空のデータ（fixtures/ の見本）。expected.json には根拠（evidence）が無いので空で補う。
const EMPTY_EVIDENCE = { medication: "", meals: "", excretion: "", sleep: "", mobility: "", tendency: "" };
const toDraft = (x: unknown): ReportDraft => ({ ...(x as object), evidence: EMPTY_EVIDENCE }) as ReportDraft;

type Profile = typeof yamamotoProfile;

function headerOf(p: Profile, addressee: string): ReportHeader {
  return {
    addressee,
    reportDate: p.reportDate,
    nextVisitDate: p.nextVisitDate,
    patient: {
      name: p.patient.name,
      kana: p.patient.kana,
      birthDate: p.patient.birthDate,
      sex: p.patient.sex,
      address: p.patient.address,
    },
    pharmacy: p.pharmacy,
    visitFrequency: p.visitFrequency.note ? `${p.visitFrequency.choice}（${p.visitFrequency.note}）` : p.visitFrequency.choice,
    dispensingForm: p.dispensingForm,
    prescriptionHeader: `処方日 ${p.prescription.date} ${p.prescription.prescriber}`,
    prescriptionItems: p.prescription.items.map((i) => [i.drug, i.dose, i.usage, i.days].join("　")).join("\n"),
    concomitant: p.prescription.concomitant,
  };
}

const FIXED: FixedFields = {
  counselingTarget: "本人・家族",
  genericPreference: "後発医薬品での処方を希望する事を確認した。",
  medicineNotebook: "お薬手帳にシールを貼付。",
};

const CONTACT = "TEL 096-000-0000 / FAX 096-000-0001";

function argsOf(who: "yamamoto" | "sasaki", over: Partial<FormatArgs> = {}): FormatArgs {
  const yamamoto = who === "yamamoto";
  const recipientType: RecipientType = yamamoto ? "ケアマネ" : "医療機関";
  const profile = (yamamoto ? yamamotoProfile : sasakiProfile) as Profile;
  const addressee = yamamoto ? profile.recipients.careManager : profile.recipients.doctor;
  return {
    draft: toDraft(yamamoto ? yamamotoExpected : sasakiExpected),
    header: headerOf(profile, addressee),
    fixedFields: FIXED,
    recipientType,
    pharmacyContact: CONTACT,
    includePatientName: false,
    ...over,
  };
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
  it("上段に送信日・宛先・送信元・枚数と注意文があり、送信元に連絡先が入る", () => {
    const m = buildPrintModel(argsOf("yamamoto"));
    expect(m.meta.map((x) => x.label)).toEqual(["送信日", "宛先", "送信元", "枚数"]);
    expect(m.meta[0].value).toBe("2026年11月5日");
    expect(m.meta[1].value).toContain(yamamotoProfile.recipients.careManager);
    expect(m.meta[2].value).toContain(CONTACT);
    expect(m.notice).toBe(PRINT_NOTICE);
  });

  it("基本情報には患者・生年月日・年齢・性別・訪問日・次回訪問・訪問頻度・処方医が入る（名前は常に入る）", () => {
    const m = buildPrintModel(argsOf("yamamoto", { includePatientName: false }));
    expect(m.basic.map((x) => x.label)).toEqual([
      "患者",
      "生年月日",
      "年齢",
      "性別",
      "訪問日",
      "次回訪問",
      "訪問頻度",
      "処方医",
    ]);
    expect(m.basic[0].value).toContain("山本 花子");
    expect(m.basic[2].value).toBe("86歳");
  });

  it("連絡事項は宛先で変わる（医師＝処方提案＋残薬、ケアマネ＝お願い＋医師への提案＋服薬状況）", () => {
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

  it("会話から記入する欄は「服薬管理」と「生活状況」の 2 つの表で、各行は 項目／結果／備考", () => {
    const m = buildPrintModel(argsOf("yamamoto"));
    expect(m.tableHead).toEqual(["項目", "結果", "備考"]);
    expect(m.medication.title).toBe("服薬管理");
    expect(m.life.title).toBe("生活状況");
    expect(m.medication.rows.map((r) => r.item)).toEqual(["調剤形態", "服薬管理者", "管理方法", "服薬状況", "残薬"]);
    expect(m.life.rows.map((r) => r.item)).toEqual(
      REPORT_ORDER.filter((x) => x.key !== "soap")
        .map((x) => x.label)
        .filter((l) => !["服薬管理者", "管理方法", "服薬状況", "残薬"].includes(l)),
    );
    const byItem = Object.fromEntries([...m.medication.rows, ...m.life.rows].map((r) => [r.item, r]));
    expect(byItem["調剤形態"].result).toBe(yamamotoProfile.dispensingForm);
    expect(byItem["服薬状況"]).toEqual({ item: "服薬状況", result: "悪", note: "朝の飲み忘れ 週3回程度" });
    expect(byItem["食事・回数"].result).toBe("3 回/日");
    expect(byItem["睡眠・日中"].result).toBe("有 1時間0分");
    expect(byItem["残薬"].result).toBe("朝食後の一包化分 4日分、センノシド錠 要確認");
    expect(byItem["食事・量"].note).toBe("—");
  });

  it("SOAP・定型欄のあとに処方内容が来る。mapPrintModelText はすべての文字列に関数を掛ける", () => {
    const m = buildPrintModel(argsOf("sasaki"));
    expect(m.soap.map((x) => x.label)).toEqual(["S", "O", "A", "P"]);
    expect(m.fixed.map((x) => x.label)).toEqual(["指導相手", "後発品希望", "お薬手帳"]);
    expect(m.prescriptionTitle).toBe("処方内容");
    const keys = Object.keys(m);
    expect(keys.indexOf("prescriptionTitle")).toBeGreaterThan(keys.indexOf("fixedTitle"));
    const upper = mapPrintModelText(m, (s) => s.replaceAll("佐々木", "●●●"));
    expect(JSON.stringify(upper)).not.toContain("佐々木");
    expect(JSON.stringify(m)).toContain("佐々木");
    expect(JSON.stringify(upper.medication)).toContain("服薬状況");
    expect(upper.contact).toHaveLength(m.contact.length);
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

import { describe, expect, it } from "vitest";
import sasakiProfile from "../../../fixtures/sasaki-kiyoshi/profile.json";
import yamamotoProfile from "../../../fixtures/yamamoto-hanako/profile.json";
import {
  REASON_DOCTOR,
  REASON_HEADING,
  REASON_PATIENT,
  appendPrescriptionLine,
  normalizePrescription,
  stripLeadingNumber,
} from "./prescription";

const SP = String.fromCharCode(0x3000);

describe("normalizePrescription", () => {
  it("レセコン風のタブ区切りは、タブを全角スペース 1 つにして番号を外す", () => {
    const r = normalizePrescription("1.\tアムロジピン錠5mg\t1回1錠\t朝食後\t28日分\r\n2.\tセンノシド錠12mg\t1回2錠\t就寝前\t28日分");
    expect(r.lines).toEqual([
      `アムロジピン錠5mg${SP}1回1錠${SP}朝食後${SP}28日分`,
      `センノシド錠12mg${SP}1回2錠${SP}就寝前${SP}28日分`,
    ]);
    expect(r.removed).toEqual([]);
  });

  it("全角・半角の空白と数字が混ざっていても、空白は全角スペース 1 つ、番号は外れる", () => {
    const r = normalizePrescription("Ｒｐ１）  ロキソニン錠60mg   1回1錠 　 疼痛時\n１．　ムコスタ錠100mg　　1回1錠");
    expect(r.lines).toEqual([`ロキソニン錠60mg${SP}1回1錠${SP}疼痛時`, `ムコスタ錠100mg${SP}1回1錠`]);
  });

  it("医師名・医療機関名らしい行は外して理由をつける", () => {
    const r = normalizePrescription(
      ["処方医：山田　太郎", "さくら内科クリニック", "Dr. Smith", "担当の先生", "○○病院", "△△医院", "□□診療所", "医療機関コード 0000000"].join(
        "\n",
      ),
    );
    expect(r.lines).toEqual([]);
    expect(r.removed).toHaveLength(8);
    expect(r.removed.every((x) => x.reason === REASON_DOCTOR)).toBe(true);
    expect(r.removed[0].line).toBe(`処方医：山田${SP}太郎`);
  });

  it("Dr は単語のときだけ医師名扱い（Dry syrup などは薬剤行のまま）", () => {
    const r = normalizePrescription("プレドニゾロンDry syrup 1%\t1回1g");
    expect(r.lines).toHaveLength(1);
    expect(r.removed).toEqual([]);
  });

  it("先頭の番号（1. 1) ① (2) Rp1 Rp.）を外し、小数で始まる行は番号扱いしない", () => {
    expect(stripLeadingNumber("1.アムロジピン")).toBe("アムロジピン");
    expect(stripLeadingNumber("2）ムコスタ")).toBe("ムコスタ");
    expect(stripLeadingNumber("③ ロキソニン")).toBe("ロキソニン");
    expect(stripLeadingNumber("(4) セレコックス")).toBe("セレコックス");
    expect(stripLeadingNumber("Rp1 ガスター")).toBe("ガスター");
    expect(stripLeadingNumber("Rp.2　マグミット")).toBe("マグミット");
    expect(stripLeadingNumber("1.5錠ずつ 朝食後")).toBe("1.5錠ずつ 朝食後");
    expect(stripLeadingNumber("10mg錠")).toBe("10mg錠");
    expect(normalizePrescription("① アムロジピン\n(2) ムコスタ").lines).toEqual(["アムロジピン", "ムコスタ"]);
  });

  it("空入力・空白だけの入力は、何も返さない", () => {
    expect(normalizePrescription("")).toEqual({ lines: [], removed: [] });
    expect(normalizePrescription("  \n\t\n　\r\n")).toEqual({ lines: [], removed: [] });
  });

  it("患者情報らしい行（患者・氏名・生年月日・保険・公費・様・〒・電話番号）を外す", () => {
    const r = normalizePrescription(
      [
        "患者：架空　花子",
        "氏名 架空 花子",
        "生年月日 昭和15年1月1日",
        "保険者番号 00000000",
        "公費負担者番号 00000000",
        "架空　花子　様",
        "〒860-0000 熊本県架空市",
        "096-000-0000",
        "０９０１２３４５６７８",
        "(096)000-0000",
      ].join("\n"),
    );
    expect(r.lines).toEqual([]);
    expect(r.removed).toHaveLength(10);
    expect(r.removed.every((x) => x.reason === REASON_PATIENT)).toBe(true);
  });

  it("数量・日数の数字は電話番号と見なさない", () => {
    const r = normalizePrescription("ロキソプロフェン錠60mg 1回1錠 毎食後 14日分\nワーファリン錠1mg 0.5錠 夕食後 28日分");
    expect(r.lines).toHaveLength(2);
    expect(r.removed).toEqual([]);
  });

  it("見出し（処方箋・Rp・以下余白）だけの行は「見出し・空白行」として外す", () => {
    const r = normalizePrescription(["処方箋", "【処方箋】", "Rp", "Rp.", "Rp1", "1.", "①", "以下余白", "――― 以下余白 ―――", "ムコスタ錠100mg"].join("\n"));
    expect(r.lines).toEqual(["ムコスタ錠100mg"]);
    expect(r.removed).toHaveLength(9);
    expect(r.removed.every((x) => x.reason === REASON_HEADING)).toBe(true);
  });

  it("薬剤行・外した行ともに元の順序を保ち、空行は捨てる", () => {
    const r = normalizePrescription("処方箋\n\n1. アムロジピン錠5mg 朝食後\n\n処方医 山田\n2. センノシド錠 就寝前\n\n以下余白\n");
    expect(r.lines).toEqual([`アムロジピン錠5mg${SP}朝食後`, `センノシド錠${SP}就寝前`]);
    expect(r.removed.map((x) => x.reason)).toEqual([REASON_HEADING, REASON_DOCTOR, REASON_HEADING]);
  });

  it("医師名と患者情報の語が両方ある行は、医師名・医療機関名として外す", () => {
    const r = normalizePrescription("患者紹介元 さくら病院");
    expect(r.removed).toEqual([{ line: `患者紹介元${SP}さくら病院`, reason: REASON_DOCTOR }]);
  });
});

describe("appendPrescriptionLine", () => {
  it("欄が空なら、その行だけにする", () => {
    expect(appendPrescriptionLine("", "ムコスタ錠100mg")).toBe("ムコスタ錠100mg");
  });

  it("既に内容があれば、末尾の空白を落として次の行に足す", () => {
    expect(appendPrescriptionLine("アムロジピン錠\n\n", "ムコスタ錠")).toBe("アムロジピン錠\nムコスタ錠");
  });

  it("戻す行の先頭の番号は外す。空の行は何も変えない", () => {
    expect(appendPrescriptionLine("A", "3. B")).toBe("A\nB");
    expect(appendPrescriptionLine("A", "  ")).toBe("A");
  });
});

describe("医師名・医療機関名らしい行の取りこぼし対策", () => {
  it("医療センター・診療科・院長・Clinic・Hospital の行を外す", () => {
    const r = normalizePrescription(
      [
        "熊本医療センター 田中",
        "架空医療法人 さくら会",
        "さくら内科",
        "ひまわり整形外科 山田",
        "たんぽぽ小児科",
        "架空皮膚科医",
        "みどり眼科",
        "架空耳鼻咽喉科",
        "架空精神科",
        "すずらん歯科",
        "院長 鈴木",
        "Sakura Clinic",
        "Aoba Hospital",
      ].join("\n"),
    );
    expect(r.lines).toEqual([]);
    expect(r.removed).toHaveLength(13);
    expect(r.removed.every((x) => x.reason === REASON_DOCTOR)).toBe(true);
  });

  it("薬剤名・用法の行は外さない（「医療用」「〜科用」「外用」「内服」などを巻き込まない）", () => {
    const r = normalizePrescription(
      [
        "医療用酸素 1回1L",
        "皮膚科用軟膏 1日2回",
        "外用 ヒルドイドソフト軟膏 1日2回",
        "内服 アムロジピン錠5mg 朝食後",
        "歯磨き後 うがい薬",
        "プレドニゾロンDry syrup 1%",
        "ホスピタル錠 1回1錠",
      ].join("\n"),
    );
    expect(r.removed).toEqual([]);
    expect(r.lines).toHaveLength(7);
  });

  it("架空の見本（fixtures）の処方の薬剤行は、1 行も外れない", () => {
    for (const p of [yamamotoProfile, sasakiProfile]) {
      const text = p.prescription.items.map((i) => [i.drug, i.dose, i.usage, i.days].join(SP)).join("\n");
      const r = normalizePrescription(text);
      expect(r.removed).toEqual([]);
      expect(r.lines).toHaveLength(p.prescription.items.length);
    }
  });
});

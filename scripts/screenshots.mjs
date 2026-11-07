/**
 * 画面 v2（①患者 ②会話 ③下書き ④出力のタブ式）のスクリーンショットを撮る（docs/screenshots と使い方ガイドの元）。
 * すべて架空データ。患者を数人見せる場面は、架空の患者を localStorage に入れてから撮る。
 *
 * 前提:
 *   1. 本番ビルドのサーバーを動かしておく: npm run build && npx next start -p 3001
 *      （.env の API キーで下書きを 3 回作る。費用は数円）
 *   2. Playwright: npm i -D playwright@1.61 && npx playwright install chromium
 *      （インストール済みの Chromium を使うなら PW_CHROME=<chrome.exe のパス>。
 *        playwright を別の場所に入れてあるなら NODE_PATH=<その node_modules>）
 * 使い方:
 *   node scripts/screenshots.mjs <出力フォルダ> [http://localhost:3001]
 * 出力: iPhone 13 相当（幅 390px・等倍）の PNG と、PC 幅（1280×860）の PNG、印刷見本 A4（2 倍）。
 * 画面に出る薬局の連絡先は架空（TEL 000-000-0000）を localStorage に入れてから撮る。
 */
import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// ESM の import は NODE_PATH を見ないので、まず通常の import、だめなら require（NODE_PATH が効く）で探す。
let pw;
try {
  pw = await import("playwright");
} catch {
  pw = createRequire(import.meta.url)("playwright");
}
const { chromium, devices } = pw.chromium ? pw : pw.default;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.argv[2] || path.join(__dirname, "..", "docs", "screenshots-raw");
const BASE = process.argv[3] || "http://localhost:3001";
fs.mkdirSync(OUT, { recursive: true });

const STORE_KEY = "houmon-report-ai:patients:v1";
const CONTACT = "TEL 000-000-0000　FAX 000-000-0001";
const wait = (p, ms) => p.waitForTimeout(ms);

// ---- 架空の患者リスト（v2 の store）。曜日: 0=日 1=月 2=火 3=水 4=木 5=金 6=土 ----
const T0 = "2026-11-01T00:00:00.000Z";
function mkPatient(id, fam, giv, famKana, givKana, extra = {}) {
  return {
    id, familyName: fam, givenName: giv, familyNameKana: famKana, givenNameKana: givKana,
    birthDate: "1940-04-01", sex: "女性", address: "", phone: "", familyNote: "", familyMembers: [], otherMaskWords: [],
    recipients: { careManager: "", doctor: "" }, visitFrequency: { choice: "", note: "" },
    dispensingForm: "", medicationManager: "", managementMethod: "",
    prescription: { header: "", items: "", concomitant: "" },
    fixedFields: { counselingTarget: "", genericPreference: "", medicineNotebook: "" },
    groupIds: [], memo: "", createdAt: T0, updatedAt: T0,
    residence: { kind: "home", facilityId: null }, visitDays: [], handoverNote: "",
    ...extra,
  };
}
const inFac = (facilityId) => ({ residence: { kind: "facility", facilityId } });
function demoStore() {
  const g1 = { id: "g-morning", name: "朝の訪問", sortMode: "kana", manualOrder: [], createdAt: T0 };
  const f1 = { id: "f-himawari", name: "ひまわり荘", nameKana: "ヒマワリソウ", groupIds: [], visitDays: [4], sortMode: "kana", manualOrder: [], createdAt: T0, updatedAt: T0 };
  const f2 = { id: "f-sakura", name: "さくら苑", nameKana: "サクラエン", groupIds: ["g-morning"], visitDays: [1], sortMode: "kana", manualOrder: [], createdAt: T0, updatedAt: T0 };
  const patients = [
    mkPatient("p-aoki", "青木", "次郎", "アオキ", "ジロウ", { sex: "男性", visitDays: [1], groupIds: ["g-morning"] }),
    mkPatient("p-asada", "浅田", "花", "アサダ", "ハナ", { visitDays: [3], groupIds: ["g-morning"] }),
    mkPatient("p-sato", "佐藤", "春子", "サトウ", "ハルコ", {
      visitDays: [3, 5], groupIds: ["g-morning"],
      handoverNote: "階段の手すりにつかまって歩く。声かけは玄関で、大きめの声で。",
    }),
    mkPatient("p-nakamura", "中村", "三郎", "ナカムラ", "サブロウ", { sex: "男性", visitDays: [1] }),
    mkPatient("p-tanaka", "田中", "一郎", "タナカ", "イチロウ", { sex: "男性", visitDays: [4], ...inFac("f-himawari") }),
    mkPatient("p-suzuki", "鈴木", "二郎", "スズキ", "ジロウ", { sex: "男性", visitDays: [4], ...inFac("f-himawari") }),
    mkPatient("p-kobayashi", "小林", "梅", "コバヤシ", "ウメ", { visitDays: [4], ...inFac("f-himawari") }),
    mkPatient("p-ito", "伊藤", "松子", "イトウ", "マツコ", { visitDays: [1], groupIds: ["g-morning"], ...inFac("f-sakura") }),
  ];
  return { version: 2, patients, groups: [g1], facilities: [f1, f2], homeSortMode: "kana", homeManualOrder: [], selectedPatientId: null };
}

async function main() {
  const browser = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {});
  const contact = () => {
    try { localStorage.setItem("houmon-report-ai:pharmacyContact", "TEL 000-000-0000　FAX 000-000-0001"); } catch {}
  };

  /** iPhone 13 相当（390px 幅・等倍） */
  const phoneCtx = async () => {
    const ctx = await browser.newContext({ ...devices["iPhone 13"], deviceScaleFactor: 1, locale: "ja-JP", colorScheme: "light" });
    await ctx.addInitScript(contact);
    const p = await ctx.newPage();
    p.on("dialog", (d) => d.accept());
    return [ctx, p];
  };
  const shotOf = (p) => async (name, full = false) => {
    await wait(p, 500);
    if (full) {
      // 下に固定の「戻る・次へ」バーが途中に写らないよう、画面の高さをページの高さに伸ばして撮る
      const orig = p.viewportSize();
      await p.evaluate(() => window.scrollTo(0, 0));
      const h = await p.evaluate(() => document.documentElement.scrollHeight);
      await p.setViewportSize({ width: orig.width, height: Math.min(h, 2600) });
      await wait(p, 400);
      await p.screenshot({ path: path.join(OUT, `${name}.png`) });
      await p.setViewportSize(orig);
      await wait(p, 300);
    } else {
      await p.screenshot({ path: path.join(OUT, `${name}.png`) });
    }
    console.log("shot", name);
  };
  const scrollTo = async (p, locator, offset = 12) => {
    await locator.first().waitFor({ timeout: 20000 });
    await locator.first().evaluate((el, off) => {
      window.scrollTo(0, Math.max(0, el.getBoundingClientRect().top + window.scrollY - off));
    }, offset);
    await wait(p, 400);
  };
  const top = async (p) => { await p.evaluate(() => window.scrollTo(0, 0)); await wait(p, 300); };
  const current = async (p) => (await p.locator('[aria-current="step"]').first().innerText().catch(() => "")).replace(/\s+/g, "");
  /** 「次へ」「戻る」でタブ n（1〜4）へ移る */
  const goStep = async (p, n) => {
    const mark = ["①", "②", "③", "④"][n - 1];
    for (let i = 0; i < 6 && !(await current(p)).includes(mark); i++) {
      const now = await current(p);
      const idx = ["①", "②", "③", "④"].findIndex((m) => now.includes(m)) + 1;
      await p.getByRole("button", { name: idx < n ? /次へ/ : /戻る/ }).first().click();
      await wait(p, 500);
    }
  };
  const openOther = async (p) => {
    await p.getByText("その他（読み込み").click();
    await wait(p, 300);
  };
  const personal = (p) => p.getByRole("button", { name: /^個人宅\s*\d+\s*人/ });
  const facilityBtn = (p) => p.getByRole("button", { name: /^施設\s*\d+\s*施設/ });
  const segment = (p, label) => p.getByRole("group", { name: "区分けの切り替え" }).getByRole("button", { name: label });

  /** 架空サンプルを「その他」から読み込み、②でマスク → 下書きを作って③へ（API を 1 回呼ぶ） */
  async function sampleToDraft(p, which) {
    await openOther(p);
    await p.getByRole("button", { name: new RegExp(`サンプル${which}.*を読み込む`) }).first().click();
    await wait(p, 1500);
    await goStep(p, 2);
    await p.getByRole("button", { name: "個人名を見えないようマスク処理する" }).click();
    await p.getByText(/置き換えた記号（\d+件）/).waitFor({ timeout: 20000 });
  }
  async function makeDraft(p) {
    const ack = p.getByLabel(/会話に患者さんの名前が出ていない/);
    if (await ack.count()) await ack.check();
    await p.getByRole("button", { name: /この内容で下書きを作る/ }).click();
    await p.getByRole("button", { name: "確認して出力へ進む" }).waitFor({ timeout: 150000 });
    await wait(p, 600);
  }

  // ================= A. 患者を選ぶ（①）: 架空の患者リストを入れて撮る =================
  {
    const [ctx, page] = await phoneCtx();
    const shot = shotOf(page);
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await page.evaluate(([k, v]) => localStorage.setItem(k, v), [STORE_KEY, JSON.stringify(demoStore())]);
    await page.reload({ waitUntil: "networkidle" });
    await wait(page, 800);
    await shot("01-entrance");

    await personal(page).click();
    await wait(page, 400);
    await shot("02-home-kana", true);

    await segment(page, "グループ").click();
    await wait(page, 400);
    await shot("03-home-group", true);

    await segment(page, "曜日").click();
    await wait(page, 400);
    await shot("04-home-weekday", true);

    await segment(page, "五十音").click();
    await wait(page, 300);
    await page.getByRole("button", { name: /佐藤 春子/ }).first().click();
    await wait(page, 600);
    await scrollTo(page, page.getByText(/^選択中:/), 90);
    await shot("05-patient-card");

    await page.getByRole("button", { name: /申し送り・注意事項/ }).click();
    await wait(page, 400);
    await shot("06-handover-dialog");
    await page.getByRole("dialog").getByRole("button", { name: "閉じる" }).click();
    await wait(page, 300);

    await page.getByRole("button", { name: "患者を選び直す" }).click();
    await wait(page, 400);
    await facilityBtn(page).click();
    await wait(page, 400);
    await shot("07-facility-list", true);

    await page.getByRole("button", { name: /ひまわり荘/ }).first().click();
    await wait(page, 400);
    await page.getByRole("group", { name: "並び順" }).getByRole("button", { name: "手動" }).click();
    await wait(page, 500);
    await scrollTo(page, page.getByRole("heading", { name: /^ひまわり荘（3人）/ }), 90);
    await shot("08-facility-residents-manual");
    await ctx.close();
  }

  // ================= B. 架空サンプル①（個人宅・水曜・申し送りあり）: ②〜④ =================
  {
    const [ctx, page] = await phoneCtx();
    const shot = shotOf(page);
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await openOther(page);
    await page.getByRole("button", { name: /サンプル①.*を読み込む/ }).first().click();
    await wait(page, 1500);
    await goStep(page, 2);
    // ②の先頭の大きな「録音して文字起こし」ボタン（iPhone のときだけ出る）から会話欄までを 1 枚に
    await scrollTo(page, page.getByRole("link", { name: "録音して文字起こし" }), 150);
    await shot("09-transcript");

    await page.getByRole("button", { name: "個人名を見えないようマスク処理する" }).click();
    const replaced = page.getByText(/置き換えた記号（\d+件）/);
    await replaced.waitFor({ timeout: 20000 });
    await scrollTo(page, page.locator("mark").first(), 260);
    await shot("10-masked");

    await makeDraft(page);
    await goStep(page, 3);
    await scrollTo(page, page.getByRole("heading", { name: /^③ 下書き/ }), 80);
    await shot("11-draft");

    await page.getByRole("button", { name: "確認して出力へ進む" }).click();
    await wait(page, 800);
    const confirmBtn = page.getByRole("button", { name: /^(このまま確定|確定する)$/ });
    await confirmBtn.first().waitFor({ timeout: 20000 });
    await confirmBtn.first().click();
    const sendHead = page.getByText("送り方を選ぶ");
    await sendHead.first().waitFor({ timeout: 20000 });
    await scrollTo(page, sendHead, 100);
    await shot("13-output-formats");
    await ctx.close();
  }

  // ================= C. 架空サンプル②（施設・木曜）: 新しい患者の流れ =================
  {
    const [ctx, page] = await phoneCtx();
    const shot = shotOf(page);
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await sampleToDraft(page, "②");
    await makeDraft(page);
    await goStep(page, 3);
    await scrollTo(page, page.getByText("会話から読み取った基本情報").first(), 100);
    await shot("12-new-patient-suggestions");
    await scrollTo(page, page.getByText(/^連絡事項（宛先向け/).first(), 70);
    await shot("14-contact-notes-doctor");
    await ctx.close();
  }

  // ================= D. PC 幅（1280×860）: ① 入口と、サンプル①の ④ 出力 =================
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1, locale: "ja-JP" });
    await ctx.addInitScript(contact);
    const page = await ctx.newPage();
    page.on("dialog", (d) => d.accept());
    const shot = shotOf(page);
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await page.evaluate(([k, v]) => localStorage.setItem(k, v), [STORE_KEY, JSON.stringify(demoStore())]);
    await page.reload({ waitUntil: "networkidle" });
    await wait(page, 800);
    await shot("16-pc-entrance");
    await ctx.close();

    const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1, locale: "ja-JP" });
    await ctx2.addInitScript(contact);
    const p2 = await ctx2.newPage();
    p2.on("dialog", (d) => d.accept());
    const shot2 = shotOf(p2);
    await p2.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await sampleToDraft(p2, "①");
    await makeDraft(p2);
    await p2.getByRole("button", { name: "確認して出力へ進む" }).click();
    await wait(p2, 800);
    const confirmBtn = p2.getByRole("button", { name: /^(このまま確定|確定する)$/ });
    await confirmBtn.first().waitFor({ timeout: 20000 });
    await confirmBtn.first().click();
    await p2.getByText("送り方を選ぶ").first().waitFor({ timeout: 20000 });
    await scrollTo(p2, p2.getByText("送り方を選ぶ"), 90);
    await shot2("17-pc-output");
    await ctx2.close();
  }

  // ================= E. 印刷・FAX の A4 見本（print メディア） =================
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2, locale: "ja-JP" });
    await ctx.addInitScript(contact);
    const p = await ctx.newPage();
    await p.goto(`${BASE}/print-sample/yamamoto-hanako`, { waitUntil: "networkidle" });
    await wait(p, 800);
    await p.emulateMedia({ media: "print" });
    await wait(p, 500);
    const report = p.locator(".print-report").first();
    if (await report.count()) await report.screenshot({ path: path.join(OUT, "15-print-a4.png") });
    else await p.screenshot({ path: path.join(OUT, "15-print-a4.png"), fullPage: true });
    console.log("shot 15-print-a4");
    await ctx.close();
  }

  await browser.close();
  console.log("done");
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});

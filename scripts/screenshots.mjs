/**
 * 画面のスクリーンショットを撮る（docs/screenshots と使い方ガイドの元）。すべて架空サンプルで動かす。
 *
 * 前提:
 *   1. 本番ビルドのサーバーを動かしておく: npm run build && npx next start -p 3001
 *      （.env の API キーで下書きを 2 回作る。費用は数円）
 *   2. Playwright: npm i -D playwright@1.61 && npx playwright install chromium
 *      （インストール済みの Chromium を使うなら PW_CHROME=<chrome.exe のパス>）
 * 使い方:
 *   node scripts/screenshots.mjs <出力フォルダ> [http://localhost:3001]
 * 出力: iPhone 13 相当（390px 幅・3 倍）の PNG と、PC 幅（1280px・2 倍）の PNG。
 * 画面に出る薬局の連絡先は架空（TEL 000-000-0000）を localStorage に入れてから撮る。
 */
import { chromium, devices } from "playwright";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.argv[2] || path.join(__dirname, "..", "docs", "screenshots-raw");
const BASE = process.argv[3] || "http://localhost:3001";
fs.mkdirSync(OUT, { recursive: true });

async function main() {
  const browser = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {});
  const ctx = await browser.newContext({ ...devices["iPhone 13"], locale: "ja-JP", colorScheme: "light" });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("houmon-report-ai:pharmacyContact", "TEL 000-000-0000　FAX 000-000-0001");
    } catch {}
  });
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept());

  const shot = async (name) => {
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    console.log("shot", name);
  };
  const scrollTo = async (locator, offset = 12) => {
    await locator.first().waitFor({ timeout: 20000 });
    await locator.first().evaluate((el, off) => {
      window.scrollTo(0, Math.max(0, el.getBoundingClientRect().top + window.scrollY - off));
    }, offset);
    await page.waitForTimeout(400);
  };
  const top = async () => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
  };
  /** 見出しの直後にある「根拠を見る」を開く */
  const openEvidenceBelow = async (anchor) => {
    const anchorY = await anchor.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
    const btns = page.getByRole("button", { name: /根拠を見る/ });
    const n = await btns.count();
    for (let i = 0; i < n; i++) {
      const y = await btns.nth(i).evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
      if (y > anchorY) {
        await btns.nth(i).click();
        return;
      }
    }
  };

  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await shot("00-top-empty");

  // ① 架空サンプル①（登録済みの患者・ケアマネ宛）
  await page.getByRole("button", { name: "架空サンプル① 山本花子さんを読み込む" }).click();
  await page.waitForTimeout(600);
  await top();
  await shot("01-patient-top");
  await scrollTo(page.getByRole("button", { name: /山本 花子/ }), 160);
  await shot("01b-patient-row");

  // ② 会話 → マスク
  await scrollTo(page.locator("#step-2"));
  await shot("02-transcript");
  await page.getByRole("button", { name: "マスクして確認" }).click();
  const replaced = page.getByText(/置き換えた記号（\d+件）/);
  await replaced.waitFor({ timeout: 20000 });
  await scrollTo(page.locator("mark").first(), 260);
  await shot("03b-masked-highlight");
  await scrollTo(replaced, 300);
  await shot("03-masked");

  // ③ 下書き（API 1 回目）
  await page.getByRole("button", { name: "この内容で下書きを作る" }).click();
  await page.getByRole("button", { name: "確認して出力へ進む" }).waitFor({ timeout: 150000 });
  await scrollTo(page.locator("#step-3"));
  await shot("04-draft-top");

  const status = page.getByText("服薬状況", { exact: true }).first();
  await scrollTo(status, 120);
  await openEvidenceBelow(status);
  await page.waitForTimeout(400);
  await scrollTo(status, 120);
  await shot("05b-evidence-open");

  const badge = page.getByText(/要確認（残数）/).first();
  await scrollTo(badge, 160);
  await shot("05-draft-unsure");

  await scrollTo(page.getByText("指導内容（SOAP）").first(), 70);
  await shot("06-draft-soap");
  await scrollTo(page.getByText(/^連絡事項（宛先向け/).first(), 70);
  await shot("07-draft-contact-notes");

  // ④ 確定 → 送り方
  await page.getByRole("button", { name: "確認して出力へ進む" }).click();
  const confirmBtn = page.getByRole("button", { name: /^(このまま確定|確定する)$/ });
  await confirmBtn.waitFor({ timeout: 20000 });
  await scrollTo(confirmBtn, 420);
  await shot("08-confirm-unsure");
  await confirmBtn.click();
  const sendHead = page.getByText("送り方を選ぶ");
  await sendHead.waitFor({ timeout: 20000 });
  await scrollTo(sendHead, 70);
  await shot("09-output-software");

  await page.getByRole("radio", { name: "印刷・FAX" }).check({ force: true });
  await page.waitForTimeout(400);
  await scrollTo(sendHead, 70);
  await shot("10-output-print-top");
  await scrollTo(page.locator("h3", { hasText: /^連絡事項$/ }).first(), 140);
  await shot("11-output-print-contact");

  await page.getByRole("radio", { name: "チャット" }).check({ force: true });
  await page.waitForTimeout(400);
  await scrollTo(sendHead, 70);
  await shot("12-output-chat");
  await scrollTo(page.locator("pre").first(), 120);
  await shot("13-output-chat-text");

  await page.getByRole("radio", { name: "メール" }).check({ force: true });
  await page.waitForTimeout(400);
  await scrollTo(sendHead, 70);
  await shot("14-output-email");

  // 架空サンプル②（新しい患者・医師宛。API 2 回目）
  await top();
  await page.getByRole("button", { name: "架空サンプル② 佐々木清さんを読み込む" }).click();
  await page.waitForTimeout(600);
  await top();
  await shot("15-new-patient-bar");
  await page.getByRole("button", { name: "マスクして確認" }).click();
  await page.getByText(/置き換えた記号（\d+件）/).waitFor({ timeout: 20000 });
  await page.getByRole("button", { name: "この内容で下書きを作る" }).click();
  await page.getByRole("button", { name: "確認して出力へ進む" }).waitFor({ timeout: 150000 });
  await scrollTo(page.getByText("会話から読み取った基本情報").first(), 60);
  await shot("16-new-patient-suggestions");
  await scrollTo(page.getByText(/^連絡事項（宛先向け/).first(), 70);
  await shot("17-contact-notes-doctor");
  const saveBtn = page.getByRole("button", { name: "患者リストに保存" });
  if (await saveBtn.count()) {
    await saveBtn.first().click();
    await page.waitForTimeout(600);
    await top();
    await shot("18-patient-list-two");
  }
  await ctx.close();

  // パソコン幅: ①、マスク後の②、印刷見本（画面と印刷メディア）
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2, locale: "ja-JP" });
  const p2 = await ctx2.newPage();
  p2.on("dialog", (d) => d.accept());
  await p2.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await p2.getByRole("button", { name: "架空サンプル① 山本花子さんを読み込む" }).click();
  await p2.waitForTimeout(600);
  await p2.evaluate(() => window.scrollTo(0, 0));
  await p2.waitForTimeout(300);
  await p2.screenshot({ path: path.join(OUT, "30-pc-home.png") });
  console.log("shot 30-pc-home");
  await p2.getByRole("button", { name: "マスクして確認" }).click();
  await p2.getByText(/置き換えた記号（\d+件）/).waitFor({ timeout: 20000 });
  await p2.locator("mark").first().evaluate((el) => {
    window.scrollTo(0, Math.max(0, el.getBoundingClientRect().top + window.scrollY - 200));
  });
  await p2.waitForTimeout(400);
  await p2.screenshot({ path: path.join(OUT, "31-pc-masked.png") });
  console.log("shot 31-pc-masked");

  await p2.goto(`${BASE}/print-sample/yamamoto-hanako`, { waitUntil: "networkidle" });
  await p2.waitForTimeout(800);
  await p2.screenshot({ path: path.join(OUT, "20-print-sample-screen.png"), fullPage: true });
  console.log("shot 20-print-sample-screen");
  await p2.emulateMedia({ media: "print" });
  await p2.waitForTimeout(500);
  const report = p2.locator(".print-report").first();
  if (await report.count()) {
    await report.screenshot({ path: path.join(OUT, "21-print-a4.png") });
  } else {
    await p2.screenshot({ path: path.join(OUT, "21-print-a4.png"), fullPage: true });
  }
  console.log("shot 21-print-a4");
  await ctx2.close();
  await browser.close();
  console.log("done");
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});

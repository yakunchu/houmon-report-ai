/**
 * 開発用 CA（certificates/rootCA.pem）だけを LAN 内に配る小さな HTTP サーバー（iPhone に CA を入れるため）。
 * - 配るのは公開鍵の証明書 rootCA.pem だけ。rootCA-key.pem やサーバー鍵は絶対に配らない。
 * - iPhone の Safari が「プロファイルのダウンロード」と認識するよう Content-Type を application/x-x509-ca-cert にする。
 * - トップページ（/）に、QR と手順を出す（PC のブラウザで開き、iPhone で QR を読む）。
 * - 使い終わったら Ctrl+C で止める。
 *
 * 使い方: node scripts/serve-ca.mjs [port]  （既定 8788）
 */
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { resolve } from "node:path";

const port = Number(process.argv[2] ?? 8788);
const caPath = resolve(process.cwd(), "certificates", "rootCA.pem");
if (!existsSync(caPath)) {
  console.error("certificates/rootCA.pem がありません。先に npm run cert:dev を実行してください。");
  process.exit(1);
}
const ips = Object.values(networkInterfaces())
  .flat()
  .filter((a) => a && a.family === "IPv4" && !a.internal)
  .map((a) => a.address);
const host = ips[0] ?? "localhost";
const caUrl = `http://${host}:${port}/rootCA.pem`;
/** アプリ（https の開発サーバー）の URL。ポートは引数 2 つ目で変えられる（既定 3000） */
const appPort = Number(process.argv[3] ?? 3000);
const appUrl = `https://${host}:${appPort}`;

const page = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>開発用 CA の配布</title>
<style>body{font-family:system-ui,sans-serif;max-width:720px;margin:24px auto;padding:0 16px;font-size:18px;line-height:1.7}
code{font-size:18px;background:#f1f5f9;padding:2px 6px;border-radius:4px}#qr{margin:16px 0}ol li{margin:8px 0}</style></head><body>
<h1>iPhone に開発用の証明書を入れる</h1>
<p>この PC の開発サーバーを <strong>https</strong> で開くための、開発用 CA（証明書）です。配っているのは公開鍵だけです。</p>
<div id="qr"></div>
<p>iPhone のカメラで QR を読むか、Safari で <code>${caUrl}</code> を開いてください。</p>
<ol>
<li>Safari が「プロファイルをダウンロードしますか？」と聞くので <strong>許可</strong></li>
<li>設定アプリ → 上部の「プロファイルがダウンロードされました」→ <strong>インストール</strong>（パスコード入力）</li>
<li>設定 → 一般 → 情報 → <strong>証明書信頼設定</strong> → 「houmon-report-ai dev CA」を <strong>ON</strong>（ルート証明書を全面的に信頼）</li>
<li>Safari で <code>${appUrl}</code> を開く → 「この接続はプライベートではありません」の警告が出ずに開けば完了。
最近の iOS（26・27）の Safari はアドレスバーに鍵マークを出しません。確かめるときは、アドレスバー左のページメニューから「接続セキュリティの詳細」を開き、発行者が「houmon-report-ai dev CA」になっていることを見ます</li>
</ol>
<h2>アプリを開く（証明書を入れたあと）</h2>
<div id="qr-app"></div>
<p><code>${appUrl}</code></p>
<p>使い終わったら、PC 側でこのサーバーを Ctrl+C で止めてください。</p>
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
<script>new QRCode(document.getElementById("qr"),{text:${JSON.stringify(caUrl)},width:280,height:280,correctLevel:QRCode.CorrectLevel.M});
new QRCode(document.getElementById("qr-app"),{text:${JSON.stringify(appUrl)},width:280,height:280,correctLevel:QRCode.CorrectLevel.M});</script>
</body></html>`;

createServer((req, res) => {
  if (req.url === "/rootCA.pem") {
    res.writeHead(200, {
      "Content-Type": "application/x-x509-ca-cert",
      "Content-Disposition": 'attachment; filename="rootCA.pem"',
      "Cache-Control": "no-store",
    });
    res.end(readFileSync(caPath));
    return;
  }
  if (req.url === "/" || req.url === "/index.html") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(page);
    return;
  }
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("not found");
}).listen(port, "0.0.0.0", () => {
  console.log(`開発用 CA の配布サーバー: http://${host}:${port}/  （CA: ${caUrl}）\n使い終わったら Ctrl+C で止めてください。`);
});

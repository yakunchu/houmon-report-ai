/**
 * 開発用の HTTPS 証明書を作る（スマホから https://<PC の LAN IP>:3000 で開くため）。
 *
 * - 開発用の CA（rootCA.pem / rootCA-key.pem）を 1 回だけ作り、その CA で LAN IP と localhost 入りの
 *   サーバー証明書（dev-cert.pem / dev-key.pem）に署名する。すべて certificates/（git 管理外）に置く。
 * - OpenSSL を使う（Windows は Git for Windows 付属の openssl.exe を自動で探す）。mkcert のダウンロードは不要。
 * - iPhone で使うには rootCA.pem を端末に入れて「ルート証明書を全面的に信頼」を ON にする（README 参照）。
 *   rootCA-key.pem は PC の外に出さないこと。
 *
 * 使い方: npm run cert:dev            … この PC の IPv4 アドレスを自動で全部入れる
 *         npm run cert:dev -- --ip 192.168.1.50 … IP を指定（複数可: --ip a --ip b）
 *         npm run cert:dev -- --force  … サーバー証明書を作り直す（IP が変わったとき。CA はそのまま）
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { join, resolve } from "node:path";

const root = process.cwd();
const dir = resolve(root, "certificates");
const caKey = join(dir, "rootCA-key.pem");
const caCert = join(dir, "rootCA.pem");
const srl = join(dir, "rootCA.srl");
const key = join(dir, "dev-key.pem");
const csr = join(dir, "dev.csr");
const cert = join(dir, "dev-cert.pem");
const ext = join(dir, "dev-ext.cnf");

const args = process.argv.slice(2);
const force = args.includes("--force");
const ips = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--ip" && args[i + 1]) ips.push(args[++i]);
}
if (ips.length === 0) {
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family === "IPv4" && !a.internal) ips.push(a.address);
    }
  }
}
if (ips.length === 0) {
  console.error("LAN の IPv4 アドレスが見つかりません。--ip で指定してください。");
  process.exit(1);
}

function findOpenssl() {
  const candidates = [
    "openssl",
    "C:\\Program Files\\Git\\usr\\bin\\openssl.exe",
    "C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe",
  ];
  for (const c of candidates) {
    try {
      execFileSync(c, ["version"], { stdio: "ignore" });
      return c;
    } catch {
      // 次の候補へ
    }
  }
  console.error("openssl が見つかりません。Git for Windows を入れるか、PATH に openssl を追加してください。");
  process.exit(1);
}
const openssl = findOpenssl();
const run = (a) => execFileSync(openssl, a, { stdio: ["ignore", "pipe", "inherit"] });

mkdirSync(dir, { recursive: true });

if (!existsSync(caKey) || !existsSync(caCert)) {
  console.log("開発用 CA を作ります（初回だけ）…");
  run([
    "req", "-x509", "-newkey", "rsa:2048", "-sha256", "-nodes", "-days", "1825",
    "-keyout", caKey, "-out", caCert,
    "-subj", "/CN=houmon-report-ai dev CA/O=houmon-report-ai (development only)",
    "-addext", "basicConstraints=critical,CA:TRUE",
    "-addext", "keyUsage=critical,keyCertSign,cRLSign",
  ]);
} else {
  console.log("開発用 CA は作成済み（certificates/rootCA.pem）。");
}

if (existsSync(cert) && existsSync(key) && !force) {
  console.log("サーバー証明書は作成済み。IP が変わったときは --force で作り直してください。");
} else {
  console.log(`サーバー証明書を作ります: IP ${ips.join(", ")} + localhost`);
  // Apple の要件に合わせる: RSA 2048 以上、SHA-256、SAN あり、EKU serverAuth、有効期間 398 日以内
  const san = ["DNS:localhost", "IP:127.0.0.1", "IP:::1", ...ips.map((ip) => `IP:${ip}`)].join(",");
  writeFileSync(
    ext,
    [
      "basicConstraints=CA:FALSE",
      "keyUsage=critical,digitalSignature,keyEncipherment",
      "extendedKeyUsage=serverAuth",
      `subjectAltName=${san}`,
      "",
    ].join("\n"),
  );
  run(["req", "-newkey", "rsa:2048", "-sha256", "-nodes", "-keyout", key, "-out", csr, "-subj", "/CN=houmon-report-ai dev server"]);
  run([
    "x509", "-req", "-in", csr, "-CA", caCert, "-CAkey", caKey, "-CAcreateserial", "-CAserial", srl,
    "-out", cert, "-days", "398", "-sha256", "-extfile", ext,
  ]);
  rmSync(csr, { force: true });
  rmSync(ext, { force: true });
}

const info = run(["x509", "-in", cert, "-noout", "-ext", "subjectAltName", "-enddate"]).toString();
console.log(info.trim());
console.log(`\n出来上がり:\n  CA:            ${caCert}（iPhone に入れて信頼する。鍵 rootCA-key.pem は外に出さない）\n  サーバー証明書: ${cert}\n  サーバー鍵:    ${key}\n\n起動: npm run dev:https → https://${ips[0]}:3000`);
if (!readFileSync(resolve(root, ".gitignore"), "utf8").includes("certificates/")) {
  console.warn("注意: .gitignore に certificates/ がありません。鍵をコミットしないよう追加してください。");
}

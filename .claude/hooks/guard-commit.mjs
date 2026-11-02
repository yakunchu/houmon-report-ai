#!/usr/bin/env node
/**
 * コミット / プッシュ前の安全検査（依存なし。Node だけで動く）。
 *
 * 起動形態
 *   A. Claude Code フック (PreToolUse, matcher=Bash|PowerShell): stdin の JSON を読み、
 *      tool_input.command が `git commit` / `git push` のときだけ検査する。
 *      違反は stderr に理由を出して終了コード 2（ブロック）。警告だけなら
 *      stdout に { "systemMessage": "..." } を出して終了コード 0。
 *   B. git pre-commit: 引数 --staged。stdin は読まず、commit 検査だけ行う。
 *      違反は stderr に理由を出して終了コード 1（git が中止）。
 *   C. git pre-push: 引数 --pre-push。stdin の「local_ref local_sha remote_ref remote_sha」行から
 *      push 対象の先端コミットを取り、push 検査だけ行う。違反は終了コード 1（git が中止）。
 *
 * commit 検査: .env 系のステージ / API キー形式 / fixtures の架空宣言（ブロック）、
 *              電話番号・郵便番号らしき文字列（警告のみ）
 * push 検査:   .env 系の追跡 / push 対象の履歴全体（HEAD または push する先端から辿れる全コミット）に
 *              含まれる API キー形式と .env 系ファイルの追加（ブロック）。
 *              後のコミットで消したキー・外した .env も、履歴に残っていれば止める。
 *              限界: 履歴の書き換え（filter-repo 等）で直すまでブロックされ続ける。
 *              正規表現検査なので、分割・エンコードされたキーは検出できない。
 *
 * 秘密の値そのものは出力しない（先頭 6 文字 + … に丸める）。
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const STAGED_MODE = process.argv.includes("--staged");
const PRE_PUSH_MODE = process.argv.includes("--pre-push");

// ---- パターン ---------------------------------------------------------------
const GIT_COMMIT_PUSH = /\bgit(?:\s+-[cC]\s+\S+)*\s+(commit|push)\b/g;
// `git commit -a` / `-am` / `--all` は未ステージの追跡ファイルも対象に含める
const COMMIT_ALL_FLAG = /\bgit\b[^|;&\n]*\bcommit\b[^|;&\n]*(?:\s-[A-Za-z]*a[A-Za-z]*\b|\s--all\b)/;
const PUSH_KEY_RE = /sk-ant-[A-Za-z0-9_-]{20,}/;
const KEY_PATTERNS = [
  { name: "API キー形式 (sk-ant-…)", re: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  // 値は英数字と _-. が 8 文字以上（説明文中の記述は誤検出しない）
  { name: "値入りの ANTHROPIC_API_KEY", re: /ANTHROPIC_API_KEY\s*=\s*["']?([A-Za-z0-9_.-]{8,})/ },
];
// 電話番号: 0 始まり・ハイフン可・数字 10〜11 桁。郵便番号: 〒 付き
const PHONE_RE = /(?<!\d)0\d{1,4}[-ー－]?\d{1,4}[-ー－]?\d{3,4}(?!\d)/g;
const POSTAL_RE = /〒\s*\d{3}[-ー－]?\d{4}/g;
const FIXTURE_TEXT_RE = /^fixtures\/.+\.(md|json|txt)$/i;
const FICTION_WORD = "架空";
// 数字列の誤検出が多いファイルは警告の対象外
const WARN_SKIP_RE = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|tsconfig\.tsbuildinfo)$/;

// ---- 補助 -------------------------------------------------------------------
/** 秘密の値は先頭 6 文字 + … に丸める */
function mask(value) {
  const v = String(value);
  return v.length <= 6 ? "…" : `${v.slice(0, 6)}…`;
}

function git(args, cwd, { allowStatus = [] } = {}) {
  try {
    return execFileSync("git", ["-c", "core.quotepath=false", ...args], {
      cwd,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    if (typeof e.status === "number" && allowStatus.includes(e.status)) return e.stdout?.toString() ?? "";
    throw e;
  }
}

function isEnvFile(path) {
  const name = basename(path);
  return /^\.env(\..+)?$/.test(name) && name !== ".env.example";
}

/** git diff -U0 の出力を { file, line, text } の追加行に展開する */
function parseAddedLines(diffText) {
  const out = [];
  let file = null;
  let newLine = 0;
  for (const raw of diffText.split("\n")) {
    if (raw.startsWith("+++ ")) {
      file = raw.startsWith("+++ b/") ? raw.slice(6) : null;
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) {
      newLine = Number(hunk[1]);
      continue;
    }
    if (file && raw.startsWith("+") && !raw.startsWith("+++")) {
      out.push({ file, line: newLine, text: raw.replace(/\r$/, "").slice(1) });
      newLine += 1;
    }
  }
  return out;
}

function hasHead(cwd) {
  try {
    git(["rev-parse", "--verify", "-q", "HEAD"], cwd);
    return true;
  } catch {
    return false;
  }
}

// ---- commit 検査 ------------------------------------------------------------
function checkCommit(cwd, { includeUnstaged }) {
  const blocks = [];
  const warns = [];

  // 検査対象: ステージ済み（-a / --all 付きなら追跡ファイルの未ステージ変更も）
  const sources = [{ cached: true }];
  if (includeUnstaged) sources.push({ cached: false });

  const textFiles = new Map(); // path -> ステージ済みから読むか
  const added = [];

  for (const src of sources) {
    const base = src.cached ? ["diff", "--cached"] : ["diff"];
    const names = git([...base, "--name-only", "--diff-filter=ACMR"], cwd)
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    // (a) .env 系のステージ
    for (const n of names) {
      if (isEnvFile(n)) {
        blocks.push(`${n}: .env 系のファイルがコミット対象に入っています。API キーは社長が手で書き、git には入れません（git rm --cached で外してください）`);
      }
      if (FIXTURE_TEXT_RE.test(n) && !textFiles.has(n)) textFiles.set(n, src.cached);
    }
    added.push(...parseAddedLines(git([...base, "-U0", "--no-color", "--diff-filter=ACMR"], cwd)));
  }

  // (b) 追加行の API キー形式
  for (const a of added) {
    for (const { name, re } of KEY_PATTERNS) {
      const m = re.exec(a.text);
      if (m) blocks.push(`${a.file}:${a.line}: ${name} を検出（${mask(m[1] ?? m[0])}）。コードや文書に書かず .env に置いてください`);
    }
  }

  // (c) fixtures の架空宣言（先頭 10 行に「架空」）
  for (const [path, staged] of textFiles) {
    let content = "";
    try {
      content = staged ? git(["show", `:${path}`], cwd) : readFileSync(resolve(cwd, path), "utf8");
    } catch {
      continue;
    }
    const head = content.replace(/^﻿/, "").split(/\r?\n/).slice(0, 10).join("\n");
    if (!head.includes(FICTION_WORD)) {
      blocks.push(`${path}:1: 先頭 10 行に「${FICTION_WORD}」の宣言がありません。fixtures は全て架空データです。先頭に「この台本は架空です」等を書いてください`);
    }
  }

  // (d) 電話番号・郵便番号らしきもの（警告のみ）
  for (const a of added) {
    if (WARN_SKIP_RE.test(a.file)) continue;
    for (const m of a.text.matchAll(PHONE_RE)) {
      const digits = m[0].replace(/\D/g, "");
      if (digits.length === 10 || digits.length === 11) {
        warns.push(`${a.file}:${a.line}: 電話番号らしき数字列（${mask(m[0])}）。実在の番号でないか確認してください`);
      }
    }
    for (const m of a.text.matchAll(POSTAL_RE)) {
      warns.push(`${a.file}:${a.line}: 郵便番号らしき文字列（${mask(m[0])}）。実在の住所でないか確認してください`);
    }
  }

  return { blocks, warns };
}

// ---- push 検査 --------------------------------------------------------------
/** 履歴を辿る起点（既定は HEAD。pre-push では push する先端のコミット） */
function checkPush(cwd, revs = ["HEAD"]) {
  const blocks = [];
  // (a) 現在 .env 系が追跡されている（サブディレクトリの .env.production 等も含む）
  const tracked = git(["ls-files"], cwd)
    .split("\n")
    .map((s) => s.trim())
    .filter((n) => n && isEnvFile(n));
  for (const t of tracked) {
    blocks.push(`${t}: .env 系のファイルが git に追跡されています。プッシュ前に git rm --cached で外し、履歴に残っていないか確認してください`);
  }
  if (!hasHead(cwd)) return { blocks, warns: [] };

  const starts = revs.filter((r) => r && !/^0+$/.test(r));
  if (starts.length === 0) return { blocks, warns: [] };

  // (b) 履歴全体の API キー形式。-G は「追加・削除された行」に一致するコミットを返す（一致なしは出力が空）
  const seen = new Set();
  const log = git(
    ["log", "--no-color", "-p", "-U0", "--format=commit:%h", `-G${PUSH_KEY_RE.source}`, ...starts, "--"],
    cwd,
  );
  let commit = "";
  let file = "";
  for (const raw of log.split("\n")) {
    if (raw.startsWith("commit:")) {
      commit = raw.slice(7).trim();
      file = "";
    } else if (raw.startsWith("+++ ")) {
      if (raw.startsWith("+++ b/")) file = raw.slice(6);
    } else if (raw.startsWith("--- ")) {
      if (raw.startsWith("--- a/")) file = raw.slice(6);
    } else if ((raw.startsWith("+") || raw.startsWith("-")) && commit) {
      const key = PUSH_KEY_RE.exec(raw);
      if (key && !seen.has(commit + file)) {
        seen.add(commit + file);
        blocks.push(
          `コミット ${commit} の ${file || "(ファイル不明)"} に API キー形式を検出（${mask(key[0])}）。後のコミットで消していても履歴に残るため、履歴から除去してからプッシュしてください`,
        );
      }
    }
  }

  // (c) 履歴のどこかで追加された .env 系ファイル
  const names = git(["log", "--no-color", "--diff-filter=A", "--name-only", "--format=commit:%h", ...starts, "--"], cwd);
  commit = "";
  for (const raw of names.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("commit:")) commit = line.slice(7);
    else if (isEnvFile(line)) {
      blocks.push(`コミット ${commit} で ${line} が追加されています（現在は外していても履歴に残ります）。履歴から除去してからプッシュしてください`);
    }
  }
  return { blocks, warns: [] };
}

// ---- 入口 -------------------------------------------------------------------
function readStdinJson() {
  try {
    const text = readFileSync(0, "utf8").replace(/^﻿/, "");
    return text.trim() ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

function main() {
  let cwd = process.cwd();
  const kinds = new Set();
  let includeUnstaged = false;

  let pushRevs = ["HEAD"];

  if (STAGED_MODE) {
    kinds.add("commit");
  } else if (PRE_PUSH_MODE) {
    kinds.add("push");
    // git が渡す行: <local ref> <local sha> <remote ref> <remote sha>。削除 push（sha が全 0）は対象外
    const text = readFileSync(0, "utf8");
    const shas = text
      .split(/\r?\n/)
      .map((l) => l.trim().split(/\s+/)[1])
      .filter((v) => v && !/^0+$/.test(v));
    if (shas.length > 0) pushRevs = shas;
    else if (text.trim()) return 0;
  } else {
    const input = readStdinJson();
    const command = input?.tool_input?.command;
    if (typeof command !== "string") return 0;
    for (const m of command.matchAll(GIT_COMMIT_PUSH)) kinds.add(m[1]);
    if (kinds.size === 0) return 0;
    // cwd が存在しない形式（別環境のパス表記など）のときは process.cwd() のまま
    if (typeof input.cwd === "string" && input.cwd && existsSync(input.cwd)) cwd = input.cwd;
    includeUnstaged = kinds.has("commit") && COMMIT_ALL_FLAG.test(command);
  }

  const blocks = [];
  const warns = [];
  if (kinds.has("commit")) {
    const r = checkCommit(cwd, { includeUnstaged });
    blocks.push(...r.blocks);
    warns.push(...r.warns);
  }
  if (kinds.has("push")) {
    blocks.push(...checkPush(cwd, pushRevs).blocks);
  }

  if (blocks.length > 0) {
    const action = kinds.has("push") && !kinds.has("commit") ? "プッシュ" : "コミット";
    const lines = [
      `【guard-commit】${action}を止めました。次を直してからやり直してください。`,
      ...blocks.map((b) => `  x ${b}`),
      ...(warns.length ? ["警告（ブロックはしません）:", ...warns.map((w) => `  ! ${w}`)] : []),
    ];
    process.stderr.write(lines.join("\n") + "\n");
    return STAGED_MODE || PRE_PUSH_MODE ? 1 : 2;
  }

  if (warns.length > 0) {
    const text = ["【guard-commit 警告】", ...warns.map((w) => `  ! ${w}`)].join("\n");
    if (STAGED_MODE || PRE_PUSH_MODE) {
      process.stderr.write(text + "\n");
    } else {
      // exit 0 のとき stdout は JSON のみ（公式の出力仕様）
      process.stdout.write(JSON.stringify({ systemMessage: text }) + "\n");
    }
  }
  return 0;
}

try {
  process.exitCode = main();
} catch (e) {
  // 検査できない場合は安全側（ブロック）に倒す。秘密の値は含めない
  process.stderr.write(`【guard-commit】検査中にエラーが発生したため止めました: ${e?.message ?? e}\n`);
  process.exitCode = STAGED_MODE || PRE_PUSH_MODE ? 1 : 2;
}

#!/usr/bin/env node
/**
 * .env 系ファイルの読み書きをブロックする（終了コード 2）。stdin に PreToolUse の JSON が渡される。
 *
 * 対象ツール
 *   - Edit / Write / Read: tool_input.file_path の末尾名が .env / .env.* （.env.example は除く）
 *   - Bash / PowerShell:   tool_input.command が .env 系を参照している（cat / Get-Content / リダイレクト / node -e 等）
 *     ただし git の rm --cached / ls-files / check-ignore / status だけの区間は許可（追跡解除の案内に必要）
 * 判定は guard-commit.mjs の isEnvFile（/^\.env(\..+)?$/ かつ .env.example 以外）に揃える。
 * 正規表現による簡易検査なので、変数経由の組み立て（$f=".e"+"nv"）などは防げない。多層防御の 1 枚。
 */
import { readFileSync } from "node:fs";

function readStdinJson() {
  try {
    const text = readFileSync(0, "utf8").replace(/^﻿/, "");
    return text.trim() ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

/** guard-commit.mjs の isEnvFile と同じ判定（末尾名のみ） */
function isEnvName(name) {
  return /^\.env(\..+)?$/.test(name) && name !== ".env.example";
}

/** コマンド中の .env 系トークン（区切りは空白・引用符・パス区切り・リダイレクト等）。.env.example は除く */
const ENV_TOKEN = /(?:^|[\s"'`\\/=<>|;&(,:])(\.env(?:\.[\w.-]+)?)(?=$|[\s"'`;|&)<>,])/g;
/** 参照だけで内容を読まない git サブコマンド */
const SAFE_GIT = /^\s*git(?:\s+-[cC]\s+\S+)*\s+(?:rm\s+(?:-\S+\s+)*--cached|ls-files|check-ignore|status)\b/;

function commandTouchesEnv(command) {
  // ; && || | 改行で区間に分け、.env を含む区間がすべて安全な git 操作なら許可
  for (const raw of command.split(/;|&&|\|\||\||\r?\n/)) {
    // git commit のメッセージ文字列（-m "..."）は検査対象から外す（説明文に .env と書くだけで止めない）
    const seg = /^\s*git\b[^\n]*\bcommit\b/.test(raw)
      ? raw.replace(/\s(?:-[A-Za-z]*m|--message)(?:\s+|=)(?:"[^"]*"|'[^']*')/g, " ")
      : raw;
    const hits = [...seg.matchAll(ENV_TOKEN)].map((m) => m[1]);
    if (!hits.some((h) => isEnvName(h))) continue;
    if (!SAFE_GIT.test(seg)) return hits.find((h) => isEnvName(h));
  }
  return null;
}

const input = readStdinJson();
const ti = input?.tool_input ?? {};
let hit = null;
let action = "編集";

if (typeof ti.file_path === "string" && ti.file_path) {
  // Windows / POSIX どちらの区切りでも末尾の名前を取る
  const name = ti.file_path.split(/[\\/]/).pop() ?? "";
  if (isEnvName(name)) hit = name;
  if (input.tool_name === "Read") action = "読み取り";
} else if (typeof ti.command === "string" && ti.command) {
  hit = commandTouchesEnv(ti.command);
  action = "参照";
}

if (hit) {
  process.stderr.write(
    `【guard-env】${hit} の${action}を止めました。API キーは社長が手で書く。Claude は .env を読まない・編集しない（会話記録にキーが残るため）。キーの置き場所は .env.example を参照\n`,
  );
  process.exit(2);
}
process.exit(0);

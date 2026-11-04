/**
 * 評価スクリプト: 架空台本から下書きを作り、見本（expected.json）と欄ごとに比較する。
 *
 *   npm run eval                      # API を 1 回呼ぶ（費用あり）
 *   npm run eval -- --dry-run         # API を呼ばず、送る内容の要約だけ表示
 *   npm run eval -- --new-patient     # 基本情報（頻度・調剤形態・管理者・方法・家族）を空にして送る（新しい患者の想定）
 *   npm run eval -- --recipient=医療機関 --fixture=fixtures/yamamoto-hanako --note=メモ
 *
 * 結果は eval-results/ に JSON で保存し、history.md に 1 行追記する（--dry-run では何も保存しない）。
 * 「基本情報の提案」の表は参考表示で、合格判定（終了コード）には使わない。
 * 実在の患者データは使わない。fixtures は架空データ。
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { z } from "zod";
import { getModelConfig } from "../src/lib/claude/client";
import { REPORT_RULES } from "../src/lib/prompt/rules.generated";
import { draftReport } from "../src/lib/report/draft";
import { buildUserMessage } from "../src/lib/report/prompt";
import {
  checkEvidence,
  checkQuotes,
  compareDraft,
  compareSuggestions,
  summarize,
  type CompareRow,
  type SuggestionRow,
} from "../src/lib/report/compare";
import { EVIDENCE_LABELS, listUnsureFields } from "../src/lib/report/fields";
import {
  BasicInfoSuggestionsSchema,
  RECIPIENT_TYPES,
  ReportDraftSchema,
  UNSURE,
  type DraftContext,
  type DraftRequest,
  type RecipientType,
} from "../src/lib/report/schema";

const MASK_TOKEN = "【患者A】";

// ---------- 引数 ----------
type Args = { recipient: RecipientType; dryRun: boolean; fixture: string; note: string; newPatient: boolean };

function parseArgs(argv: string[]): Args {
  const args: Args = { recipient: "ケアマネ", dryRun: false, fixture: "fixtures/yamamoto-hanako", note: "", newPatient: false };
  for (const a of argv) {
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--new-patient") args.newPatient = true;
    else if (a.startsWith("--recipient=")) {
      const v = a.slice("--recipient=".length);
      if (!(RECIPIENT_TYPES as readonly string[]).includes(v)) {
        throw new Error(`--recipient は ${RECIPIENT_TYPES.join("|")} のどれかを指定してください（指定値: ${v}）`);
      }
      args.recipient = v as RecipientType;
    } else if (a.startsWith("--fixture=")) args.fixture = a.slice("--fixture=".length);
    else if (a.startsWith("--note=")) args.note = a.slice("--note=".length);
    else throw new Error(`知らない引数です: ${a}`);
  }
  return args;
}

// ---------- フィクスチャ読み込み ----------
const ProfileSchema = z.object({
  patient: z.object({ name: z.string(), kana: z.string() }),
  family: z.string(),
  visitFrequency: z.object({ choice: z.string(), note: z.string() }),
  dispensingForm: z.string(),
  currentMedicationManager: z.string(),
  currentManagementMethod: z.string(),
  prescription: z.object({
    items: z.array(z.object({ drug: z.string(), dose: z.string(), usage: z.string(), days: z.string() })),
    concomitant: z.string(),
  }),
});
type Profile = z.infer<typeof ProfileSchema>;

/** 台本の発話行（「- 薬剤師：…」）だけを取り出す。見出しや注意書きは送らない */
function extractConversation(markdown: string): string {
  const lines = markdown
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.match(/^\s*[-*]\s*(.+?[：:].*)$/)?.[1])
    .filter((l): l is string => !!l);
  return lines.length > 0 ? lines.join("\n") : markdown.trim();
}

/**
 * profile → DraftContext。処方医名・医療機関名・患者名・宛先名は入れない。
 * newPatient のときは基本情報 5 項目を空にする（新しい患者の登録＝提案が埋まるかを見る。処方内容は残す）
 */
function buildContext(p: Profile, newPatient: boolean): DraftContext {
  const vf = p.visitFrequency;
  const lines = p.prescription.items.map((i) => `${i.drug} ${i.dose} ${i.usage} ${i.days}`);
  lines.push(`併用薬: ${p.prescription.concomitant}`);
  if (newPatient) {
    return {
      visitFrequency: "",
      dispensingForm: "",
      currentMedicationManager: "",
      currentManagementMethod: "",
      family: "",
      prescription: lines.join("\n"),
    };
  }
  return {
    visitFrequency: vf.note ? `${vf.choice}（${vf.note}）` : vf.choice,
    dispensingForm: p.dispensingForm,
    currentMedicationManager: p.currentMedicationManager,
    currentManagementMethod: p.currentManagementMethod,
    family: p.family,
    prescription: lines.join("\n"),
  };
}

/** 簡易マスク（本格版は src/lib/mask。ここでは依存しない）。長い語から置換する */
function nameParts(p: Profile["patient"]): { family: string; given: string; terms: string[] } {
  const [family = "", given = ""] = p.name.trim().split(/[\s　]+/);
  const [kanaFamily = "", kanaGiven = ""] = p.kana.trim().split(/[\s　]+/);
  const terms = [
    `${family} ${given}`,
    `${family}　${given}`,
    `${family}${given}`,
    `${kanaFamily} ${kanaGiven}`,
    `${kanaFamily}　${kanaGiven}`,
    `${kanaFamily}${kanaGiven}`,
    p.kana,
    family,
    given,
    kanaFamily,
    kanaGiven,
  ].filter((t) => t.trim() !== "");
  return { family, given, terms: [...new Set(terms)].sort((a, b) => b.length - a.length) };
}

function simpleMask(text: string, p: Profile["patient"]): string {
  let out = text;
  for (const t of nameParts(p).terms) out = out.replaceAll(t, MASK_TOKEN);
  return out;
}

function assertNoName(text: string, p: Profile["patient"], where: string): void {
  const { family, given } = nameParts(p);
  for (const n of [family, given]) {
    if (n && text.includes(n)) throw new Error(`${where} に患者の姓または名が残っています。送信を中止しました`);
  }
}

// ---------- 表示用 ----------
function cell(s: string): string {
  return (s === "" ? "—" : s).replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

function judge(r: CompareRow | SuggestionRow): string {
  const parts: string[] = [];
  if (r.match !== null) parts.push(r.match ? "○一致" : "×不一致");
  if (r.similarity !== null) parts.push(`類似度 ${r.similarity.toFixed(2)}`);
  return parts.join(" / ");
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function timestamp(d: Date): { file: string; text: string } {
  const ymd = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const hms = `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return {
    file: `${ymd}-${hms}`,
    text: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

// ---------- 本体 ----------
async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const root = process.cwd();
  const dir = resolve(root, args.fixture);
  const fixtureName = basename(dir);

  const profile = ProfileSchema.parse(JSON.parse(readFileSync(resolve(dir, "profile.json"), "utf8")));
  const expectedJson: unknown = JSON.parse(readFileSync(resolve(dir, "expected.json"), "utf8"));
  // 提案の見本は任意（無い古い見本でも動く）。合格ラインの比較（compareDraft）には含めない
  const expected = ReportDraftSchema.omit({ evidence: true, basicInfoSuggestions: true }).parse(expectedJson);
  const expectedSuggestions =
    typeof expectedJson === "object" && expectedJson !== null && "basicInfoSuggestions" in expectedJson
      ? BasicInfoSuggestionsSchema.parse((expectedJson as { basicInfoSuggestions: unknown }).basicInfoSuggestions)
      : null;
  const rawTranscript = extractConversation(readFileSync(resolve(dir, "transcript.md"), "utf8"));

  const transcript = simpleMask(rawTranscript, profile.patient);
  assertNoName(transcript, profile.patient, "マスク後の会話");
  const context = buildContext(profile, args.newPatient);
  const request: DraftRequest = { recipientType: args.recipient, transcript, context };
  const userMessage = buildUserMessage(request);
  assertNoName(userMessage, profile.patient, "送信するメッセージ");
  const { model, effort } = getModelConfig();

  const requestSummary = {
    fixture: fixtureName,
    recipientType: args.recipient,
    newPatient: args.newPatient,
    systemChars: REPORT_RULES.length,
    userMessageChars: userMessage.length,
    transcriptChars: transcript.length,
    maskedTokenCount: transcript.split(MASK_TOKEN).length - 1,
    context,
    model,
    effort,
  };

  if (args.dryRun) {
    console.log("# dry-run（API は呼びません）\n");
    console.log(
      `- フィクスチャ: ${fixtureName} / 宛先: ${args.recipient} / 新しい患者モード: ${args.newPatient ? "あり（基本情報 5 項目を空で送る）" : "なし"}`,
    );
    console.log(`- model: ${model} / effort: ${effort}`);
    console.log(`- system: ${requestSummary.systemChars} 文字（cache_control: ephemeral）`);
    console.log(`- ユーザーメッセージ: ${requestSummary.userMessageChars} 文字`);
    console.log(`- 会話テキスト（マスク後）: ${requestSummary.transcriptChars} 文字 / ${MASK_TOKEN} への置換 ${requestSummary.maskedTokenCount} 箇所`);
    console.log("- 患者の姓・名の残存: なし（確認済み）\n");
    console.log("## ユーザーメッセージの「基本情報」の節\n");
    console.log("```");
    const basic = userMessage.split("\n## ").find((s) => s.startsWith("基本情報"));
    console.log(basic ? `## ${basic.trimEnd()}` : userMessage.slice(0, 300));
    console.log("```");
    return 0;
  }

  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    console.error(".env に ANTHROPIC_API_KEY を書いてください");
    return 1;
  }

  console.error(`API を 1 回呼びます（model=${model}, effort=${effort}）...`);
  const res = await draftReport(request);
  const now = new Date();
  const ts = timestamp(now);
  mkdirSync(resolve(root, "eval-results"), { recursive: true });
  const stem = `${ts.file}-${model.replace(/[^\w.-]/g, "_")}-${effort}`;

  if (!res.ok) {
    console.error(`失敗: ${res.error} / ${res.message}`);
    writeFileSync(
      resolve(root, "eval-results", `${stem}.json`),
      JSON.stringify({ request: requestSummary, response: res }, null, 2) + "\n",
      "utf8",
    );
    appendHistory(root, `| ${ts.text} | ${model} | ${effort} | — | — | — | — | 失敗: ${res.error} ${args.note} |`);
    return 1;
  }

  const actual = res.draft;
  const rows = compareDraft(expected, actual);
  const sum = summarize(rows);
  const suggestionRows = expectedSuggestions ? compareSuggestions(expectedSuggestions, actual.basicInfoSuggestions) : null;
  const sQuotes = checkQuotes(actual.soap.s, transcript);
  const evQuotes = checkEvidence(actual.evidence, transcript);
  const nameLeak = (() => {
    try {
      assertNoName(JSON.stringify(actual), profile.patient, "下書き");
      return false;
    } catch {
      return true;
    }
  })();
  const unsure = [
    ...listUnsureFields(actual).map((f) => f.label),
    ...(actual.mealsPerDay.value === UNSURE ? ["食事・回数"] : []),
    ...actual.leftoverMedications.filter((m) => m.amount === UNSURE).map((m) => `残薬・${m.drugName}（残数）`),
  ];

  // --- 標準出力: Markdown ---
  console.log(`# 評価結果 ${ts.text}（${fixtureName} / 宛先 ${args.recipient}）\n`);
  console.log("| 欄 | 見本 | 実際 | 一致 / 類似度 |");
  console.log("|---|---|---|---|");
  for (const r of rows) console.log(`| ${cell(r.label)} | ${cell(r.expected)} | ${cell(r.actual)} | ${judge(r)} |`);

  console.log(`\n## 選択式一致率\n\n${sum.matched}/${sum.total}（${Math.round(sum.rate * 100)}%）` + (sum.mismatched.length ? ` 不一致: ${sum.mismatched.join("、")}` : ""));

  console.log("\n## 基本情報の提案（参考。合格判定には使わない）\n");
  if (suggestionRows) {
    console.log("| 欄 | 見本 | 実際 | 一致 / 類似度 |");
    console.log("|---|---|---|---|");
    for (const r of suggestionRows) console.log(`| ${cell(r.label)} | ${cell(r.expected)} | ${cell(r.actual)} | ${judge(r)} |`);
  } else {
    const s = actual.basicInfoSuggestions;
    const withNote = (c: string, n: string) => (n ? `${c}（${n}）` : c);
    console.log("- この見本には basicInfoSuggestions がありません（実際の提案のみ表示）");
    console.log(
      `- 訪問頻度: ${withNote(s.visitFrequency.choice, s.visitFrequency.note)} / 調剤形態: ${withNote(s.dispensingForm.choice, s.dispensingForm.note)} / 家族: ${s.family || "—"}`,
    );
  }

  console.log("\n## S の引用の実在");
  for (const q of sQuotes) console.log(`- ${q.found ? "○ あり" : "× なし"}: 「${q.quote}」`);
  if (sQuotes.length === 0) console.log("- × 引用なし（S が空、または引用にできる文字がありません）");

  console.log("\n## evidence の実在");
  for (const q of evQuotes) console.log(`- ${q.found ? "○ あり" : "× なし"} [${EVIDENCE_LABELS[q.key]}]: ${q.quote}`);
  if (evQuotes.length === 0) console.log("- 根拠の引用なし");

  console.log(`\n## 要確認の欄\n\n${unsure.length ? unsure.map((u) => `- ${u}`).join("\n") : "- なし"}`);
  console.log(`\n## 氏名の混入\n\n${nameLeak ? "× 下書きに患者の姓または名が含まれています" : "○ なし"}`);

  const sec = (res.elapsedMs / 1000).toFixed(1);
  const u = res.usage;
  console.log(`\n## 実行情報\n\n- model: ${res.model} / effort: ${effort}\n- 所要: ${sec} 秒`);
  console.log(`- usage: input ${u.inputTokens} / output ${u.outputTokens} / cache read ${u.cacheReadInputTokens} / cache creation ${u.cacheCreationInputTokens}`);

  // --- 保存 ---
  writeFileSync(
    resolve(root, "eval-results", `${stem}.json`),
    JSON.stringify({ request: requestSummary, response: res, comparison: { rows, summary: sum, suggestions: { expected: expectedSuggestions, actual: actual.basicInfoSuggestions, rows: suggestionRows }, sQuotes, evidenceQuotes: evQuotes, unsure, nameLeak } }, null, 2) + "\n",
    "utf8",
  );
  const sFound = `${sQuotes.filter((q) => q.found).length}/${sQuotes.length}${sQuotes.length === 0 ? " (S空)" : ""}`;
  const memo = [`宛先=${args.recipient}`, `fixture=${fixtureName}`, args.newPatient ? "new-patient" : "", args.note].filter(Boolean).join(" ").replace(/\|/g, "/");
  appendHistory(
    root,
    `| ${ts.text} | ${model} | ${effort} | ${sum.matched}/${sum.total} (${Math.round(sum.rate * 100)}%) | ${sFound} | ${sec} | ${u.inputTokens}/${u.outputTokens} | ${memo} |`,
  );
  console.error(`\n保存しました: eval-results/${stem}.json と eval-results/history.md`);
  // S の引用が 0 件のときも不合格（every([]) は true になるため長さを別に見る）
  const sOk = sQuotes.length > 0 && sQuotes.every((q) => q.found);
  if (sQuotes.length === 0) console.error("警告: S が空、または引用がありません（不合格扱い）");
  return sum.rate === 1 && sOk && !nameLeak ? 0 : 2;
}

/** history.md に 1 行追記。無ければ見出し行から作る */
function appendHistory(root: string, row: string): void {
  const file = resolve(root, "eval-results", "history.md");
  if (!existsSync(file)) {
    writeFileSync(
      file,
      "# 評価履歴\n\n`npm run eval` の実行ごとに 1 行追記されます。\n\n" +
        "| 日時 | model | effort | 選択式一致率 | S引用 | 所要秒 | in/out tokens | メモ |\n" +
        "|---|---|---|---|---|---|---|---|\n",
      "utf8",
    );
  }
  appendFileSync(file, row + "\n", "utf8");
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    // 本文やキーは出さない。メッセージのみ
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  },
);

/**
 * prompts/report-rules.md（正本）から src/lib/prompt/rules.generated.ts を生成する。
 * npm run gen:prompt / predev / prebuild で実行される。生成物は手で編集しない。
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const source = resolve(root, "prompts/report-rules.md");
const outDir = resolve(root, "src/lib/prompt");
const outFile = resolve(outDir, "rules.generated.ts");

const markdown = readFileSync(source, "utf8").replace(/\r\n/g, "\n");

const banner =
  "// 自動生成ファイル。正本は prompts/report-rules.md。変更はそちらで行い `npm run gen:prompt` を実行する。\n";
const body = `export const REPORT_RULES: string = ${JSON.stringify(markdown)};\n`;

mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, banner + body, "utf8");
console.log(`generated ${outFile} (${markdown.length} chars)`);

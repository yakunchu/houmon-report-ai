/**
 * 貼り付けた文字を会話欄に足す。
 * - 欄が空なら置き換え、既に文章があれば空行を 1 つ挟んで後ろに足す（ボイスメモの文字起こしを何回かに分けて貼れる）
 * - 改行コードは \n にそろえ、前後の空白は落とす。貼る文字が空なら何も変えない
 */
export function appendTranscript(existing: string, pasted: string): string {
  const add = pasted.replace(/\r\n?/g, "\n").trim();
  if (add === "") return existing;
  const base = existing.trimEnd();
  return base === "" ? add : `${base}\n\n${add}`;
}

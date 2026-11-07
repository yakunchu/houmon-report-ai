"use client";
/**
 * 訪問時の想定問答集（読み上げ用）。データは src/lib/interview/script.ts から描画する（文言はここに書き写さない）。
 * 印刷時はリンクとボタンを隠し、カードの枠を薄くして 1 ページに 8 手順くらい入る密度にする。
 */
import Link from "next/link";
import { Button } from "@/components/ui";
import { INTERVIEW_INTRO, INTERVIEW_STEPS, INTERVIEW_TIPS } from "@/lib/interview/script";

const USAGE: readonly string[] = [
  "①で患者を選び、②の「録音して文字起こし」を押す（またはボイスメモで録音を始める）。iPhone はカバンに入れたままでよい。",
  "下の順番で質問し、答えを自分の声で言い直す（「〜ですね」）。数字は単位つき、本人の言葉は『 』で方言のまま。",
  "「以上で終わります」まで言って録音を止める。文字起こしが②の会話欄に入る（ボイスメモなら「文字起こしをコピー」→「クリップボードから貼り付け」）。",
  "「個人名を見えないようマスク処理する」→「下書きを作る」。下書きを確認して直す。",
];

export function InterviewGuide() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-6 text-lg text-ink print:max-w-none print:px-0 print:py-0">
      <style>{`@media print { @page { size: A4; margin: 10mm; } html { font-size: 10pt; } }`}</style>

      <div className="mb-4 flex flex-wrap items-center gap-3 print:hidden">
        <Link
          href="/"
          className="inline-flex min-h-12 items-center rounded-xl border-2 border-ink-muted bg-raised px-5 py-2 text-lg font-bold text-ink hover:bg-surface focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-hanada"
        >
          ← アプリに戻る
        </Link>
        <Button variant="primary" onClick={() => window.print()}>
          印刷する
        </Button>
      </div>

      <h1 className="font-display text-3xl font-bold leading-snug print:text-2xl">訪問時の想定問答集（読み上げ用）</h1>
      <p className="mt-3 print:mt-1">{INTERVIEW_INTRO}</p>

      <section className="mt-5 rounded-xl border border-line bg-raised p-4 print:mt-2 print:p-2" aria-labelledby="usage-h">
        <h2 id="usage-h" className="font-display text-2xl font-bold print:text-xl">
          使い方
        </h2>
        <ol className="mt-2 list-decimal space-y-2 pl-6 print:space-y-0">
          {USAGE.map((u) => (
            <li key={u}>{u}</li>
          ))}
        </ol>
      </section>

      <ol className="mt-6 space-y-4 print:mt-3 print:space-y-1">
        {INTERVIEW_STEPS.map((s) => (
          <li
            key={s.no}
            className="rounded-xl border border-line bg-raised p-4 print:break-inside-avoid print:rounded-md print:border-line/60 print:p-2"
          >
            <div className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-ai text-xl font-bold text-on-ai print:h-8 print:w-8 print:text-base"
              >
                {s.no}
              </span>
              <h2 className="font-display text-2xl font-bold leading-snug print:text-lg">
                <span className="sr-only">手順{s.no}　</span>
                {s.title}
              </h2>
            </div>
            <ul className="mt-2 flex flex-wrap gap-2 print:mt-1 print:gap-1" aria-label="対応する報告書の欄">
              {s.fields.map((f) => (
                <li
                  key={f}
                  className="rounded-full border border-ai bg-shiroai px-3 py-0.5 text-base font-bold text-ai print:px-2 print:py-0 print:text-sm"
                >
                  {f}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xl font-bold leading-relaxed print:mt-1 print:text-base">
              <span className="sr-only">聞く言葉: </span>
              {s.ask}
            </p>
            <p className="mt-3 text-base font-bold text-ink-muted print:mt-1 print:text-sm">言い直す型（◯ に数や言葉）</p>
            <ul className="list-disc space-y-1 pl-6 print:space-y-0">
              {s.echo.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
            <p className="mt-3 text-ink-muted print:mt-1">
              <span className="font-bold">例: </span>
              {s.example}
            </p>
            {s.tip ? (
              <p className="mt-2 text-ink-muted print:mt-1">
                <span className="font-bold">注意: </span>
                {s.tip}
              </p>
            ) : null}
          </li>
        ))}
      </ol>

      <section className="mt-6 rounded-xl border border-line bg-raised p-4 print:mt-3 print:break-inside-avoid print:p-2" aria-labelledby="tips-h">
        <h2 id="tips-h" className="font-display text-2xl font-bold print:text-xl">
          録音と言い方の運用
        </h2>
        <ul className="mt-2 list-disc space-y-2 pl-6 print:space-y-0">
          {INTERVIEW_TIPS.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}

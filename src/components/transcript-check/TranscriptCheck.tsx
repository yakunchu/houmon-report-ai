"use client";
/**
 * 文字起こしの精度を確かめる画面（/transcript-check）。
 * 架空台本を読み上げて録音し、ボイスメモとショートカットの文字起こしを貼ると、正解（台本）との一致率を端末内で計算する。
 * 入力はどこにも送らない。患者データは扱わない。
 */
import { useMemo, useState, type ReactNode } from "react";
import { PasteButton } from "@/components/PasteButton";
import { Button, inputClass } from "@/components/ui";
import { compareTranscript, type AlignSegment, type CerResult } from "@/lib/transcript-check/cer";
import { READING_LINES, READING_TEXT } from "@/lib/transcript-check/script";
import { copyText } from "@/lib/ui/clipboard";

type Slot = { key: "a" | "b"; label: string; hint: string };

const SLOTS: Slot[] = [
  { key: "a", label: "A: ボイスメモの文字起こし", hint: "ボイスメモで録音 → 「…」→「文字起こしをコピー」→ ここに貼る" },
  { key: "b", label: "B: ショートカットの文字起こし", hint: "ショートカットで録音 → 文字起こし → クリップボードにコピー → ここに貼る" },
];

function percent(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

/** 位置合わせを、色だけに頼らず文字で分かる形で表示する */
function Diff({ segments }: { segments: AlignSegment[] }) {
  return (
    <p className="mt-2 rounded-xl border-2 border-line bg-raised p-3 leading-9 break-words">
      {segments.map((s, i) => {
        if (s.op === "equal") return <span key={i}>{s.hyp}</span>;
        if (s.op === "sub")
          return (
            <span key={i}>
              <span className="rounded bg-shiroai px-0.5 font-bold text-akane underline decoration-2">{s.hyp}</span>
              <span className="text-ink-muted">（正: {s.ref}）</span>
            </span>
          );
        if (s.op === "ins") return <span key={i} className="font-bold text-akane">〔余分 {s.hyp}〕</span>;
        return <span key={i} className="font-bold text-akane">〔抜け {s.ref}〕</span>;
      })}
    </p>
  );
}

function Result({ r }: { r: CerResult }) {
  return (
    <div className="mt-3" role="status" aria-live="polite">
      <p className="text-2xl font-bold text-ink">
        一致率 {percent(r.accuracy)}
        <span className="ml-3 text-base font-normal text-ink-muted">（文字誤り率 {percent(r.cer)}）</span>
      </p>
      <p className="mt-1 text-ink">
        正解 {r.refLength} 字に対して入力 {r.hypLength} 字。違う文字 {r.sub}、余分 {r.ins}、抜け {r.del}（合計 {r.distance}）。
      </p>
      <details className="mt-2">
        <summary className="flex min-h-12 cursor-pointer items-center font-bold text-ai">違いを見る</summary>
        <p className="mt-2 text-base text-ink-muted">
          下線＝正解と違う文字（括弧内が正解）。〔余分〕＝正解に無い文字。〔抜け〕＝正解にあって文字起こしに無い文字。句読点・空白・全角半角の違いは数えていません。
        </p>
        <Diff segments={r.segments} />
      </details>
    </div>
  );
}

function Card({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-raised p-4 sm:p-6">
      <h2 className="mb-3 font-display text-2xl font-bold text-ink">{title}</h2>
      {children}
    </section>
  );
}

export function TranscriptCheck() {
  const [texts, setTexts] = useState<Record<"a" | "b", string>>({ a: "", b: "" });
  const [copied, setCopied] = useState<string | null>(null);

  // 片方を打ち直しても、もう片方を計算し直さない
  const resultA = useMemo(() => (texts.a.trim() === "" ? null : compareTranscript(READING_TEXT, texts.a)), [texts.a]);
  const resultB = useMemo(() => (texts.b.trim() === "" ? null : compareTranscript(READING_TEXT, texts.b)), [texts.b]);
  const results = { a: resultA, b: resultB };

  async function copyScript(): Promise<void> {
    // http の LAN 接続では navigator.clipboard が使えないので、予備手段つきの copyText を使う
    const how = await copyText(READING_TEXT);
    setCopied(
      how === "failed"
        ? "コピーできませんでした。台本は画面で読めるので、コピーは必須ではありません。"
        : "台本（せりふだけ）をコピーしました。",
    );
  }

  const both = results.a && results.b ? { a: results.a, b: results.b } : null;

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 text-lg text-ink">
      <p className="rounded-xl border-2 border-akane bg-raised p-3 font-bold">
        <span aria-hidden="true">⚠ </span>
        架空の台本だけを使ってください。貼り付けた文字起こしは、この画面の中で台本と比べるだけで、どこにも送りません。
      </p>

      <h1 className="mt-5 font-display text-3xl font-bold text-ai">文字起こしの精度を確かめる</h1>
      <p className="mt-2">
        同じ台本を同じ場所で読み上げ、ボイスメモとショートカットの文字起こしを貼ると、台本（正解）との一致率を比べられます。
      </p>

      <Card title="使い方">
        <ol className="list-decimal space-y-2 pl-6">
          <li>下の台本を、ボイスメモで録音しながら声に出して読む（2 分弱）。薬剤師と患者の両方を読んでよい。</li>
          <li>録音を止め、ボイスメモで「…」→「文字起こしをコピー」。この画面の A に貼る。</li>
          <li>同じ台本を、ショートカット（オーディオを録音 → オーディオを文字起こし → クリップボードにコピー）でも試し、B に貼る。</li>
          <li>一致率を比べる。<strong>機内モードにして試せば、文字起こしが端末内で動くかも分かる</strong>（機内モードで動かなければ、その方法は使わない）。</li>
        </ol>
      </Card>

      <div className="mt-4">
        <Card title="読み上げる台本（架空患者 山本花子さん）">
          <ol className="space-y-3">
            {READING_LINES.map((l, i) => (
              <li key={i} className="rounded-xl bg-surface p-3">
                <span className="mr-2 inline-block rounded-md bg-ai px-2 py-0.5 text-base font-bold text-on-ai">{l.speaker}</span>
                <span className="text-xl leading-9">{l.text}</span>
              </li>
            ))}
          </ol>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button onClick={copyScript}>台本をコピー（せりふだけ）</Button>
            {copied ? <span role="status">{copied}</span> : null}
          </div>
        </Card>
      </div>

      {SLOTS.map((slot) => {
        const r = results[slot.key];
        return (
          <div key={slot.key} className="mt-4">
            <Card title={slot.label}>
              <p className="mb-2 text-base text-ink-muted">{slot.hint}</p>
              <div className="mb-2">
                <PasteButton onPaste={(t) => setTexts((prev) => ({ ...prev, [slot.key]: t }))} />
              </div>
              <textarea
                className={`${inputClass} min-h-40`}
                aria-label={slot.label}
                placeholder="文字起こしをここに貼り付け"
                value={texts[slot.key]}
                onChange={(e) => setTexts((prev) => ({ ...prev, [slot.key]: e.target.value }))}
              />
              {r ? <Result r={r} /> : <p className="mt-2 text-ink-muted">貼り付けると、台本との一致率が出ます。</p>}
            </Card>
          </div>
        );
      })}

      {both ? (
        <div className="mt-4 rounded-xl border-2 border-ai bg-shiroai p-4" role="status" aria-live="polite">
          <p className="text-xl font-bold">
            A（ボイスメモ）{percent(both.a.accuracy)} ／ B（ショートカット）{percent(both.b.accuracy)}
          </p>
          <p className="mt-1">
            {both.a.distance === both.b.distance
              ? "誤りの数は同じでした。"
              : both.a.distance < both.b.distance
                ? `A の方が誤りが ${both.b.distance - both.a.distance} 文字少ない。`
                : `B の方が誤りが ${both.a.distance - both.b.distance} 文字少ない。`}
            読み方・周囲の音でも変わるので、2〜3 回試して傾向を見てください。
          </p>
        </div>
      ) : null}

      <p className="mt-6 text-base text-ink-muted">
        比べ方: 台本と文字起こしを 1 文字ずつ突き合わせ、違う文字・余分な文字・抜けた文字の最小回数を数えます（文字誤り率）。数字の書き方（4 と 四）の違いは誤りに数えます。
      </p>
    </main>
  );
}

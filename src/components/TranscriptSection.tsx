/** ② 会話入力 → マスクして確認 → 下書きを作る */
import type { ReactNode } from "react";
import type { MaskResult, MaskToken } from "@/lib/mask/types";
import type { DraftContext } from "@/lib/report/schema";
import { Button, Section, WarnText, inputClass } from "./ui";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** マスク済みの文章。置き換えた記号を <mark> で目立たせる */
function MaskedView({ text, tokenList, small = false }: { text: string; tokenList: MaskToken[]; small?: boolean }) {
  const tokens = [...new Set(tokenList.map((t) => t.token))].sort((a, b) => b.length - a.length);
  let body: ReactNode = text;
  if (tokens.length > 0) {
    const re = new RegExp(`(${tokens.map(escapeRegExp).join("|")})`, "g");
    body = text.split(re).map((part, i) =>
      i % 2 === 1 ? (
        <mark key={i} className="rounded bg-yellow-200 px-1 font-bold text-slate-900 underline decoration-2">
          {part}
        </mark>
      ) : (
        <span key={i}>{part}</span>
      ),
    );
  }
  return (
    <div
      className={`${small ? "max-h-48" : "max-h-96"} overflow-y-auto whitespace-pre-wrap break-words rounded-lg border-2 border-slate-400 bg-white p-3 leading-8`}
    >
      {body}
    </div>
  );
}

export function TranscriptSection({
  transcript,
  onTranscriptChange,
  maskResult,
  maskStale,
  onMask,
  drafting,
  elapsedSec,
  onDraft,
  draftError,
  leakWarning,
  hasDraft,
  maskedContext,
  basicFilled,
  ackNoPatient,
  onAckNoPatientChange,
  ackWarnings,
  onAckWarningsChange,
  onAddMaskWord,
}: {
  transcript: string;
  onTranscriptChange: (v: string) => void;
  maskResult: MaskResult | null;
  /** マスク後に会話や基本情報が変わった */
  maskStale: boolean;
  onMask: () => void;
  drafting: boolean;
  elapsedSec: number;
  onDraft: () => void;
  draftError: string | null;
  leakWarning: boolean;
  hasDraft: boolean;
  /** 家族構成・処方内容などの文脈欄をマスクしたもの（AIに送る） */
  maskedContext: DraftContext | null;
  /** 基本情報に患者の姓または名が入っている */
  basicFilled: boolean;
  /** 患者名が会話に見つからないまま送ることを了承した */
  ackNoPatient: boolean;
  onAckNoPatientChange: (v: boolean) => void;
  /** 名前らしい語の警告が残ったまま送ることを了承した */
  ackWarnings: boolean;
  onAckWarningsChange: (v: boolean) => void;
  /** 警告の語を辞書（家族の氏名 / その他の語）に足して、マスクし直す */
  onAddMaskWord: (text: string, kind: "family" | "other") => void;
}) {
  const noPatientToken = maskResult !== null && !maskResult.tokens.some((t) => t.kind === "patient");
  const hasWarnings = maskResult !== null && maskResult.warnings.length > 0;
  // 患者の氏名が未入力なら送れない。会話に患者名が1件も見つからないとき、名前らしい語の警告が残っているときは、了承が要る
  const canDraft =
    maskResult !== null && !maskStale && basicFilled && (!noPatientToken || ackNoPatient) && (!hasWarnings || ackWarnings);
  const ready = canDraft;
  return (
    <Section id="step-2" title="② 会話">
      <label className="block">
        <span className="mb-1 block font-bold">訪問中の会話（文字起こしを貼り付け）</span>
        <textarea
          className={`${inputClass} min-h-72 leading-8`}
          value={transcript}
          onChange={(e) => onTranscriptChange(e.target.value)}
          placeholder="ここに会話を貼り付けます（スマホはキーボードの音声入力も使えます）"
        />
      </label>
      <div className="mt-3 flex flex-wrap gap-3">
        <Button variant="primary" onClick={onMask} disabled={transcript.trim() === "" || drafting}>
          マスクして確認
        </Button>
      </div>

      {maskResult && maskStale ? (
        <WarnText>会話または基本情報が変わりました。もう一度「マスクして確認」を押してください。</WarnText>
      ) : null}

      {maskResult ? (
        <div className={`mt-5 space-y-4 ${maskStale ? "opacity-60" : ""}`}>
          <div>
            <h3 className="mb-1 text-xl font-bold">AIに送る内容（マスク後）</h3>
            <p className="mb-2 text-slate-800">黄色で示した記号が、置き換えた箇所です。</p>
            <MaskedView text={maskResult.masked} tokenList={maskResult.tokens} />
          </div>

          {maskedContext && (maskedContext.family !== "" || maskedContext.prescription !== "") ? (
            <div>
              <h3 className="mb-1 text-xl font-bold">AIに送る基本情報の文脈（マスク後）</h3>
              <p className="mb-2 text-slate-800">基本情報の「家族構成」「処方内容」にも、同じ置き換えを掛けています。</p>
              {maskedContext.family !== "" ? (
                <div className="mb-2">
                  <p className="font-bold">家族構成</p>
                  <MaskedView text={maskedContext.family} tokenList={maskResult.tokens} small />
                </div>
              ) : null}
              {maskedContext.prescription !== "" ? (
                <div>
                  <p className="font-bold">処方内容</p>
                  <MaskedView text={maskedContext.prescription} tokenList={maskResult.tokens} small />
                </div>
              ) : null}
            </div>
          ) : null}

          <div>
            <h3 className="mb-1 text-xl font-bold">置き換えた記号（{maskResult.tokens.length}件）</h3>
            <p className="mb-2 text-slate-800">「記号 ← 元の値」の対応は、この画面の中だけにあります。AIには送りません。</p>
            {maskResult.tokens.length === 0 ? (
              <p>置き換えた箇所はありません。基本情報の氏名などを確認してください。</p>
            ) : (
              <ul className="space-y-1">
                {maskResult.tokens.map((t, i) => (
                  <li key={i} className="rounded-lg border border-slate-300 px-3 py-1">
                    <span className="font-bold">{t.token}</span> ← {t.original}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {maskResult.warnings.length > 0 ? (
            <div role="alert" className="rounded-lg border-2 border-amber-700 bg-amber-50 p-3">
              <h3 className="mb-1 text-xl font-bold text-amber-950">
                <span aria-hidden="true">⚠ </span>
                置き換えられなかった個人情報らしい箇所（{maskResult.warnings.length}件）
              </h3>
              <p className="mb-2 text-amber-950">
                人の名前かもしれません。辞書に足すと記号に置き換わります（家族の氏名なら「家族として登録」、医療機関名・事業所名・それ以外の人名なら「その他の語として登録」）。人名でなければ下のチェックを入れて進めます。
              </p>
              <ul className="space-y-2">
                {maskResult.warnings.map((w, i) => (
                  <li key={i} className="rounded-lg border border-amber-700 bg-white p-2">
                    <p className="font-bold text-amber-950">
                      「{w.text}」 <span className="font-normal">… {w.reason}</span>
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button onClick={() => onAddMaskWord(w.text, "family")} disabled={drafting || maskStale}>
                        家族として登録
                      </Button>
                      <Button onClick={() => onAddMaskWord(w.text, "other")} disabled={drafting || maskStale}>
                        その他の語として登録
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
              <label className="mt-3 flex min-h-12 cursor-pointer items-center gap-3 font-bold text-amber-950">
                <input
                  type="checkbox"
                  className="h-6 w-6"
                  checked={ackWarnings}
                  onChange={(e) => onAckWarningsChange(e.target.checked)}
                />
                残っている語は人の名前ではないことを確認した。それでも送る
              </label>
            </div>
          ) : null}

          <div className="border-t-2 border-slate-300 pt-4">
            {leakWarning ? (
              <WarnText>
                AIに送る内容に、元の氏名・住所などが残っている可能性があります。送信を止めました。マスク結果と、基本情報の「家族構成」「処方内容」を確認してください。
              </WarnText>
            ) : null}
            {!basicFilled ? (
              <WarnText>
                基本情報（①）に患者の姓または名が入っていません。氏名が空のままだとマスクできないため、下書きは作れません。
              </WarnText>
            ) : noPatientToken ? (
              <div role="alert" className="mt-2 rounded-lg border-2 border-amber-700 bg-amber-50 p-3">
                <p className="font-bold text-amber-950">
                  <span aria-hidden="true">⚠ </span>
                  患者さんの名前が会話に見つかりません。置き換えが1件も起きていません。
                </p>
                <label className="mt-2 flex min-h-12 cursor-pointer items-center gap-3 font-bold text-amber-950">
                  <input
                    type="checkbox"
                    className="h-6 w-6"
                    checked={ackNoPatient}
                    onChange={(e) => onAckNoPatientChange(e.target.checked)}
                  />
                  会話に患者さんの名前が出ていないことを確認した。それでも送る
                </label>
              </div>
            ) : null}
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button variant="primary" onClick={onDraft} disabled={!ready || drafting}>
                {hasDraft ? "この内容で下書きを作り直す" : "この内容で下書きを作る"}
              </Button>
            </div>
            {drafting ? (
              <div role="status" aria-live="polite" className="mt-3 rounded-lg border-2 border-blue-800 bg-blue-50 p-3">
                <p className="font-bold text-blue-950">下書きを作っています… {elapsedSec}秒経過</p>
                <p className="text-blue-950">画面を閉じずにお待ちください。</p>
                <div className="mt-2 h-3 w-full animate-pulse rounded bg-blue-300" aria-hidden="true" />
              </div>
            ) : null}
            {draftError ? (
              <div role="alert" className="mt-3 rounded-lg border-2 border-red-800 bg-red-50 p-4">
                <p className="text-xl font-bold text-red-950">
                  <span aria-hidden="true">✕ </span>
                  下書きを作れませんでした
                </p>
                <p className="mt-1 text-xl text-red-950">{draftError}</p>
                <Button className="mt-3" variant="primary" onClick={onDraft} disabled={!ready || drafting}>
                  もう一度試す
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </Section>
  );
}

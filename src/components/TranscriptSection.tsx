/** ② 会話入力 → マスクして確認 → 下書きを作る */
import type { ReactNode } from "react";
import type { MaskResult, MaskToken } from "@/lib/mask/types";
import type { DraftContext, HealthResponse } from "@/lib/report/schema";
import type { RemovedLine } from "@/lib/ui/prescription";
import { describeServer } from "@/lib/ui/health";
import { appendTranscript } from "@/lib/ui/paste";
import { DraftErrorPanel, type DraftErrorInfo } from "./DraftErrorPanel";
import { PasteButton } from "./PasteButton";
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
        <mark key={i} className="rounded bg-shiroai px-1 font-bold text-ai underline decoration-2">
          {part}
        </mark>
      ) : (
        <span key={i}>{part}</span>
      ),
    );
  }
  return (
    <div
      className={`${small ? "max-h-48" : "max-h-96"} overflow-y-auto whitespace-pre-wrap break-words rounded-xl border-2 border-line bg-raised p-3 leading-8`}
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
  online,
  serverHealth,
  serverChecking,
  serverCheckFailed,
  onRecheckServer,
  leakWarning,
  hasDraft,
  maskedContext,
  basicFilled,
  ackNoPatient,
  onAckNoPatientChange,
  ackWarnings,
  onAckWarningsChange,
  onAddMaskWord,
  rxRisky,
  ackRx,
  onAckRxChange,
  onTidyRx,
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
  draftError: DraftErrorInfo | null;
  /** 端末がオンラインか（オフラインなら下書きボタンを止める） */
  online: boolean;
  /** GET /api/health の結果。取れなかったときは null（何も表示しない） */
  serverHealth: HealthResponse | null;
  /** サーバー状態を確認している最中 */
  serverChecking: boolean;
  /** 直近の確認が失敗した（サーバーに届かない・応答が不正） */
  serverCheckFailed: boolean;
  /** サーバー状態の再確認（API キーを設定し直したあとなどに使う） */
  onRecheckServer: () => void;
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
  /** 処方内容の欄に残っている、人名・医療機関名・患者情報らしい行（辞書では記号にならず、そのまま AI に送られる） */
  rxRisky: RemovedLine[];
  /** その行をそのまま送ることを了承した（行が無いときは true） */
  ackRx: boolean;
  onAckRxChange: (v: boolean) => void;
  /** 処方内容の欄を薬剤の行だけに整える（該当の行を外す） */
  onTidyRx: () => void;
}) {
  const noPatientToken = maskResult !== null && !maskResult.tokens.some((t) => t.kind === "patient");
  const hasWarnings = maskResult !== null && maskResult.warnings.length > 0;
  // 患者の氏名が未入力なら送れない。会話に患者名が1件も見つからないとき、名前らしい語の警告が残っているときは、了承が要る
  const canDraft =
    maskResult !== null && !maskStale && basicFilled && (!noPatientToken || ackNoPatient) && (!hasWarnings || ackWarnings) && ackRx;
  const serverStatus = describeServer(serverHealth);
  // オフライン・API キー未設定のときは送れない（送っても失敗するだけなので、先に止める）
  const ready = canDraft && online && !serverStatus?.keyMissing;
  return (
    <Section id="step-2" title="② 会話">
      {!online ? <WarnText>オフラインです。Wi-Fi をご確認ください。つながるまで、下書きは作れません。</WarnText> : null}
      <details className="mb-3 rounded-xl border-2 border-line bg-surface p-3 text-ink">
        <summary className="flex min-h-12 cursor-pointer items-center text-lg font-bold">会話の入れ方（ボイスメモの文字起こし・音声入力）</summary>
        <ul className="mt-2 list-disc space-y-1 pl-6">
          <li>
            録音した会話は、iPhone の<strong>ボイスメモ</strong>で「文字起こしを表示」→ 文字をコピー → 下の「クリップボードから貼り付け」。
          </li>
          <li>
            その場で話して入れるなら、入力欄をタップしてキーボードの<strong>マイク</strong>（音声入力）。日本語の音声入力は iPhone
            の中で処理されます（Apple の案内。無音が 30 秒続くと止まります）。
          </li>
          <li>このアプリは音声を録音も送信もしません。扱うのは文字だけで、送る前に氏名などを記号に置き換えます。</li>
        </ul>
      </details>
      <label className="block">
        <span className="mb-1 block font-bold">訪問中の会話（文字起こしを貼り付け）</span>
        <textarea
          className={`${inputClass} min-h-72 leading-8`}
          value={transcript}
          onChange={(e) => onTranscriptChange(e.target.value)}
          placeholder="ここに会話を貼り付けます（ボイスメモの文字起こしをコピーして貼る／キーボードの音声入力でも入ります）"
        />
      </label>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <PasteButton onPaste={(text) => onTranscriptChange(appendTranscript(transcript, text))} disabled={drafting} />
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
            <p className="mb-2 text-ink">下線つきで強調した記号が、置き換えた箇所です。</p>
            <MaskedView text={maskResult.masked} tokenList={maskResult.tokens} />
          </div>

          {maskedContext && (maskedContext.family !== "" || maskedContext.prescription !== "") ? (
            <div>
              <h3 className="mb-1 text-xl font-bold">AIに送る基本情報の文脈（マスク後）</h3>
              <p className="mb-2 text-ink">基本情報の「家族構成」「処方内容」にも、同じ置き換えを掛けています。</p>
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
            <p className="mb-2 text-ink">「記号 ← 元の値」の対応は、この画面の中だけにあります。AIには送りません。</p>
            {maskResult.tokens.length === 0 ? (
              <p>置き換えた箇所はありません。基本情報の氏名などを確認してください。</p>
            ) : (
              <ul className="space-y-1">
                {maskResult.tokens.map((t, i) => (
                  <li key={i} className="rounded-xl border border-line px-3 py-1">
                    <span className="font-bold">{t.token}</span> ← {t.original}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {maskResult.warnings.length > 0 ? (
            <div role="alert" className="rounded-xl border-2 border-akane bg-raised p-3">
              <h3 className="mb-1 text-xl font-bold text-akane">
                <span aria-hidden="true">⚠ </span>
                置き換えられなかった個人情報らしい箇所（{maskResult.warnings.length}件）
              </h3>
              <p className="mb-2 text-ink">
                人の名前かもしれません。辞書に足すと記号に置き換わります（家族の氏名なら「家族として登録」、医療機関名・事業所名・それ以外の人名なら「その他の語として登録」）。人名でなければ下のチェックを入れて進めます。
              </p>
              <ul className="space-y-2">
                {maskResult.warnings.map((w, i) => (
                  <li key={i} className="rounded-xl border border-akane bg-raised p-2">
                    <p className="font-bold text-ink">
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
              <label className="mt-3 flex min-h-12 cursor-pointer items-center gap-3 font-bold text-ink">
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

          {rxRisky.length > 0 ? (
            <div role="alert" className="rounded-xl border-2 border-akane bg-raised p-3">
              <h3 className="mb-1 text-xl font-bold text-akane">
                <span aria-hidden="true">⚠ </span>
                処方内容に、人名・医療機関名・患者情報らしい行があります（{rxRisky.length}件）
              </h3>
              <p className="mb-2 text-ink">
                処方欄にだけ出てくる医師名・医療機関名は、記号に置き換わらず、そのまま AI に送られます。薬剤の行だけを送るには、「処方内容から外す」を押してください。
              </p>
              <ul className="space-y-2">
                {rxRisky.map((r, i) => (
                  <li key={`${i}-${r.line}`} className="rounded-xl border border-akane bg-raised p-2">
                    <p className="break-words font-bold text-ink">{r.line}</p>
                    <p className="text-ink">
                      <span aria-hidden="true">⚠ </span>
                      {r.reason}
                    </p>
                  </li>
                ))}
              </ul>
              <div className="mt-3">
                <Button onClick={onTidyRx} disabled={drafting}>
                  処方内容から外す（薬剤の行だけにして、マスクし直す）
                </Button>
              </div>
              <label className="mt-3 flex min-h-12 cursor-pointer items-center gap-3 font-bold text-ink">
                <input
                  type="checkbox"
                  className="h-6 w-6"
                  checked={ackRx}
                  onChange={(e) => onAckRxChange(e.target.checked)}
                />
                上の行に人名・医療機関名・患者情報は無いことを確認した。それでも送る
              </label>
            </div>
          ) : null}

          <div className="border-t-2 border-line pt-4">
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
              <div role="alert" className="mt-2 rounded-xl border-2 border-akane bg-raised p-3">
                <p className="font-bold text-akane">
                  <span aria-hidden="true">⚠ </span>
                  患者さんの名前が会話に見つかりません。置き換えが1件も起きていません。
                </p>
                <label className="mt-2 flex min-h-12 cursor-pointer items-center gap-3 font-bold text-ink">
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
              <div role="status" aria-live="polite" className="mt-3 rounded-xl border-2 border-ai bg-shiroai p-3">
                <p className="font-bold text-ai">下書きを作っています… {elapsedSec}秒経過</p>
                <p className="text-ai">画面を閉じずにお待ちください。</p>
                <div className="mt-2 h-3 w-full animate-pulse rounded bg-hanada" aria-hidden="true" />
              </div>
            ) : null}
            {serverStatus ? (
              <p className="mt-2 text-lg text-ink">
                <span aria-hidden="true">{serverStatus.ready ? "✓ " : "⚠ "}</span>
                {serverStatus.label}
              </p>
            ) : null}
            {serverStatus?.keyMissing ? (
              <WarnText>
                サーバーに API キーが設定されていないため、下書きは作れません。管理者（社長）に連絡してください。設定し直してもらったら、下の「サーバーの状態を再確認」を押してください（入力した内容は消えません）。
              </WarnText>
            ) : null}
            {serverStatus && !serverStatus.ready ? (
              <div className="mt-2">
                <Button onClick={onRecheckServer} disabled={serverChecking}>
                  {serverChecking ? "確認しています…" : "サーバーの状態を再確認"}
                </Button>
                {serverCheckFailed && !serverChecking ? (
                  <p role="status" className="mt-1 text-lg font-bold text-akane">
                    <span aria-hidden="true">⚠ </span>
                    サーバーに確認できませんでした。つながりを確かめて、もう一度押してください。
                  </p>
                ) : null}
              </div>
            ) : null}
            {draftError ? (
              <DraftErrorPanel
                key={draftError.occurredAt}
                info={draftError}
                onRetry={onDraft}
                retryDisabled={!ready || drafting}
              />
            ) : null}
          </div>
        </div>
      ) : null}
    </Section>
  );
}

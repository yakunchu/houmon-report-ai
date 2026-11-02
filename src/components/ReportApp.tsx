"use client";

/**
 * 在宅レポAI（仮）の画面全体。
 * 流れ: ①基本情報 → ②会話（マスクして確認 → 下書きを作る） → ③下書きを確認・修正 → ④確定・出力。
 * 個人情報の境界: 氏名などの置き換え（マスク）と復元はこの画面（端末内）で行い、
 * /api/draft に送るのはマスク済み会話と、氏名を含まない文脈だけ。
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { containsOriginal, maskText, unmaskText } from "@/lib/mask";
import type { MaskResult } from "@/lib/mask/types";
import { formatReport } from "@/lib/report/format";
import {
  ReportDraftSchema,
  type DraftContext,
  type DraftRequest,
  type DraftResponse,
  type ReportDraft,
} from "@/lib/report/schema";
import { YAMAMOTO_BASIC, YAMAMOTO_TRANSCRIPT } from "@/lib/sample/yamamoto";
import {
  buildContext,
  buildDictionary,
  buildFixedFields,
  buildHeader,
  fingerprint,
  hasUnmaskedOriginal,
  isBasicFilled,
  maskContext,
  mergeTokens,
} from "@/lib/ui/basic-info";
import { listUnsureLabels } from "@/lib/ui/draft-utils";
import {
  clearAllSaved,
  loadBasic,
  loadSession,
  loadTranscript,
  saveRaw,
  type DraftSession,
} from "@/lib/ui/storage";
import { EMPTY_BASIC, type BasicInfo } from "@/lib/ui/types";
import { BasicInfoSection } from "./BasicInfoSection";
import { DraftSection } from "./DraftSection";
import { OutputSection } from "./OutputSection";
import { StepBar, type StepStatus } from "./StepBar";
import { TranscriptSection } from "./TranscriptSection";

/** 画面が開かれたあと（ハイドレーション後）にだけ true になる。localStorage を安全に読むための門番 */
const subscribeNone = () => () => {};

export function ReportApp() {
  const mounted = useSyncExternalStore(
    subscribeNone,
    () => true,
    () => false,
  );
  if (!mounted) return <p className="p-6 text-lg">読み込み中…</p>;
  return <ReportAppInner />;
}

/** API 呼び出しの待ち時間の上限（ミリ秒） */
const DRAFT_TIMEOUT_MS = 180_000;

function scrollToId(id: string): void {
  window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
}

function ReportAppInner() {
  const [basic, setBasic] = useState<BasicInfo>(loadBasic);
  const [basicOpen, setBasicOpen] = useState(() => !isBasicFilled(loadBasic()));
  const [transcript, setTranscript] = useState<string>(loadTranscript);
  const [session, setSession] = useState<DraftSession | null>(loadSession);
  // result は会話と文脈欄の両方で置き換えた記号をまとめたもの。context は AI に送る文脈（マスク済み）
  const [maskState, setMaskState] = useState<{ result: MaskResult; key: string; context: DraftContext } | null>(null);
  const [ackNoPatient, setAckNoPatient] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [leakWarning, setLeakWarning] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  // 端末内に保存（失敗しても動く）
  useEffect(() => saveRaw("basic", JSON.stringify(basic)), [basic]);
  useEffect(() => saveRaw("transcript", transcript), [transcript]);
  useEffect(() => saveRaw("session", session ? JSON.stringify(session) : null), [session]);

  // 送信中の経過秒数
  useEffect(() => {
    if (!drafting) return;
    const t0 = Date.now();
    const id = window.setInterval(() => setElapsedSec(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => window.clearInterval(id);
  }, [drafting]);

  const dictionary = useMemo(() => buildDictionary(basic), [basic]);
  // マスク結果・下書きの元になる入力（辞書・会話・API に送る文脈）。変わったら結果は古い
  const maskKey = useMemo(() => JSON.stringify([dictionary, transcript, buildContext(basic)]), [dictionary, transcript, basic]);
  const maskStale = maskState !== null && maskState.key !== maskKey;
  // 下書きの元は、マスク入力に宛先を足したもの（宛先で文面が変わるため）
  const draftSourceKey = useMemo(() => fingerprint(`${maskKey}|${basic.recipientType}`), [maskKey, basic.recipientType]);
  const sessionStale = session !== null && session.sourceKey !== draftSourceKey;
  const basicFilled = isBasicFilled(basic);

  function handleMask(): void {
    const t = maskText(transcript, dictionary);
    // 家族構成・処方内容などの文脈欄にも同じ辞書でマスクを掛ける
    const c = maskContext(buildContext(basic), dictionary);
    setMaskState({
      result: { masked: t.masked, tokens: mergeTokens(t.tokens, c.tokens), warnings: [...t.warnings, ...c.warnings] },
      key: maskKey,
      context: c.context,
    });
    setAckNoPatient(false);
    setLeakWarning(false);
    setDraftError(null);
  }

  async function handleDraft(): Promise<void> {
    if (!maskState || maskStale || drafting) return;
    // 患者の氏名が未入力だとマスクできない。会話に患者名が見つからないときは、画面で了承が要る
    if (!basicFilled) return;
    const { masked, tokens } = maskState.result;
    if (!tokens.some((t) => t.kind === "patient") && !ackNoPatient) return;
    const context = maskState.context;

    // 送る前の最終確認: 会話にも文脈にも、辞書の語（氏名・住所・電話など）が残っていないこと。
    // 置き換えた語の照合に加えて、送る文字列にもう一度マスクを掛け、まだ置き換わる語がないかを辞書から調べる
    const outgoing = [masked, ...Object.values(context)].join("\n");
    if (containsOriginal(outgoing, tokens) || hasUnmaskedOriginal(outgoing, dictionary)) {
      setLeakWarning(true);
      return;
    }
    setLeakWarning(false);
    if (masked.length > 30000) {
      setDraftError("会話が長すぎます（3万文字まで）。分けて作成してください。");
      return;
    }

    const body: DraftRequest = { recipientType: basic.recipientType, transcript: masked, context };
    setDrafting(true);
    setElapsedSec(0);
    setDraftError(null);

    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), DRAFT_TIMEOUT_MS);
    let res: DraftResponse;
    try {
      const r = await fetch("/api/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const json: unknown = await r.json();
      if (typeof json !== "object" || json === null || typeof (json as { ok?: unknown }).ok !== "boolean") {
        throw new Error("unexpected response");
      }
      res = json as DraftResponse;
    } catch {
      res = {
        ok: false,
        error: "network",
        message: controller.signal.aborted
          ? "時間がかかりすぎたため中止しました。もう一度試してください。"
          : "サーバーに接続できませんでした。Wi-Fi とサーバーが動いているかを確認して、もう一度試してください。",
      };
    } finally {
      window.clearTimeout(timer);
    }
    setDrafting(false);

    if (!res.ok) {
      setDraftError(res.message);
      return;
    }
    const parsed = ReportDraftSchema.safeParse(res.draft);
    if (!parsed.success) {
      setDraftError("下書きの形式が想定と違っていました。もう一度試してください。");
      return;
    }
    setSession({
      draft: parsed.data,
      transcript: masked,
      tokens,
      recipientType: basic.recipientType,
      model: res.model,
      sourceKey: draftSourceKey,
    });
    setFinalizing(false);
    setConfirmed(false);
    scrollToId("step-3");
  }

  function updateDraft(next: ReportDraft): void {
    setSession((s) => (s ? { ...s, draft: next } : s));
  }

  /** マスク結果・下書き・確定を捨てる（別の患者・サンプルに入れ替えるとき、前の患者の下書きを残さない） */
  function resetWork(): void {
    setSession(null);
    setMaskState(null);
    setAckNoPatient(false);
    setFinalizing(false);
    setConfirmed(false);
    setDraftError(null);
    setLeakWarning(false);
  }

  function loadSample(): void {
    resetWork();
    setBasic(YAMAMOTO_BASIC);
    setTranscript(YAMAMOTO_TRANSCRIPT);
    setBasicOpen(false);
    scrollToId("step-2");
  }

  function clearSaved(): void {
    if (!window.confirm("この端末に保存した基本情報・会話・下書きをすべて消します。よろしいですか？")) return;
    clearAllSaved();
    setBasic(EMPTY_BASIC);
    setTranscript("");
    resetWork();
    setBasicOpen(true);
  }

  const unsureLabels = useMemo(() => (session ? listUnsureLabels(session.draft) : []), [session]);

  // 確定後の出力テキスト（名前を戻す）
  const reportText = useMemo(() => {
    if (!session || !confirmed || sessionStale) return "";
    const text = formatReport({
      draft: session.draft,
      header: buildHeader(basic),
      fixedFields: buildFixedFields(basic),
      recipientType: session.recipientType,
    });
    return unmaskText(text, session.tokens);
  }, [session, confirmed, sessionStale, basic]);

  // ステップ表示
  const current = !basicFilled ? 1 : !session || sessionStale ? 2 : !confirmed ? 3 : 4;
  const statusOf = (n: 1 | 2 | 3 | 4): StepStatus => (n === current ? "current" : n < current ? "done" : "todo");
  const statuses = [statusOf(1), statusOf(2), statusOf(3), statusOf(4)] as const;

  function jump(id: string): void {
    if (id === "step-1") setBasicOpen(true);
    scrollToId(id);
  }

  return (
    <>
      <StepBar statuses={statuses} onJump={jump} />
      <main className="mx-auto w-full max-w-[900px] space-y-6 px-4 pb-24 pt-6">
        <header className="print:hidden">
          <h1 className="text-3xl font-bold text-slate-900">在宅レポAI（仮）</h1>
          <p className="mt-2 text-slate-800">
            訪問中の会話から「居宅療養管理指導報告書」の下書きを作ります。AIは下書きまでです。確認と判断は薬剤師が行います。
          </p>
        </header>

        <div className="space-y-6 print:hidden">
          <BasicInfoSection
            basic={basic}
            onChange={setBasic}
            open={basicOpen}
            onToggle={() => setBasicOpen((o) => !o)}
            onLoadSample={loadSample}
            onClearSaved={clearSaved}
          />
          <TranscriptSection
            transcript={transcript}
            onTranscriptChange={setTranscript}
            maskResult={maskState?.result ?? null}
            maskStale={maskStale}
            onMask={handleMask}
            drafting={drafting}
            elapsedSec={elapsedSec}
            onDraft={handleDraft}
            draftError={draftError}
            leakWarning={leakWarning}
            hasDraft={session !== null}
            maskedContext={maskState?.context ?? null}
            basicFilled={basicFilled}
            ackNoPatient={ackNoPatient}
            onAckNoPatientChange={setAckNoPatient}
          />
          {session ? (
            <DraftSection
              draft={session.draft}
              onChange={updateDraft}
              transcript={session.transcript}
              stale={sessionStale}
              onProceed={() => {
                setFinalizing(true);
                scrollToId("step-4");
              }}
            />
          ) : null}
        </div>

        {session && (finalizing || confirmed) && !sessionStale ? (
          <OutputSection
            unsureLabels={unsureLabels}
            confirmed={confirmed}
            onConfirm={() => setConfirmed(true)}
            onBackToEdit={() => {
              setConfirmed(false);
              setFinalizing(false);
              scrollToId("step-3");
            }}
            reportText={reportText}
            stale={sessionStale}
          />
        ) : null}
      </main>
    </>
  );
}

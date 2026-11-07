"use client";

/**
 * 在宅レポAI（仮）の画面全体。
 * 流れ: ①患者（患者リストから選ぶ／新しい患者を登録） → ②会話（個人名を見えないようマスク処理する → 下書きを作る） → ③下書きを確認・修正 → ④確定・出力。
 * 個人情報の境界: 氏名などの置き換え（マスク）と復元はこの画面（端末内）で行い、
 * /api/draft に送るのはマスク済み会話と、氏名を含まない文脈だけ。患者リストも端末内（localStorage）だけに置く。
 *
 * 患者リストが「マスター」で、基本情報（BasicInfo）は「今回の訪問の作業用コピー」。
 * 患者を選ぶと作業用コピーに読み込み、「患者リストに保存」で書き戻す。
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { appendTranscript } from "@/lib/ui/paste";
import { parseTranscriptFragment, parseTranscriptQuery } from "@/lib/ui/shortcut";
import {
  calcAge,
  createEmptyFacility,
  createEmptyPatient,
  createEmptyStore,
  deletePatient,
  loadStore,
  saveStore,
  upsertFacility,
  upsertPatient,
  type GroupId,
  type Patient,
  type PatientExtras,
  type PatientId,
  type PatientStore,
} from "@/lib/patients";
import { containsOriginal, maskText, unmaskText } from "@/lib/mask";
import type { MaskResult } from "@/lib/mask/types";
import { formatReport } from "@/lib/report/format";
import { buildChat, buildEmail, buildPrintModel, mapPrintModelText, type FormatArgs } from "@/lib/report/formats";
import {
  ReportDraftSchema,
  type DraftContext,
  type DraftRequest,
  type DraftResponse,
  type ReportDraft,
} from "@/lib/report/schema";
import { findSample, type SampleId } from "@/lib/sample";
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
  riskyPrescriptionLines,
} from "@/lib/ui/basic-info";
import { normalizePrescription } from "@/lib/ui/prescription";
import { listUnsureLabels, normalizeContactNotes, tidyDraft } from "@/lib/ui/draft-utils";
import { useOnlineStatus, useServerHealth } from "@/lib/ui/health";
import {
  basicInfoToPatient,
  isSamePatientContent,
  patientToBasicInfo,
  stableStringify,
  todayIso,
  type VisitFields,
} from "@/lib/ui/patient-bridge";
import {
  clearAllSaved,
  clearEverything,
  loadBasic,
  loadPharmacy,
  loadPharmacyContact,
  loadSession,
  loadStep,
  loadTranscript,
  loadWorkBase,
  saveRaw,
  saveStep,
  type DraftSession,
} from "@/lib/ui/storage";
import {
  autoFillBlanks,
  buildSuggestionItems,
  isSameAsCurrent,
  type AiField,
  type SuggestionItem,
} from "@/lib/ui/suggestions";
import { type BasicInfo } from "@/lib/ui/types";
import { Section, WarnText } from "./ui";
import { BasicInfoSection } from "./BasicInfoSection";
import { BottomNav } from "./BottomNav";
import { DraftSection } from "./DraftSection";
import { makeDraftError, type DraftErrorInfo } from "./DraftErrorPanel";
import { OutputSection } from "./OutputSection";
import { CurrentPatientBar } from "./patients/CurrentPatientBar";
import { PatientPicker } from "./patients/PatientPicker";
import { SuggestionPanel } from "./patients/SuggestionPanel";
import { StepBar, type StepNo, type StepStatus } from "./StepBar";
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

/** タブを切り替えたあとの位置合わせ。anchorId が見つかればそこへ、無ければタブの先頭（画面の一番上）へ。描画が済むのを少し待つ */
function scrollAfterTabChange(anchorId?: string): void {
  window.setTimeout(() => {
    const el = anchorId ? document.getElementById(anchorId) : null;
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    else window.scrollTo({ top: 0 });
  }, 50);
}

/** URL の #step-2 のようなリンクから、開くタブを読む */
function stepFromHash(hash: string): StepNo | null {
  const m = /^#step-([1-4])$/.exec(hash);
  return m ? (Number(m[1]) as StepNo) : null;
}

/**
 * 読み込み直後に出す知らせの帯へ移る。Web フォントの読み込みで上の段の高さが変わると、合わせた位置がずれて帯が固定ナビの下に
 * 隠れることがあるので、フォントがそろったあとに帯が見えていなければもう一度合わせる（見えていれば動かさない）
 */
function scrollToNoticeWhenSettled(id: string): void {
  scrollToId(id);
  document.fonts?.ready
    .then(() => {
      const top = document.getElementById(id)?.getBoundingClientRect().top;
      if (top === undefined) return;
      if (top < 72 || top > window.innerHeight / 2) scrollToId(id);
    })
    .catch(() => {});
}

/** 作業用コピーから、患者に持たない「今回の訪問」の値と端末の設定を取り出す。次回訪問日は患者ごとなので引き継がない */
function visitOf(b: BasicInfo): VisitFields {
  return {
    recipientType: b.recipientType,
    reportDate: b.reportDate || todayIso(),
    nextVisitDate: "",
    pharmacy: b.pharmacy,
    pharmacyContact: b.pharmacyContact ?? "",
  };
}

/** マスク辞書・マスク入力の印・下書きの元の印（今の入力から計算する。変わったら結果は古い） */
function computeKeys(b: BasicInfo, transcript: string, facilityName: string) {
  // 住まいが施設なら、その施設名を「その他マスクしたい語」と同じ扱いで置き換え対象に加える（AI に送る前）
  const maskBasic: BasicInfo =
    facilityName === ""
      ? b
      : { ...b, otherMaskWords: b.otherMaskWords.trim() === "" ? facilityName : `${b.otherMaskWords}、${facilityName}` };
  const dictionary = buildDictionary(maskBasic);
  const maskKey = JSON.stringify([dictionary, transcript, buildContext(b)]);
  // 下書きの元は、マスク入力に宛先を足したもの（宛先で文面が変わるため）
  const draftSourceKey = fingerprint(`${maskKey}|${b.recipientType}`);
  return { dictionary, maskKey, draftSourceKey };
}

type MaskState = { result: MaskResult; key: string; context: DraftContext };

/** 会話と文脈欄の両方を同じ辞書でマスクする（result は両方で置き換えた記号をまとめたもの。context は AI に送る文脈） */
function makeMaskState(b: BasicInfo, transcript: string, facilityName: string): MaskState {
  const { dictionary, maskKey } = computeKeys(b, transcript, facilityName);
  const t = maskText(transcript, dictionary);
  // 家族構成・処方内容などの文脈欄にも同じ辞書でマスクを掛ける
  const c = maskContext(buildContext(b), dictionary);
  return {
    result: { masked: t.masked, tokens: mergeTokens(t.tokens, c.tokens), warnings: [...t.warnings, ...c.warnings] },
    key: maskKey,
    context: c.context,
  };
}

type WorkInit = { store: PatientStore; base: Patient; basic: BasicInfo; migrated: boolean };

/**
 * 起動時の状態。端末に残っている作業コピーがあれば続きから、無ければ最後に選んだ患者を読み込む。
 * 初回移行: 患者リストが空で、保存済みの基本情報に氏名があれば、それを患者 1 件として登録して選択状態にする。
 */
function initWork(): WorkInit {
  let store = loadStore();
  const saved = loadBasic();
  const legacy: BasicInfo = {
    ...saved,
    pharmacy: loadPharmacy() ?? saved.pharmacy,
    pharmacyContact: loadPharmacyContact() ?? saved.pharmacyContact ?? "",
    reportDate: saved.reportDate || todayIso(),
  };
  const workBase = loadWorkBase(new Set(store.groups.map((g) => g.id)));

  if (workBase) return { store, base: workBase, basic: legacy, migrated: false };

  if (store.patients.length === 0 && isBasicFilled(legacy)) {
    const created = basicInfoToPatient(legacy, createEmptyPatient());
    const withPatient = upsertPatient(store, created);
    store = { ...withPatient, selectedPatientId: created.id };
    const base = store.patients.find((p) => p.id === created.id) ?? created;
    return { store, base, basic: legacy, migrated: true };
  }

  const selected = store.patients.find((p) => p.id === store.selectedPatientId);
  if (selected) return { store, base: selected, basic: patientToBasicInfo(selected, visitOf(legacy)), migrated: false };

  return { store, base: createEmptyPatient(), basic: legacy, migrated: false };
}

function ReportAppInner() {
  const [init] = useState(initWork);
  const [store, setStore] = useState<PatientStore>(init.store);
  // base: 作業中の患者の土台（id・グループ・メモ・作成日時）。患者リストに未登録の「新しい患者」でも持つ
  const [base, setBase] = useState<Patient>(init.base);
  const [basic, setBasic] = useState<BasicInfo>(init.basic);
  // 画面 v2: ①は入口（個人宅／施設）を先に見せるので、長い基本情報フォームは畳んで始める（「＋ 新しい患者」「この患者を編集」で開く）
  const [basicOpen, setBasicOpen] = useState(false);
  // いま開いているタブ（①〜④）。優先順: ショートカットの文字起こしが届いた(②) → URL の #step-N → このタブで最後に開いていたもの → ①。
  // この画面はハイドレーション後にだけ描画されるので、初期値で window を読んでよい
  const [activeStep, setActiveStep] = useState<StepNo>(() => {
    if (parseTranscriptFragment(window.location.hash) !== null || parseTranscriptQuery(window.location.search) !== null) return 2;
    return stepFromHash(window.location.hash) ?? loadStep() ?? 1;
  });
  const [aiFields, setAiFields] = useState<AiField[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  // iPhone のショートカットから戻ったとき、URL の #t= に文字起こしが載っている（# より後ろはサーバーに届かない）。
  // この画面はハイドレーション後にだけ描画されるので、初期値で window を読んでよい
  // "fragment" = # の後ろで届いた（取り込む）。"query" = x-callback の ?result= で届いた（サーバーにも送られているので取り込まず、警告だけ出す）
  const [shortcutImported, setShortcutImported] = useState<"fragment" | "query" | null>(() => {
    if (parseTranscriptFragment(window.location.hash) !== null) return "fragment";
    if (parseTranscriptQuery(window.location.search) !== null) return "query";
    return null;
  });
  const [transcript, setTranscript] = useState<string>(() => {
    const saved = loadTranscript();
    const fromShortcut = parseTranscriptFragment(window.location.hash);
    return fromShortcut === null ? saved : appendTranscript(saved, fromShortcut);
  });
  const [session, setSession] = useState<DraftSession | null>(loadSession);
  // result は会話と文脈欄の両方で置き換えた記号をまとめたもの。context は AI に送る文脈（マスク済み）
  const [maskState, setMaskState] = useState<MaskState | null>(null);
  const [ackNoPatient, setAckNoPatient] = useState(false);
  // 置き換えられなかった名前らしい語が残ったまま送ることを了承した（辞書に足せば警告は消える）
  const [ackWarnings, setAckWarnings] = useState(false);
  // 処方内容の欄に残った、人名・医療機関名・患者情報らしい行をそのまま送ることを了承した。了承した行の組を覚える（行が変われば了承は無効）
  const [ackRxSig, setAckRxSig] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [draftError, setDraftError] = useState<DraftErrorInfo | null>(null);
  const online = useOnlineStatus();
  const { health: serverHealth, checking: serverChecking, failed: serverCheckFailed, refetch: recheckServer } = useServerHealth();
  const [leakWarning, setLeakWarning] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  // 読み込みで作業中の患者の記録が更新されたが、作業用コピーに未保存の編集があって切り替えなかった
  const [importStale, setImportStale] = useState(false);

  // 端末内に保存（失敗しても動く）
  useEffect(() => saveRaw("basic", JSON.stringify(basic)), [basic]);
  useEffect(() => saveRaw("pharmacy", basic.pharmacy), [basic.pharmacy]);
  useEffect(() => saveRaw("pharmacyContact", basic.pharmacyContact ?? ""), [basic.pharmacyContact]);
  useEffect(() => saveRaw("workbase", JSON.stringify(base)), [base]);
  useEffect(() => saveRaw("transcript", transcript), [transcript]);
  useEffect(() => saveRaw("session", session ? JSON.stringify(session) : null), [session]);
  useEffect(() => saveStep(activeStep), [activeStep]);
  // URL の #step-N は最初に読んだらすぐ消す（残すと、あとで別のタブへ進んで再読み込みしても #step-N に戻される）
  useEffect(() => {
    if (stepFromHash(window.location.hash) !== null) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }, []);

  // ショートカットの文字起こしを受けたら、すぐ URL から消し（再読み込みで二重に入らない）、知らせの帯（②の直前）へ移る。
  // ②の見出しへ移すと帯が画面の上に隠れて見えないので、帯そのものを画面の先頭に出す
  useEffect(() => {
    if (!shortcutImported) return;
    // ?result= で届いたときはクエリごと消す（履歴にも残さない）
    window.history.replaceState(null, "", window.location.pathname + (shortcutImported === "query" ? "" : window.location.search));
    scrollToNoticeWhenSettled("shortcut-import");
  }, [shortcutImported]);

  // 画面を開いたまま同じタブに戻ってきたときは、ページが読み直されず # だけ変わるので、hashchange で受ける
  useEffect(() => {
    const onHashChange = () => {
      const text = parseTranscriptFragment(window.location.hash);
      if (text === null) {
        // #step-2 のようなリンク: そのタブを開く
        const step = stepFromHash(window.location.hash);
        if (step !== null) {
          setActiveStep(step);
          scrollAfterTabChange();
        }
        return;
      }
      setActiveStep(2);
      setTranscript((prev) => appendTranscript(prev, text));
      setShortcutImported("fragment");
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      scrollToNoticeWhenSettled("shortcut-import");
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  // 患者リスト。読み込んだだけのときは書き戻さない（読めなかったデータを空で上書きしないため）
  useEffect(() => {
    if (store !== init.store || init.migrated) saveStore(store);
  }, [store, init]);

  // 送信中の経過秒数
  useEffect(() => {
    if (!drafting) return;
    const t0 = Date.now();
    const id = window.setInterval(() => setElapsedSec(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => window.clearInterval(id);
  }, [drafting]);

  // 住まいが施設のときの施設名（マスク対象に加える）
  const facilityId = base.residence.kind === "facility" ? base.residence.facilityId : null;
  const facilityName = useMemo(
    () => (facilityId === null ? "" : (store.facilities.find((f) => f.id === facilityId)?.name.trim() ?? "")),
    [store.facilities, facilityId],
  );

  const keys = useMemo(() => computeKeys(basic, transcript, facilityName), [basic, transcript, facilityName]);
  const { dictionary, maskKey, draftSourceKey } = keys;
  const maskStale = maskState !== null && maskState.key !== maskKey;
  const sessionStale = session !== null && session.sourceKey !== draftSourceKey;
  const basicFilled = isBasicFilled(basic);
  // 処方内容の欄にある、人名・医療機関名・患者情報らしい行（貼り付けボタンを通らずに入った文字も含む）
  const rxRisky = useMemo(() => riskyPrescriptionLines(basic.prescription), [basic.prescription]);
  const rxSig = JSON.stringify(rxRisky.map((r) => r.line));
  const ackRx = rxRisky.length === 0 || ackRxSig === rxSig;

  // 送信中に入力や患者が変わったかを調べるための、最新の値
  const latestRef = useRef({ draftSourceKey, baseId: base.id, basic });
  useEffect(() => {
    latestRef.current = { draftSourceKey, baseId: base.id, basic };
  });

  // 患者リストとの関係
  const savedPatient = useMemo(() => store.patients.find((p) => p.id === base.id) ?? null, [store.patients, base.id]);
  const livePatient = useMemo(() => basicInfoToPatient(basic, base), [basic, base]);
  const dirty = savedPatient === null || !isSamePatientContent(livePatient, savedPatient);
  const patientName = [basic.patientFamilyName, basic.patientGivenName].filter((s) => s.trim() !== "").join(" ");

  /**
   * タブを切り替える。anchorId を渡すと、切り替えたあとそのタブの中の該当の要素（id）へスクロールする。
   * 省略するか要素が見つからなければ、画面の先頭へ戻す。
   */
  function goToStep(step: StepNo, anchorId?: string): void {
    setActiveStep(step);
    scrollAfterTabChange(anchorId);
  }

  /** 基本情報の作業コピーを入れ替える。下書きの元の印も合わせて更新し、下書き自体は有効なまま残す（会話から入れた値など、下書きの由来が同じ変更用） */
  function commitBasicKeepingDraft(next: BasicInfo, addAi: AiField[]): void {
    setBasic(next);
    setAiFields((prev) => [...new Set([...prev, ...addAi])]);
    if (session && !sessionStale) {
      setSession({ ...session, sourceKey: computeKeys(next, transcript, facilityName).draftSourceKey });
    }
    if (maskState && !maskStale) setMaskState(makeMaskState(next, transcript, facilityName));
  }

  function handleBasicChange(next: BasicInfo): void {
    setBasic(next);
    setNotice(null);
    // 手で直した項目は「AI の提案」のバッジを外す
    setAiFields((prev) => prev.filter((f) => next[f] === basic[f]));
  }

  function handleMask(): void {
    setMaskState(makeMaskState(basic, transcript, facilityName));
    setAckNoPatient(false);
    setAckWarnings(false);
    setLeakWarning(false);
    setDraftError(null);
  }

  /** 処方内容の欄を、薬剤の行だけに整える（人名・医療機関名・患者情報らしい行と見出しを外す）。すぐにマスクし直す */
  function handleTidyRx(): void {
    const n = normalizePrescription(basic.prescription);
    if (n.lines.length === 0 && !window.confirm("薬剤の行が残らないため、処方内容の欄が空になります。よろしいですか？")) return;
    const next: BasicInfo = { ...basic, prescription: n.lines.join("\n") };
    setBasic(next);
    setNotice(null);
    setMaskState(makeMaskState(next, transcript, facilityName));
    setAckNoPatient(false);
    setAckWarnings(false);
    setLeakWarning(false);
    setDraftError(null);
  }

  /** 警告に出た語（辞書に無い名前らしい語）を辞書に足して、すぐにマスクし直す */
  function handleAddMaskWord(text: string, kind: "family" | "other"): void {
    const word = text.trim();
    if (word === "") return;
    const next: BasicInfo =
      kind === "family"
        ? { ...basic, familyMembers: [...basic.familyMembers, { name: word, relation: "" }] }
        : { ...basic, otherMaskWords: basic.otherMaskWords.trim() === "" ? word : `${basic.otherMaskWords}、${word}` };
    setBasic(next);
    setNotice(null);
    setMaskState(makeMaskState(next, transcript, facilityName));
    setAckNoPatient(false);
    setAckWarnings(false);
    setLeakWarning(false);
    setDraftError(null);
  }

  async function handleDraft(): Promise<void> {
    if (!maskState || maskStale || drafting) return;
    // オフライン・API キー未設定のときは送らない（ボタンも止めているが、念のため）
    if (!online || (serverHealth !== null && !serverHealth.hasApiKey)) return;
    // 患者の氏名が未入力だとマスクできない。会話に患者名が見つからないときは、画面で了承が要る
    if (!basicFilled) return;
    const { masked, tokens } = maskState.result;
    if (!tokens.some((t) => t.kind === "patient") && !ackNoPatient) return;
    // 名前らしい語の警告が残っているときは、辞書に足すか、人名でないことを了承しないと送れない
    if (maskState.result.warnings.length > 0 && !ackWarnings) return;
    // 処方内容に人名・医療機関名・患者情報らしい行が残っているときも、了承が要る
    if (!ackRx) return;
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
      setDraftError(
        makeDraftError({
          error: "invalid_request",
          code: "bad_request",
          retryable: false,
          message: "会話が長すぎます（3万文字まで）。分けて作成してください。",
          elapsedSec: 0,
          model: serverHealth?.model || undefined,
        }),
      );
      return;
    }

    const body: DraftRequest = { recipientType: basic.recipientType, transcript: masked, context };
    const sentBaseId = base.id;
    setDrafting(true);
    setElapsedSec(0);
    setDraftError(null);

    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), DRAFT_TIMEOUT_MS);
    const startedAt = Date.now();
    const model = serverHealth?.model || undefined;
    // 失敗の形をそろえて作る（経過秒は送信からの実測）
    // 画面側の失敗（端末 → サーバーが届かない・時間切れ・応答が読めない）は from=device
    const fail = (e: Pick<DraftErrorInfo, "error" | "code" | "retryable" | "message">): DraftErrorInfo =>
      makeDraftError({ ...e, from: "device", elapsedSec: Math.round((Date.now() - startedAt) / 1000), model });
    let res: DraftResponse | null = null;
    let failure: DraftErrorInfo | null = null;
    let reached = false; // サーバーから応答の頭が戻ったか（戻ったあとの失敗は、通信ではなく応答の問題）
    try {
      const r = await fetch("/api/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      reached = true;
      const json: unknown = await r.json();
      if (typeof json !== "object" || json === null || typeof (json as { ok?: unknown }).ok !== "boolean") {
        throw new Error("unexpected response");
      }
      res = json as DraftResponse;
    } catch {
      if (controller.signal.aborted) {
        failure = fail({
          error: "network",
          code: "timeout",
          retryable: true,
          message: "時間がかかりすぎたため中止しました。もう一度試してください。",
        });
      } else if (reached) {
        failure = fail({
          error: "unknown",
          code: "unknown",
          retryable: true,
          message: "サーバーの応答を読み取れませんでした。もう一度試してください。",
        });
      } else {
        failure = fail({
          error: "network",
          code: "network",
          retryable: true,
          message: "サーバーに接続できませんでした。Wi-Fi とサーバーが動いているかを確認して、もう一度試してください。",
        });
      }
    } finally {
      window.clearTimeout(timer);
    }
    setDrafting(false);

    if (failure !== null || res === null) {
      setDraftError(failure);
      return;
    }
    if (!res.ok) {
      setDraftError(
        makeDraftError({
          error: res.error,
          code: res.code,
          retryable: res.retryable,
          message: res.message,
          from: "server",
          elapsedSec: Math.round((Date.now() - startedAt) / 1000),
          model,
        }),
      );
      return;
    }
    const parsed = ReportDraftSchema.safeParse(res.draft);
    if (!parsed.success) {
      setDraftError(
        makeDraftError({
          error: "unknown",
          code: "unknown",
          retryable: true,
          message: "下書きの形式が想定と違っていました。もう一度試してください。",
          from: "server",
          elapsedSec: Math.round((Date.now() - startedAt) / 1000),
          model: res.model || model,
        }),
      );
      return;
    }
    // 送信中に別の患者へ切り替えた。この下書きは前の患者のものなので捨てる
    const latest = latestRef.current;
    if (latest.baseId !== sentBaseId) return;

    // 会話から読み取れた基本情報を、患者の空欄だけに入れる（送信中に入力が変わっていたら入れない）。
    // 下書きの由来は同じなので、入れたあとの入力で下書きの元の印を取り直し、下書きを古い扱いにしない
    let sourceKey = draftSourceKey;
    let filledAny = false;
    if (latest.draftSourceKey === draftSourceKey) {
      const { basic: filledBasic, filled } = autoFillBlanks(latest.basic, parsed.data);
      if (filled.length > 0) {
        filledAny = true;
        sourceKey = computeKeys(filledBasic, transcript, facilityName).draftSourceKey;
        setBasic(filledBasic);
        setAiFields((prev) => [...new Set([...prev, ...filled])]);
        setMaskState(makeMaskState(filledBasic, transcript, facilityName));
        setNotice(null);
      }
    }
    setSession({
      draft: parsed.data,
      transcript: masked,
      tokens,
      recipientType: basic.recipientType,
      model: res.model,
      sourceKey,
    });
    setFinalizing(false);
    setConfirmed(false);
    goToStep(3, filledAny ? "suggestions" : undefined);
  }

  function updateDraft(next: ReportDraft): void {
    setSession((s) => (s ? { ...s, draft: next } : s));
  }

  /** マスク結果・下書き・確定を捨てる（別の患者・サンプルに入れ替えるとき、前の患者の下書きを残さない） */
  function resetWork(): void {
    setSession(null);
    setMaskState(null);
    setAckNoPatient(false);
    setAckWarnings(false);
    setFinalizing(false);
    setConfirmed(false);
    setDraftError(null);
    setLeakWarning(false);
  }

  /**
   * 患者を切り替える前の確認。保存していない変更や、作成済みの下書きが消えるときだけ尋ねる。
   * 患者を替えると、前の患者の辞書で作ったマスク結果・下書きは無効になる（fingerprint の印も変わる）。
   */
  function confirmLeave(clearTranscript: boolean): boolean {
    const lost: string[] = [];
    if (dirty && basicFilled) lost.push("患者リストに保存していない変更");
    if (session) lost.push("作成済みの下書きと会話");
    else if (clearTranscript && transcript.trim() !== "") lost.push("貼り付けた会話");
    if (lost.length === 0) return true;
    return window.confirm(`${lost.join("と")}が消えます。切り替えてよろしいですか？`);
  }

  /**
   * 作業用コピーを別の患者に入れ替える。前の患者の下書きは捨てる。
   * 別の患者へ切り替えるときは会話も空にする（前の患者の会話が次の患者の辞書でマスクされ、氏名が残るのを防ぐ）。
   * 「新しい患者」のときは、会話を先に貼ってから氏名を入れられるよう、下書きが無ければ会話を残す。
   */
  function beginPatient(patient: Patient, nextStore: PatientStore, visit: VisitFields, clearTranscript: boolean): void {
    if (session || clearTranscript) setTranscript("");
    resetWork();
    setStore(nextStore);
    setBase(patient);
    setBasic(patientToBasicInfo(patient, visit));
    setAiFields([]);
    setNotice(null);
    setImportStale(false);
  }

  /** 患者を切り替えたら、今回の訪問の報告日は今日に戻す（前の患者の日付を引き継がない） */
  function visitForSwitch(): VisitFields {
    return { ...visitOf(basic), reportDate: todayIso() };
  }

  function selectPatient(id: PatientId): void {
    const same = id === base.id && savedPatient !== null;
    // 同じ患者を選び直したとき、未保存の変更が無ければ何もしない。あれば確認のうえ、患者リストの記録を読み直す
    if (same && !dirty) return;
    const target = store.patients.find((p) => p.id === id);
    if (!target) return;
    if (!confirmLeave(!same)) return;
    beginPatient(target, { ...store, selectedPatientId: id }, same ? visitOf(basic) : visitForSwitch(), !same);
    setBasicOpen(false);
    // 選んだら①にとどまり、上の患者カード（申し送り・注意事項）を見せる。②へは「次へ」で進む
    goToStep(1);
  }

  /** 新しい患者（作業用コピーだけ。患者リストには「患者リストに保存」で登録）。preset で住まい・曜日・申し送りを最初から入れられる */
  function newPatient(preset?: Partial<PatientExtras>): void {
    if (!confirmLeave(false)) return;
    beginPatient({ ...createEmptyPatient(), ...preset }, { ...store, selectedPatientId: null }, visitForSwitch(), false);
    setBasicOpen(true);
    goToStep(1, "basic-body");
  }

  function editPatient(): void {
    setBasicOpen(true);
    goToStep(1, "basic-body");
  }

  /**
   * 患者カードで直接編集した住まい・訪問曜日・申し送りを、作業用コピーに重ねる。
   * 患者リストに登録済みなら、リストにも即保存する（基本情報の未保存の編集は巻き込まない）。未登録なら作業用コピーだけ。
   */
  function saveExtras(next: PatientExtras): void {
    const nextBase: Patient = { ...base, residence: next.residence, visitDays: next.visitDays, handoverNote: next.handoverNote };
    setBase(nextBase);
    if (savedPatient) {
      // 保存済みの記録に 3 項目だけ重ねる。作業用コピー側の未保存の編集（グループなど）はそのまま残る
      setStore(
        upsertPatient(store, {
          ...savedPatient,
          residence: next.residence,
          visitDays: next.visitDays,
          handoverNote: next.handoverNote,
        }),
      );
    }
  }

  /** 作業コピーを患者リストに書き戻す */
  function savePatient(): void {
    if (!basicFilled) return;
    const live = basicInfoToPatient(basic, base);
    const next: PatientStore = { ...upsertPatient(store, live), selectedPatientId: live.id };
    const saved = next.patients.find((p) => p.id === live.id) ?? live;
    const ok = saveStore(next);
    setStore(next);
    setBase(saved);
    setImportStale(false);
    // 保存時にカナなどが正規化されたら、作業コピーも同じ値にそろえる（下書きは有効なまま残す）
    const normalized = patientToBasicInfo(saved, {
      recipientType: basic.recipientType,
      reportDate: basic.reportDate,
      nextVisitDate: basic.nextVisitDate,
      pharmacy: basic.pharmacy,
      pharmacyContact: basic.pharmacyContact ?? "",
    });
    if (stableStringify(normalized) !== stableStringify(basic)) commitBasicKeepingDraft(normalized, []);
    setNotice(
      ok
        ? `${patientName} さんを患者リストに保存しました。`
        : "この端末のブラウザに保存できませんでした（プライベートモードなど）。画面を閉じると消えます。",
    );
  }

  function deleteCurrent(): void {
    if (!savedPatient) return;
    const name = patientName || "この患者";
    if (!window.confirm(`${name} さんを患者リストから削除します。患者の記録が端末から消え、元に戻せません。よろしいですか？`)) {
      return;
    }
    const next: PatientStore = { ...deletePatient(store, base.id), selectedPatientId: null };
    beginPatient(createEmptyPatient(), next, visitForSwitch(), true);
    setBasicOpen(true);
  }

  /** 患者リスト側の変更（グループの追加・削除、並べ替え）。削除されたグループは作業中の患者の所属からも外す */
  function handleStoreChange(next: PatientStore): void {
    setStore(next);
    setBase((b) => {
      const valid = b.groupIds.filter((id) => next.groups.some((g) => g.id === id));
      return valid.length === b.groupIds.length ? b : { ...b, groupIds: valid };
    });
  }

  /**
   * 書き出し・読み込みの結果を適用する。
   * 作業中の患者の記録が読み込みで変わったとき、作業用コピーとマスク辞書が古いままにならないようにする。
   * 作業用コピーが未編集なら読み込み後の内容に入れ替え、編集済みなら入れ替えずに注意を出す（黙って上書きしない）。
   */
  function handleImport(next: PatientStore): void {
    const updated = next.patients.find((p) => p.id === base.id) ?? null;
    const changed = savedPatient !== null && updated !== null && !isSamePatientContent(updated, savedPatient);
    if (!changed || updated === null) {
      handleStoreChange(next);
      return;
    }
    if (dirty) {
      handleStoreChange(next);
      setImportStale(true);
      return;
    }
    // 未編集: 読み込み後の内容に入れ替える。辞書が変わるのでマスク結果と下書きは捨てる（会話は残す）
    resetWork();
    setStore(next);
    setBase(updated);
    setBasic(patientToBasicInfo(updated, visitOf(basic)));
    setAiFields([]);
    setImportStale(false);
    setNotice("読み込みで内容が更新されたため、作業中の入力を新しい内容に切り替えました。マスクと下書きはやり直してください。");
  }

  function handleGroupIdsChange(ids: GroupId[]): void {
    setBase((b) => ({ ...b, groupIds: ids }));
    setNotice(null);
  }

  function applySuggestion(item: SuggestionItem): void {
    commitBasicKeepingDraft({ ...basic, ...item.patch }, item.fields);
  }

  /** 架空サンプルを読み込む（すべて架空。デモ・動作確認用） */
  function loadSample(id: SampleId): void {
    if (!confirmLeave(true)) return;
    const sample = findSample(id);
    const visit: VisitFields = {
      recipientType: sample.basic.recipientType,
      reportDate: sample.basic.reportDate,
      nextVisitDate: sample.basic.nextVisitDate,
      pharmacy: basic.pharmacy || sample.basic.pharmacy,
      pharmacyContact: basic.pharmacyContact || sample.basic.pharmacyContact || "",
    };

    // サンプルの住まい・曜日・申し送りを重ねる。施設のサンプルは、同名の施設が無ければ施設の台帳に作ってその id を入れる
    let working = store;
    let extras: PatientExtras = sample.extras;
    if (sample.extras.residence.kind === "facility" && sample.facilityName) {
      const facilityName = sample.facilityName;
      let facility = working.facilities.find((f) => f.name === facilityName);
      if (!facility) {
        const created = { ...createEmptyFacility(), name: facilityName };
        working = upsertFacility(working, created);
        facility = working.facilities.find((f) => f.name === facilityName) ?? created;
      }
      extras = { ...sample.extras, residence: { kind: "facility", facilityId: facility.id } };
    }

    if (sample.asNewPatient) {
      // 「新しい患者」として開く（患者リストには登録しない）。下書きのあと、会話から基本情報が自動入力され、
      // 「患者リストに保存」で登録する流れを見せるためのサンプル
      beginPatient({ ...createEmptyPatient(), ...extras }, { ...working, selectedPatientId: null }, visit, true);
      setBasic({ ...sample.basic, pharmacy: visit.pharmacy, pharmacyContact: visit.pharmacyContact });
      setTranscript(sample.transcript);
      setBasicOpen(false);
      goToStep(2);
      return;
    }

    // 登録済みの患者の流れ: 患者リストに無ければ追加して選ぶ（あれば住まい・曜日・申し送りだけサンプルの値に合わせる）
    let next = working;
    const found = next.patients.find(
      (p) =>
        p.familyName === sample.basic.patientFamilyName &&
        p.givenName === sample.basic.patientGivenName &&
        p.birthDate === sample.basic.birthDate,
    );
    const target: Patient = found
      ? { ...found, ...extras }
      : { ...basicInfoToPatient(sample.basic, createEmptyPatient()), ...extras };
    let patient: Patient = found ?? target;
    if (!found || !isSamePatientContent(target, found)) {
      next = upsertPatient(next, target);
      patient = next.patients.find((p) => p.id === target.id) ?? target;
    }
    next = { ...next, selectedPatientId: patient.id };
    beginPatient(patient, next, visit, true);
    setTranscript(sample.transcript);
    setBasicOpen(false);
    goToStep(2);
  }

  /** 作業中の入力（基本情報・会話・下書き）を空にする。patientsAlso のときは患者リストと薬局名も消す */
  function clearWork(patientsAlso: boolean): void {
    const pharmacy = patientsAlso ? "" : basic.pharmacy;
    const pharmacyContact = patientsAlso ? "" : (basic.pharmacyContact ?? "");
    if (patientsAlso) clearEverything();
    else clearAllSaved();
    const fresh = createEmptyPatient();
    setStore(patientsAlso ? createEmptyStore() : { ...store, selectedPatientId: null });
    setBase(fresh);
    setBasic(patientToBasicInfo(fresh, { ...visitOf(basic), pharmacy, pharmacyContact }));
    setTranscript("");
    setAiFields([]);
    setNotice(null);
    setImportStale(false);
    resetWork();
    setBasicOpen(true);
    // 消したら①（患者を選ぶところ）に戻る
    goToStep(1);
  }

  function clearSaved(): void {
    if (!window.confirm("作業中の基本情報・会話・下書きを消します。患者リストの記録は消えません。よろしいですか？")) return;
    clearWork(false);
  }

  function clearAll(): void {
    const n = store.patients.length;
    if (
      !window.confirm(
        `患者リスト（${n}人）・基本情報・会話・下書き・薬局名を、この端末からすべて消します。元に戻せません。よろしいですか？`,
      )
    ) {
      return;
    }
    clearWork(true);
  }

  const unsureLabels = useMemo(() => (session ? listUnsureLabels(session.draft) : []), [session]);

  // 会話から読み取った基本情報（下書きが今の入力から作ったものであるときだけ）
  const suggestionItems = useMemo(
    () => (session && !sessionStale ? buildSuggestionItems(basic, session.draft) : []),
    [session, sessionStale, basic],
  );
  const showSuggestions =
    session !== null &&
    !sessionStale &&
    (aiFields.length > 0 || savedPatient === null || suggestionItems.some((i) => !isSameAsCurrent(basic, i)));

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

  // メール・チャット・印刷（FAX）用。メール・チャットは既定で患者名を入れない（チェックで切り替え）
  const [includePatientName, setIncludePatientName] = useState(false);
  const sendFormats = useMemo(() => {
    if (!session || !confirmed || sessionStale) return null;
    const args: FormatArgs = {
      draft: session.draft,
      header: buildHeader(basic),
      fixedFields: buildFixedFields(basic),
      recipientType: session.recipientType,
      pharmacyContact: (basic.pharmacyContact ?? "").trim(),
      includePatientName,
      // 患者名を入れないとき、【家族N】を実名に戻さず続柄にする（辞書の family と同じ並び）
      familyRelations: (buildDictionary(basic).family ?? []).map((f) => f.relation),
      // 連絡事項: 空の件を除き先頭 3 件。名前を戻すのは下の back() が行う
      contactNotes: normalizeContactNotes(session.draft.contactNotes),
    };
    const back = (s: string) => unmaskText(s, session.tokens);
    const mail = buildEmail(args);
    return {
      email: { subject: back(mail.subject), body: back(mail.body) },
      chat: back(buildChat(args)),
      printModel: mapPrintModelText(buildPrintModel(args), back),
    };
  }, [session, confirmed, sessionStale, basic, includePatientName]);

  // ステップ表示
  const current = !basicFilled ? 1 : !session || sessionStale ? 2 : !confirmed ? 3 : 4;
  const statusOf = (n: 1 | 2 | 3 | 4): StepStatus => (n === current ? "current" : n < current ? "done" : "todo");
  const statuses = [statusOf(1), statusOf(2), statusOf(3), statusOf(4)] as const;

  // 「次へ」が押せないのは、①で患者の氏名が無いときだけ
  const nextDisabled = activeStep === 1 && !basicFilled;

  return (
    <>
      <StepBar statuses={statuses} active={activeStep} onJump={(step) => goToStep(step)} />
      <main className="mx-auto w-full max-w-[900px] space-y-6 px-4 pb-32 pt-6">
        {/* ①患者（hidden で隠すだけなので、入力中の内容は他のタブへ移っても保たれる） */}
        <div hidden={activeStep !== 1} className="space-y-6 print:hidden">
          <header>
            <h1 className="font-display text-3xl font-bold text-ai">在宅レポAI（仮）</h1>
            <p className="mt-1 text-base text-ink-muted">
              訪問中の会話から「居宅療養管理指導報告書」の下書きを作ります。AIは下書きまでです。確認と判断は薬剤師が行います。
            </p>
          </header>
          <BasicInfoSection
            basic={basic}
            onChange={handleBasicChange}
            open={basicOpen}
            onToggle={() => setBasicOpen((o) => !o)}
            groups={store.groups}
            groupIds={base.groupIds}
            onGroupIdsChange={handleGroupIdsChange}
            aiFields={aiFields}
            savedPrescription={savedPatient?.prescription ?? null}
            top={
              <>
                <PatientPicker
                  store={store}
                  selectedId={savedPatient ? base.id : null}
                  onSelect={selectPatient}
                  onNew={newPatient}
                  onStoreChange={handleStoreChange}
                  onImport={handleImport}
                  onLoadSample={loadSample}
                  onClearSaved={clearSaved}
                  onClearEverything={clearAll}
                />
                {/* 患者カード。まだ誰も選んでおらず氏名も無いとき（入口を見せるだけのとき）は出さない */}
                {patientName !== "" || savedPatient !== null ? (
                  <CurrentPatientBar
                    name={patientName}
                    saved={savedPatient !== null}
                    dirty={dirty}
                    canSave={basicFilled}
                    notice={notice}
                    onEdit={editPatient}
                    onSave={savePatient}
                    onDelete={deleteCurrent}
                    kana={basic.patientKana}
                    age={calcAge(basic.birthDate)}
                    extras={{ residence: base.residence, visitDays: base.visitDays, handoverNote: base.handoverNote }}
                    facilities={store.facilities}
                    onSaveExtras={saveExtras}
                  />
                ) : null}
                {importStale && dirty && savedPatient ? (
                  <WarnText>
                    読み込みで、この患者の記録が更新されました。いまの入力は古い内容のままです。そのまま保存すると読み込んだ内容を上書きします。読み込んだ内容を使うには、一覧でこの患者をもう一度選んでください（未保存の変更は消えます）。
                  </WarnText>
                ) : null}
              </>
            }
          />
        </div>

        {/* ②会話 */}
        <div hidden={activeStep !== 2} className="space-y-6 print:hidden">
          {shortcutImported && !maskState ? (
            <div id="shortcut-import" className="scroll-mt-24">
              {shortcutImported === "fragment" ? (
                <p className="rounded-xl border-2 border-ai bg-shiroai p-3 text-lg font-bold text-ink" role="status">
                  ショートカットの文字起こしを②の会話欄に入れました（URL の # の後ろで受け取り。サーバーには届いていません）。内容を確かめてから「個人名を見えないようマスク処理する」へ進んでください。
                </p>
              ) : (
                <WarnText>
                  ショートカットから、文字起こしが URL のクエリ（?result=）で届きました。この形は文字がこのアプリのサーバーにも送られるため、会話欄には入れていません。会話は「クリップボードから貼り付け」で入れてください。ショートカットの最後は「URL
                  を開く」（このアプリの URL の #t=）にし、x-callback-url は使わないでください。
                </WarnText>
              )}
            </div>
          ) : null}
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
            online={online}
            serverHealth={serverHealth}
            serverChecking={serverChecking}
            serverCheckFailed={serverCheckFailed}
            onRecheckServer={() => void recheckServer()}
            leakWarning={leakWarning}
            hasDraft={session !== null}
            maskedContext={maskState?.context ?? null}
            basicFilled={basicFilled}
            ackNoPatient={ackNoPatient}
            onAckNoPatientChange={setAckNoPatient}
            ackWarnings={ackWarnings}
            onAckWarningsChange={setAckWarnings}
            onAddMaskWord={handleAddMaskWord}
            rxRisky={rxRisky}
            ackRx={ackRx}
            onAckRxChange={(v) => setAckRxSig(v ? rxSig : null)}
            onTidyRx={handleTidyRx}
          />
        </div>

        {/* ③下書き */}
        <div hidden={activeStep !== 3} className="space-y-6 print:hidden">
          {!session ? (
            <Section id="step-3" title="③ 下書き">
              <p className="text-lg text-ink">
                まだ下書きがありません。②の会話で「個人名を見えないようマスク処理する」→「下書きを作る」を押すと、ここに下書きが出ます。
              </p>
            </Section>
          ) : null}
          {session && showSuggestions ? (
            <div id="suggestions" className="scroll-mt-24">
              <SuggestionPanel
                basic={basic}
                items={suggestionItems}
                aiFields={aiFields}
                saved={savedPatient !== null}
                dirty={dirty}
                canSave={basicFilled}
                onApply={applySuggestion}
                onSave={savePatient}
              />
            </div>
          ) : null}
          {session ? (
            <DraftSection
              draft={session.draft}
              onChange={updateDraft}
              transcript={session.transcript}
              stale={sessionStale}
              onProceed={() => {
                // 連絡事項の空の件を除き、先頭 3 件にしてから出力へ進む
                updateDraft(tidyDraft(session.draft));
                setFinalizing(true);
                goToStep(4);
              }}
            />
          ) : null}
        </div>

        {/* ④出力（印刷用の表示はここの OutputSection の中。④を開いているときだけ印刷できる） */}
        <div hidden={activeStep !== 4} className="space-y-6">
          {!(session && (finalizing || confirmed) && !sessionStale) ? (
            <Section id="step-4" title="④ 出力" className="print:hidden">
              <p className="text-lg text-ink">
                まだ出力できません。③で下書きを確認して「出力へ進む」を押すと、ここに報告書が出ます。
              </p>
            </Section>
          ) : null}
        {session && (finalizing || confirmed) && !sessionStale ? (
          <OutputSection
            unsureLabels={unsureLabels}
            confirmed={confirmed}
            onConfirm={() => setConfirmed(true)}
            onBackToEdit={() => {
              setConfirmed(false);
              setFinalizing(false);
              goToStep(3);
            }}
            reportText={reportText}
            email={sendFormats?.email ?? { subject: "", body: "" }}
            chat={sendFormats?.chat ?? ""}
            printModel={sendFormats?.printModel ?? null}
            includePatientName={includePatientName}
            onIncludePatientNameChange={setIncludePatientName}
            stale={sessionStale}
          />
        ) : null}
        </div>
      </main>
      <BottomNav
        step={activeStep}
        nextDisabled={nextDisabled}
        nextHint="患者を選ぶと進めます"
        onBack={() => goToStep(activeStep > 1 ? ((activeStep - 1) as StepNo) : 1)}
        onNext={() => goToStep(activeStep < 4 ? ((activeStep + 1) as StepNo) : 4)}
        onRestart={() => goToStep(1)}
      />
    </>
  );
}

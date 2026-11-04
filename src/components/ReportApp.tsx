"use client";

/**
 * 在宅レポAI（仮）の画面全体。
 * 流れ: ①患者（患者リストから選ぶ／新しい患者を登録） → ②会話（マスクして確認 → 下書きを作る） → ③下書きを確認・修正 → ④確定・出力。
 * 個人情報の境界: 氏名などの置き換え（マスク）と復元はこの画面（端末内）で行い、
 * /api/draft に送るのはマスク済み会話と、氏名を含まない文脈だけ。患者リストも端末内（localStorage）だけに置く。
 *
 * 患者リストが「マスター」で、基本情報（BasicInfo）は「今回の訪問の作業用コピー」。
 * 患者を選ぶと作業用コピーに読み込み、「患者リストに保存」で書き戻す。
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  createEmptyPatient,
  createEmptyStore,
  deletePatient,
  loadStore,
  saveStore,
  upsertPatient,
  type GroupId,
  type Patient,
  type PatientId,
  type PatientStore,
} from "@/lib/patients";
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
  loadSession,
  loadTranscript,
  loadWorkBase,
  saveRaw,
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
import { BasicInfoSection } from "./BasicInfoSection";
import { DraftSection } from "./DraftSection";
import { OutputSection } from "./OutputSection";
import { CurrentPatientBar } from "./patients/CurrentPatientBar";
import { PatientPicker } from "./patients/PatientPicker";
import { SuggestionPanel } from "./patients/SuggestionPanel";
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

/** 作業用コピーから、患者に持たない「今回の訪問」の値と端末の設定を取り出す。次回訪問日は患者ごとなので引き継がない */
function visitOf(b: BasicInfo): VisitFields {
  return {
    recipientType: b.recipientType,
    reportDate: b.reportDate || todayIso(),
    nextVisitDate: "",
    pharmacy: b.pharmacy,
  };
}

/** マスク辞書・マスク入力の印・下書きの元の印（今の入力から計算する。変わったら結果は古い） */
function computeKeys(b: BasicInfo, transcript: string) {
  const dictionary = buildDictionary(b);
  const maskKey = JSON.stringify([dictionary, transcript, buildContext(b)]);
  // 下書きの元は、マスク入力に宛先を足したもの（宛先で文面が変わるため）
  const draftSourceKey = fingerprint(`${maskKey}|${b.recipientType}`);
  return { dictionary, maskKey, draftSourceKey };
}

type MaskState = { result: MaskResult; key: string; context: DraftContext };

/** 会話と文脈欄の両方を同じ辞書でマスクする（result は両方で置き換えた記号をまとめたもの。context は AI に送る文脈） */
function makeMaskState(b: BasicInfo, transcript: string): MaskState {
  const { dictionary, maskKey } = computeKeys(b, transcript);
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
  const legacy: BasicInfo = { ...saved, pharmacy: loadPharmacy() ?? saved.pharmacy, reportDate: saved.reportDate || todayIso() };
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
  const [basicOpen, setBasicOpen] = useState(() => !isBasicFilled(init.basic));
  const [aiFields, setAiFields] = useState<AiField[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string>(loadTranscript);
  const [session, setSession] = useState<DraftSession | null>(loadSession);
  // result は会話と文脈欄の両方で置き換えた記号をまとめたもの。context は AI に送る文脈（マスク済み）
  const [maskState, setMaskState] = useState<MaskState | null>(null);
  const [ackNoPatient, setAckNoPatient] = useState(false);
  // 置き換えられなかった名前らしい語が残ったまま送ることを了承した（辞書に足せば警告は消える）
  const [ackWarnings, setAckWarnings] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [leakWarning, setLeakWarning] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  // 端末内に保存（失敗しても動く）
  useEffect(() => saveRaw("basic", JSON.stringify(basic)), [basic]);
  useEffect(() => saveRaw("pharmacy", basic.pharmacy), [basic.pharmacy]);
  useEffect(() => saveRaw("workbase", JSON.stringify(base)), [base]);
  useEffect(() => saveRaw("transcript", transcript), [transcript]);
  useEffect(() => saveRaw("session", session ? JSON.stringify(session) : null), [session]);
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

  const keys = useMemo(() => computeKeys(basic, transcript), [basic, transcript]);
  const { dictionary, maskKey, draftSourceKey } = keys;
  const maskStale = maskState !== null && maskState.key !== maskKey;
  const sessionStale = session !== null && session.sourceKey !== draftSourceKey;
  const basicFilled = isBasicFilled(basic);

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

  /** 基本情報の作業コピーを入れ替える。下書きの元の印も合わせて更新し、下書き自体は有効なまま残す（会話から入れた値など、下書きの由来が同じ変更用） */
  function commitBasicKeepingDraft(next: BasicInfo, addAi: AiField[]): void {
    setBasic(next);
    setAiFields((prev) => [...new Set([...prev, ...addAi])]);
    if (session && !sessionStale) {
      setSession({ ...session, sourceKey: computeKeys(next, transcript).draftSourceKey });
    }
    if (maskState && !maskStale) setMaskState(makeMaskState(next, transcript));
  }

  function handleBasicChange(next: BasicInfo): void {
    setBasic(next);
    setNotice(null);
    // 手で直した項目は「AI の提案」のバッジを外す
    setAiFields((prev) => prev.filter((f) => next[f] === basic[f]));
  }

  function handleMask(): void {
    setMaskState(makeMaskState(basic, transcript));
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
    setMaskState(makeMaskState(next, transcript));
    setAckNoPatient(false);
    setAckWarnings(false);
    setLeakWarning(false);
    setDraftError(null);
  }

  async function handleDraft(): Promise<void> {
    if (!maskState || maskStale || drafting) return;
    // 患者の氏名が未入力だとマスクできない。会話に患者名が見つからないときは、画面で了承が要る
    if (!basicFilled) return;
    const { masked, tokens } = maskState.result;
    if (!tokens.some((t) => t.kind === "patient") && !ackNoPatient) return;
    // 名前らしい語の警告が残っているときは、辞書に足すか、人名でないことを了承しないと送れない
    if (maskState.result.warnings.length > 0 && !ackWarnings) return;
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
    const sentBaseId = base.id;
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
        sourceKey = computeKeys(filledBasic, transcript).draftSourceKey;
        setBasic(filledBasic);
        setAiFields((prev) => [...new Set([...prev, ...filled])]);
        setMaskState(makeMaskState(filledBasic, transcript));
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
    scrollToId(filledAny ? "suggestions" : "step-3");
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
  }

  /** 患者を切り替えたら、今回の訪問の報告日は今日に戻す（前の患者の日付を引き継がない） */
  function visitForSwitch(): VisitFields {
    return { ...visitOf(basic), reportDate: todayIso() };
  }

  function selectPatient(id: PatientId): void {
    if (id === base.id && savedPatient) return;
    const target = store.patients.find((p) => p.id === id);
    if (!target) return;
    if (!confirmLeave(true)) return;
    beginPatient(target, { ...store, selectedPatientId: id }, visitForSwitch(), true);
    setBasicOpen(false);
    scrollToId("step-2");
  }

  function newPatient(): void {
    if (!confirmLeave(false)) return;
    beginPatient(createEmptyPatient(), { ...store, selectedPatientId: null }, visitForSwitch(), false);
    setBasicOpen(true);
    scrollToId("basic-body");
  }

  function editPatient(): void {
    setBasicOpen(true);
    scrollToId("basic-body");
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
    // 保存時にカナなどが正規化されたら、作業コピーも同じ値にそろえる（下書きは有効なまま残す）
    const normalized = patientToBasicInfo(saved, {
      recipientType: basic.recipientType,
      reportDate: basic.reportDate,
      nextVisitDate: basic.nextVisitDate,
      pharmacy: basic.pharmacy,
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

  function handleGroupIdsChange(ids: GroupId[]): void {
    setBase((b) => ({ ...b, groupIds: ids }));
    setNotice(null);
  }

  function applySuggestion(item: SuggestionItem): void {
    commitBasicKeepingDraft({ ...basic, ...item.patch }, item.fields);
  }

  function loadSample(): void {
    if (!confirmLeave(true)) return;
    // 患者リストに架空の「山本 花子」が無ければ追加して選ぶ
    const sample = YAMAMOTO_BASIC;
    let next = store;
    let patient = next.patients.find(
      (p) =>
        p.familyName === sample.patientFamilyName && p.givenName === sample.patientGivenName && p.birthDate === sample.birthDate,
    );
    if (!patient) {
      const created = basicInfoToPatient(sample, createEmptyPatient());
      next = upsertPatient(next, created);
      patient = next.patients.find((p) => p.id === created.id) ?? created;
    }
    next = { ...next, selectedPatientId: patient.id };
    beginPatient(
      patient,
      next,
      {
        recipientType: sample.recipientType,
        reportDate: sample.reportDate,
        nextVisitDate: sample.nextVisitDate,
        pharmacy: basic.pharmacy || sample.pharmacy,
      },
      true,
    );
    setTranscript(YAMAMOTO_TRANSCRIPT);
    setBasicOpen(false);
    scrollToId("step-2");
  }

  /** 作業中の入力（基本情報・会話・下書き）を空にする。patientsAlso のときは患者リストと薬局名も消す */
  function clearWork(patientsAlso: boolean): void {
    const pharmacy = patientsAlso ? "" : basic.pharmacy;
    if (patientsAlso) clearEverything();
    else clearAllSaved();
    const fresh = createEmptyPatient();
    setStore(patientsAlso ? createEmptyStore() : { ...store, selectedPatientId: null });
    setBase(fresh);
    setBasic(patientToBasicInfo(fresh, { ...visitOf(basic), pharmacy }));
    setTranscript("");
    setAiFields([]);
    setNotice(null);
    resetWork();
    setBasicOpen(true);
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

  // ステップ表示
  const current = !basicFilled ? 1 : !session || sessionStale ? 2 : !confirmed ? 3 : 4;
  const statusOf = (n: 1 | 2 | 3 | 4): StepStatus => (n === current ? "current" : n < current ? "done" : "todo");
  const statuses = [statusOf(1), statusOf(2), statusOf(3), statusOf(4)] as const;

  function jump(id: string): void {
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
            onChange={handleBasicChange}
            open={basicOpen}
            onToggle={() => setBasicOpen((o) => !o)}
            onLoadSample={loadSample}
            onClearSaved={clearSaved}
            onClearEverything={clearAll}
            groups={store.groups}
            groupIds={base.groupIds}
            onGroupIdsChange={handleGroupIdsChange}
            aiFields={aiFields}
            top={
              <>
                <PatientPicker
                  store={store}
                  selectedId={savedPatient ? base.id : null}
                  onSelect={selectPatient}
                  onNew={newPatient}
                  onStoreChange={handleStoreChange}
                />
                <CurrentPatientBar
                  name={patientName}
                  saved={savedPatient !== null}
                  dirty={dirty}
                  canSave={basicFilled}
                  notice={notice}
                  onEdit={editPatient}
                  onSave={savePatient}
                  onDelete={deleteCurrent}
                />
              </>
            }
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
            ackWarnings={ackWarnings}
            onAckWarningsChange={setAckWarnings}
            onAddMaskWord={handleAddMaskWord}
          />
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

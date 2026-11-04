/**
 * 患者リストの保存・読み込みと編集（純関数）。端末内の localStorage だけを使う。
 * 編集系の関数は元の store を変更せず、新しいオブジェクトを返す。
 */
import { normalizeKana } from "./search";
import { patientsInGroup } from "./sort";
import {
  PATIENT_STORE_KEY,
  type CreateEmptyPatientFn,
  type CreateEmptyStoreFn,
  type DeleteGroupFn,
  type DeletePatientFn,
  type Group,
  type GroupSortMode,
  type LoadStoreFn,
  type MovePatientInGroupFn,
  type Patient,
  type PatientStore,
  type SaveStoreFn,
  type SetGroupSortModeFn,
  type UpsertGroupFn,
  type UpsertPatientFn,
} from "./types";

export { PATIENT_STORE_KEY };

export const createEmptyStore: CreateEmptyStoreFn = () => ({
  version: 1,
  patients: [],
  groups: [],
  selectedPatientId: null,
});

function newId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export const createEmptyPatient: CreateEmptyPatientFn = () => {
  const now = new Date().toISOString();
  return {
    id: newId(),
    familyName: "",
    givenName: "",
    familyNameKana: "",
    givenNameKana: "",
    birthDate: "",
    sex: "",
    address: "",
    phone: "",
    familyNote: "",
    familyMembers: [],
    otherMaskWords: [],
    recipients: { careManager: "", doctor: "" },
    visitFrequency: { choice: "", note: "" },
    dispensingForm: "",
    medicationManager: "",
    managementMethod: "",
    prescription: { header: "", items: "", concomitant: "" },
    fixedFields: { counselingTarget: "", genericPreference: "", medicineNotebook: "" },
    groupIds: [],
    memo: "",
    createdAt: now,
    updatedAt: now,
  };
};

/* ---- 読み込み時の検査（壊れた・古い・手で書き換えられたデータに備える） ---- */

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export function sanitizePatient(raw: unknown, groupIds: Set<string>): Patient | null {
  if (!isObj(raw) || typeof raw.id !== "string" || raw.id === "") return null;
  const base = createEmptyPatient();
  const rec = isObj(raw.recipients) ? raw.recipients : {};
  const vf = isObj(raw.visitFrequency) ? raw.visitFrequency : {};
  const rx = isObj(raw.prescription) ? raw.prescription : {};
  const ff = isObj(raw.fixedFields) ? raw.fixedFields : {};
  const members = Array.isArray(raw.familyMembers) ? raw.familyMembers : [];
  return {
    id: raw.id,
    familyName: str(raw.familyName),
    givenName: str(raw.givenName),
    familyNameKana: str(raw.familyNameKana),
    givenNameKana: str(raw.givenNameKana),
    birthDate: str(raw.birthDate),
    sex: raw.sex === "男性" || raw.sex === "女性" ? raw.sex : "",
    address: str(raw.address),
    phone: str(raw.phone),
    familyNote: str(raw.familyNote),
    familyMembers: members
      .filter((m): m is Obj => isObj(m) && typeof m.name === "string" && typeof m.relation === "string")
      .map((m) => ({ name: str(m.name), relation: str(m.relation) })),
    otherMaskWords: strArr(raw.otherMaskWords),
    recipients: { careManager: str(rec.careManager), doctor: str(rec.doctor) },
    visitFrequency: { choice: str(vf.choice), note: str(vf.note) },
    dispensingForm: str(raw.dispensingForm),
    medicationManager: str(raw.medicationManager),
    managementMethod: str(raw.managementMethod),
    prescription: { header: str(rx.header), items: str(rx.items), concomitant: str(rx.concomitant) },
    fixedFields: {
      counselingTarget: str(ff.counselingTarget),
      genericPreference: str(ff.genericPreference),
      medicineNotebook: str(ff.medicineNotebook),
    },
    // 存在しないグループへの参照は捨てる（「未分類」の判定がずれないように）
    groupIds: strArr(raw.groupIds).filter((id) => groupIds.has(id)),
    memo: str(raw.memo),
    createdAt: str(raw.createdAt, base.createdAt),
    updatedAt: str(raw.updatedAt, base.updatedAt),
  };
}

export function sanitizeGroup(raw: unknown): Group | null {
  if (!isObj(raw) || typeof raw.id !== "string" || raw.id === "") return null;
  return {
    id: raw.id,
    name: str(raw.name),
    sortMode: raw.sortMode === "manual" ? "manual" : "kana",
    manualOrder: strArr(raw.manualOrder),
    createdAt: str(raw.createdAt, new Date().toISOString()),
  };
}

/** 保存データを検査して store にする。version が違う・形が不明なら null */
function sanitizeStore(raw: unknown): PatientStore | null {
  if (!isObj(raw) || raw.version !== 1 || !Array.isArray(raw.patients) || !Array.isArray(raw.groups)) return null;
  const groups = raw.groups.map(sanitizeGroup).filter((g): g is Group => g !== null);
  const groupIds = new Set(groups.map((g) => g.id));
  const patients = raw.patients.map((p) => sanitizePatient(p, groupIds)).filter((p): p is Patient => p !== null);
  const selected = typeof raw.selectedPatientId === "string" ? raw.selectedPatientId : null;
  return {
    version: 1,
    patients,
    groups,
    selectedPatientId: selected !== null && patients.some((p) => p.id === selected) ? selected : null,
  };
}

export const loadStore: LoadStoreFn = () => {
  try {
    const raw = window.localStorage.getItem(PATIENT_STORE_KEY);
    if (raw === null) return createEmptyStore();
    return sanitizeStore(JSON.parse(raw)) ?? createEmptyStore();
  } catch {
    return createEmptyStore();
  }
};

export const saveStore: SaveStoreFn = (store) => {
  try {
    window.localStorage.setItem(PATIENT_STORE_KEY, JSON.stringify(store));
    return true;
  } catch {
    // window が無い・容量超過・プライベートモードなど
    return false;
  }
};

/* ---- 編集 ---- */

/** 保存時の正規化: カナをカタカナに、姓名の前後の空白を除く */
function normalizePatient(p: Patient, updatedAt: string): Patient {
  return {
    ...p,
    familyName: p.familyName.trim(),
    givenName: p.givenName.trim(),
    familyNameKana: normalizeKana(p.familyNameKana),
    givenNameKana: normalizeKana(p.givenNameKana),
    updatedAt,
  };
}

export const upsertPatient: UpsertPatientFn = (store, patient) => {
  const normalized = normalizePatient(patient, new Date().toISOString());
  // 存在しないグループへの参照は捨てる（削除済みグループだけに属して、どの一覧にも出なくなるのを防ぐ）
  const groupIds = new Set(store.groups.map((g) => g.id));
  const next: Patient = { ...normalized, groupIds: normalized.groupIds.filter((id) => groupIds.has(id)) };
  const exists = store.patients.some((p) => p.id === next.id);
  return {
    ...store,
    patients: exists ? store.patients.map((p) => (p.id === next.id ? next : p)) : [...store.patients, next],
  };
};

export const deletePatient: DeletePatientFn = (store, id) => ({
  ...store,
  patients: store.patients.filter((p) => p.id !== id),
  groups: store.groups.map((g) => (g.manualOrder.includes(id) ? { ...g, manualOrder: g.manualOrder.filter((x) => x !== id) } : g)),
  selectedPatientId: store.selectedPatientId === id ? null : store.selectedPatientId,
});

export const upsertGroup: UpsertGroupFn = (store, group) => {
  const exists = store.groups.some((g) => g.id === group.id);
  return {
    ...store,
    groups: exists ? store.groups.map((g) => (g.id === group.id ? group : g)) : [...store.groups, group],
  };
};

export const deleteGroup: DeleteGroupFn = (store, id) => ({
  ...store,
  groups: store.groups.filter((g) => g.id !== id),
  patients: store.patients.map((p) => (p.groupIds.includes(id) ? { ...p, groupIds: p.groupIds.filter((x) => x !== id) } : p)),
});

export const movePatientInGroup: MovePatientInGroupFn = (store, groupId, patientId, delta) => {
  const group = store.groups.find((g) => g.id === groupId);
  if (!group) return store;
  // 今の表示順（kana なら五十音順、manual なら manualOrder → 残りはカナ順）を基準に動かす。
  // manualOrder が空・不完全でも、画面で見えている順のまま入れ替わる
  const order = patientsInGroup(store, groupId).map((p) => p.id);
  const from = order.indexOf(patientId);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= order.length) return store; // 端・グループ外は何もしない
  [order[from], order[to]] = [order[to], order[from]];
  const mode: GroupSortMode = "manual";
  return {
    ...store,
    groups: store.groups.map((g) => (g.id === groupId ? { ...g, sortMode: mode, manualOrder: order } : g)),
  };
};

export const setGroupSortMode: SetGroupSortModeFn = (store, groupId, mode) => ({
  ...store,
  groups: store.groups.map((g) => (g.id === groupId ? { ...g, sortMode: mode } : g)),
});

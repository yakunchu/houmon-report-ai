/**
 * 患者リストの保存・読み込みと編集（純関数）。端末内の localStorage だけを使う。
 * 編集系の関数は元の store を変更せず、新しいオブジェクトを返す。
 */
import { normalizeKana } from "./search";
import { patientsInScope } from "./sort";
import {
  PATIENT_STORE_KEY,
  type CreateEmptyFacilityFn,
  type CreateEmptyPatientFn,
  type CreateEmptyStoreFn,
  type DeleteFacilityFn,
  type DeleteGroupFn,
  type DeletePatientFn,
  type Facility,
  type Group,
  type GroupSortMode,
  type LoadStoreFn,
  type MovePatientInGroupFn,
  type MovePatientInScopeFn,
  type OrderScope,
  type Patient,
  type PatientStore,
  type Residence,
  type SaveStoreFn,
  type SetGroupSortModeFn,
  type SetManualOrderFn,
  type SetScopeSortModeFn,
  type UpdatePatientExtrasFn,
  type UpsertFacilityFn,
  type UpsertGroupFn,
  type UpsertPatientFn,
  type Weekday,
} from "./types";

export { PATIENT_STORE_KEY };

export const createEmptyStore: CreateEmptyStoreFn = () => ({
  version: 2,
  patients: [],
  groups: [],
  facilities: [],
  homeSortMode: "kana",
  homeManualOrder: [],
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
    residence: { kind: "home", facilityId: null },
    visitDays: [],
    handoverNote: "",
    createdAt: now,
    updatedAt: now,
  };
};

export const createEmptyFacility: CreateEmptyFacilityFn = () => {
  const now = new Date().toISOString();
  return {
    id: newId(),
    name: "",
    nameKana: "",
    groupIds: [],
    visitDays: [],
    sortMode: "kana",
    manualOrder: [],
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

/** 曜日の配列を検査する: 0〜6 の整数だけ残し、重複を除いて昇順にする */
export function sanitizeWeekdays(v: unknown): Weekday[] {
  if (!Array.isArray(v)) return [];
  const set = new Set<number>();
  for (const x of v) {
    if (typeof x === "number" && Number.isInteger(x) && x >= 0 && x <= 6) set.add(x);
  }
  return [...set].sort((a, b) => a - b) as Weekday[];
}

/** 住まいを検査する。個人宅なら facilityId は null、存在しない施設を指していれば null */
function sanitizeResidence(v: unknown, facilityIds: Set<string>): Residence {
  if (!isObj(v) || v.kind !== "facility") return { kind: "home", facilityId: null };
  const fid = typeof v.facilityId === "string" && facilityIds.has(v.facilityId) ? v.facilityId : null;
  return { kind: "facility", facilityId: fid };
}

export function sanitizePatient(raw: unknown, groupIds: Set<string>, facilityIds: Set<string> = new Set()): Patient | null {
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
    residence: sanitizeResidence(raw.residence, facilityIds),
    visitDays: sanitizeWeekdays(raw.visitDays),
    handoverNote: str(raw.handoverNote),
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

export function sanitizeFacility(raw: unknown, groupIds: Set<string>): Facility | null {
  if (!isObj(raw) || typeof raw.id !== "string" || raw.id === "") return null;
  const now = new Date().toISOString();
  return {
    id: raw.id,
    name: str(raw.name),
    nameKana: str(raw.nameKana),
    groupIds: strArr(raw.groupIds).filter((id) => groupIds.has(id)),
    visitDays: sanitizeWeekdays(raw.visitDays),
    sortMode: raw.sortMode === "manual" ? "manual" : "kana",
    manualOrder: strArr(raw.manualOrder),
    createdAt: str(raw.createdAt, now),
    updatedAt: str(raw.updatedAt, now),
  };
}

/** 保存データを検査して store にする。version が 1・2 以外・形が不明なら null。v1 は v2 の形に補う */
function sanitizeStore(raw: unknown): PatientStore | null {
  if (!isObj(raw) || (raw.version !== 1 && raw.version !== 2) || !Array.isArray(raw.patients) || !Array.isArray(raw.groups)) return null;
  const groups = raw.groups.map(sanitizeGroup).filter((g): g is Group => g !== null);
  const groupIds = new Set(groups.map((g) => g.id));
  const facilities = (Array.isArray(raw.facilities) ? raw.facilities : [])
    .map((f) => sanitizeFacility(f, groupIds))
    .filter((f): f is Facility => f !== null);
  const facilityIds = new Set(facilities.map((f) => f.id));
  const patients = raw.patients.map((p) => sanitizePatient(p, groupIds, facilityIds)).filter((p): p is Patient => p !== null);
  const selected = typeof raw.selectedPatientId === "string" ? raw.selectedPatientId : null;
  return {
    version: 2,
    patients,
    groups,
    facilities,
    homeSortMode: raw.homeSortMode === "manual" ? "manual" : "kana",
    homeManualOrder: strArr(raw.homeManualOrder),
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

/** 住まいを store の施設に照らして整える（個人宅は facilityId null、存在しない施設は null） */
function fixResidence(r: Residence, store: PatientStore): Residence {
  if (r.kind !== "facility") return { kind: "home", facilityId: null };
  const known = r.facilityId !== null && store.facilities.some((f) => f.id === r.facilityId);
  return { kind: "facility", facilityId: known ? r.facilityId : null };
}

export const upsertPatient: UpsertPatientFn = (store, patient) => {
  const normalized = normalizePatient(patient, new Date().toISOString());
  // 存在しないグループへの参照は捨てる（削除済みグループだけに属して、どの一覧にも出なくなるのを防ぐ）
  const groupIds = new Set(store.groups.map((g) => g.id));
  const next: Patient = {
    ...normalized,
    groupIds: normalized.groupIds.filter((id) => groupIds.has(id)),
    residence: fixResidence(normalized.residence, store),
    visitDays: sanitizeWeekdays(normalized.visitDays),
  };
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
  facilities: store.facilities.map((f) => (f.manualOrder.includes(id) ? { ...f, manualOrder: f.manualOrder.filter((x) => x !== id) } : f)),
  homeManualOrder: store.homeManualOrder.filter((x) => x !== id),
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
  facilities: store.facilities.map((f) => (f.groupIds.includes(id) ? { ...f, groupIds: f.groupIds.filter((x) => x !== id) } : f)),
});

export const upsertFacility: UpsertFacilityFn = (store, facility) => {
  const groupIds = new Set(store.groups.map((g) => g.id));
  const next: Facility = {
    ...facility,
    name: facility.name.trim(),
    nameKana: normalizeKana(facility.nameKana),
    groupIds: facility.groupIds.filter((id) => groupIds.has(id)),
    visitDays: sanitizeWeekdays(facility.visitDays),
    updatedAt: new Date().toISOString(),
  };
  const exists = store.facilities.some((f) => f.id === next.id);
  return {
    ...store,
    facilities: exists ? store.facilities.map((f) => (f.id === next.id ? next : f)) : [...store.facilities, next],
  };
};

export const deleteFacility: DeleteFacilityFn = (store, id) => ({
  ...store,
  facilities: store.facilities.filter((f) => f.id !== id),
  patients: store.patients.map((p) => (p.residence.facilityId === id ? { ...p, residence: { ...p.residence, facilityId: null } } : p)),
});

/* ---- 並び順（scope = 個人宅の全員・グループ・施設） ---- */

/** scope の並び設定を書き換えた store を返す（order が null なら manualOrder はそのまま）。scope が存在しなければ null */
function withScopeOrder(store: PatientStore, scope: OrderScope, mode: GroupSortMode, order: string[] | null): PatientStore | null {
  if (scope.kind === "home") {
    return { ...store, homeSortMode: mode, homeManualOrder: order ?? store.homeManualOrder };
  }
  if (scope.kind === "group") {
    if (!store.groups.some((g) => g.id === scope.groupId)) return null;
    return {
      ...store,
      groups: store.groups.map((g) => (g.id === scope.groupId ? { ...g, sortMode: mode, manualOrder: order ?? g.manualOrder } : g)),
    };
  }
  if (!store.facilities.some((f) => f.id === scope.facilityId)) return null;
  return {
    ...store,
    facilities: store.facilities.map((f) => (f.id === scope.facilityId ? { ...f, sortMode: mode, manualOrder: order ?? f.manualOrder } : f)),
  };
}

export const movePatientInScope: MovePatientInScopeFn = (store, scope, patientId, delta) => {
  // 今の表示順（kana なら五十音順、manual なら manualOrder → 残りはカナ順）を基準に動かす。
  // manualOrder が空・不完全でも、画面で見えている順のまま入れ替わる
  const order = patientsInScope(store, scope).map((p) => p.id);
  const from = order.indexOf(patientId);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= order.length) return store; // 端・scope 外は何もしない
  [order[from], order[to]] = [order[to], order[from]];
  return withScopeOrder(store, scope, "manual", order) ?? store;
};

export const setScopeSortMode: SetScopeSortModeFn = (store, scope, mode) => withScopeOrder(store, scope, mode, null) ?? store;

export const setManualOrder: SetManualOrderFn = (store, scope, orderedIds) => {
  const first = withScopeOrder(store, scope, "manual", [...new Set(orderedIds)]);
  if (!first) return store;
  // scope 外の id を捨て、含まれない患者を末尾にカナ順で続けた完全な並びを保存する
  const full = patientsInScope(first, scope).map((p) => p.id);
  return withScopeOrder(store, scope, "manual", full) ?? store;
};

export const movePatientInGroup: MovePatientInGroupFn = (store, groupId, patientId, delta) =>
  movePatientInScope(store, { kind: "group", groupId }, patientId, delta);

export const setGroupSortMode: SetGroupSortModeFn = (store, groupId, mode) => setScopeSortMode(store, { kind: "group", groupId }, mode);

export const updatePatientExtras: UpdatePatientExtrasFn = (store, id, extras) => {
  const target = store.patients.find((p) => p.id === id);
  if (!target) return store;
  const next: Patient = {
    ...target,
    residence: extras.residence !== undefined ? fixResidence(extras.residence, store) : target.residence,
    visitDays: extras.visitDays !== undefined ? sanitizeWeekdays(extras.visitDays) : target.visitDays,
    handoverNote: extras.handoverNote !== undefined ? extras.handoverNote : target.handoverNote,
    updatedAt: new Date().toISOString(),
  };
  return { ...store, patients: store.patients.map((p) => (p.id === id ? next : p)) };
};

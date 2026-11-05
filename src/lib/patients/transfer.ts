/**
 * 患者リストの書き出し・読み込み（純関数）。サーバーは介さず、端末どうしでファイルをやり取りする。
 * ファイルには実名が含まれる。暗号化は今回は無し（HTTPS 対応後の候補）。
 */
import { sanitizeGroup, sanitizePatient } from "./store";
import type {
  ExportFile,
  ExportFileNameFn,
  ExportStoreFn,
  Group,
  ImportSummary,
  MergeStoresFn,
  ParseExportFn,
  Patient,
  PatientStore,
} from "./types";

/** 読み込める文字列の上限（これを超えたら拒否） */
const MAX_TEXT_LENGTH = 10 * 1024 * 1024;

/** 読み込める件数・長さの上限（超えたら拒否。確認画面の前に画面が固まるのを防ぐ） */
export const MAX_PATIENTS = 5000;
export const MAX_GROUPS = 500;
/** 1 人あたりの familyMembers・otherMaskWords の件数 */
export const MAX_LIST_ITEMS = 100;
/** 文字列 1 つの長さ */
export const MAX_STRING_LENGTH = 10000;

/* ---- 書き出し ---- */

export const exportStore: ExportStoreFn = (store, exportedAt) => {
  const file: ExportFile = {
    app: "houmon-report-ai",
    kind: "patient-list",
    version: 1,
    exportedAt,
    patients: store.patients,
    groups: store.groups,
  };
  return JSON.stringify(file, null, 2);
};

/**
 * 受け渡しコード用の JSON（書き出しファイルと同じ形。サーバーに預ける量を減らすため整形しない）。
 * patientId を渡すと、その患者 1 人と、その人が入っているグループだけにする（グループの手動並びはその人だけ）。
 * 見つからないときは null。
 */
export function exportForRelay(store: PatientStore, exportedAt: string, patientId?: string): string | null {
  let patients = store.patients;
  let groups = store.groups;
  if (patientId !== undefined) {
    const p = store.patients.find((x) => x.id === patientId);
    if (!p) return null;
    patients = [p];
    groups = store.groups
      .filter((g) => p.groupIds.includes(g.id))
      .map((g) => ({ ...g, manualOrder: g.manualOrder.includes(p.id) ? [p.id] : [] }));
  }
  const file: ExportFile = {
    app: "houmon-report-ai",
    kind: "patient-list",
    version: 1,
    exportedAt,
    patients,
    groups,
  };
  return JSON.stringify(file);
}

export const exportFileName: ExportFileNameFn = (exportedAt) => {
  let d = new Date(exportedAt);
  if (Number.isNaN(d.getTime())) d = new Date();
  const p2 = (n: number) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}`;
  const time = `${p2(d.getHours())}${p2(d.getMinutes())}`;
  return `houmon-report-ai_患者リスト_${date}-${time}.json`;
};

/* ---- 読み込みの検査 ---- */

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 値の中（入れ子も含む）に長すぎる文字列があるか */
function hasLongString(v: unknown): boolean {
  if (typeof v === "string") return v.length > MAX_STRING_LENGTH;
  if (Array.isArray(v)) return v.some(hasLongString);
  if (isObj(v)) return Object.values(v).some(hasLongString);
  return false;
}

export const parseExport: ParseExportFn = (text) => {
  if (typeof text !== "string" || text.length > MAX_TEXT_LENGTH) {
    return { ok: false, message: "ファイルが大きすぎます（10 MB を超えています）" };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, message: "ファイルの形式が読めません（JSON ではありません）" };
  }
  if (!isObj(raw) || raw.app !== "houmon-report-ai" || raw.kind !== "patient-list") {
    return { ok: false, message: "このアプリの患者リストのファイルではありません" };
  }
  if (raw.version !== 1) {
    return { ok: false, message: `対応していない版です（version ${String(raw.version)}）` };
  }
  if (!Array.isArray(raw.patients) || !Array.isArray(raw.groups)) {
    return { ok: false, message: "患者リストの形式が正しくありません（patients / groups がありません）" };
  }

  // 件数の上限（検査・突き合わせの前に見る）
  if (raw.patients.length > MAX_PATIENTS) {
    return { ok: false, message: `患者が多すぎます（${MAX_PATIENTS.toLocaleString("en-US")} 人まで）` };
  }
  if (raw.groups.length > MAX_GROUPS) {
    return { ok: false, message: `グループが多すぎます（${MAX_GROUPS.toLocaleString("en-US")} 件まで）` };
  }

  const warnings: string[] = [];

  // グループ: id と名前があり、id が重複しないものだけ残す
  const groups: Group[] = [];
  const groupIdSet = new Set<string>();
  let badGroups = 0;
  let dupGroups = 0;
  for (const rg of raw.groups) {
    const g = sanitizeGroup(rg);
    if (g && (g.manualOrder.length > MAX_PATIENTS || hasLongString(g))) {
      return { ok: false, message: "グループの内容が大きすぎます（並びの人数か文字数が上限を超えています）" };
    }
    if (!g || g.name.trim() === "") {
      badGroups++;
      continue;
    }
    if (groupIdSet.has(g.id)) {
      dupGroups++;
      continue;
    }
    groupIdSet.add(g.id);
    groups.push({ ...g, name: g.name.trim() });
  }
  if (badGroups > 0) warnings.push(`グループ ${badGroups} 件を読み飛ばしました（名前か id がありません）`);
  if (dupGroups > 0) warnings.push(`グループ ${dupGroups} 件を読み飛ばしました（id が重複しています）`);

  // 患者: id と氏名があり、id が重複しないものだけ残す（groupIds は読み込み側のグループにあるものだけ）
  const patients: Patient[] = [];
  const patientIdSet = new Set<string>();
  let badPatients = 0;
  let dupPatients = 0;
  for (const rp of raw.patients) {
    const p = sanitizePatient(rp, groupIdSet);
    if (p && (p.familyMembers.length > MAX_LIST_ITEMS || p.otherMaskWords.length > MAX_LIST_ITEMS)) {
      return { ok: false, message: `患者 1 人あたりの家族・マスク語が多すぎます（${MAX_LIST_ITEMS} 件まで）` };
    }
    if (p && hasLongString(p)) {
      return { ok: false, message: `文字数が多すぎる項目があります（1 項目 ${MAX_STRING_LENGTH.toLocaleString("en-US")} 文字まで）` };
    }
    if (!p || (p.familyName.trim() === "" && p.givenName.trim() === "")) {
      badPatients++;
      continue;
    }
    if (patientIdSet.has(p.id)) {
      dupPatients++;
      continue;
    }
    patientIdSet.add(p.id);
    patients.push(p);
  }
  if (badPatients > 0) warnings.push(`患者 ${badPatients} 件を読み飛ばしました（氏名か id がありません）`);
  if (dupPatients > 0) warnings.push(`患者 ${dupPatients} 件を読み飛ばしました（id が重複しています）`);

  // 手動並びは、ファイルにいる患者だけに絞る
  const fixedGroups = groups.map((g) => ({ ...g, manualOrder: g.manualOrder.filter((id) => patientIdSet.has(id)) }));

  const file: ExportFile = {
    app: "houmon-report-ai",
    kind: "patient-list",
    version: 1,
    exportedAt: typeof raw.exportedAt === "string" ? raw.exportedAt : "",
    patients,
    groups: fixedGroups,
  };
  return { ok: true, file, warnings };
};

/* ---- 読み込みの適用 ---- */

function newId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** used に無い id を返す（希望の id が空いていればそれ）。返した id は used に入れる */
function freshId(preferred: string, used: Set<string>): string {
  let id = preferred !== "" && !used.has(preferred) ? preferred : newId();
  while (used.has(id)) id = newId(); // 万一の衝突に備える
  used.add(id);
  return id;
}

/** 同じ人の判定キー: 姓・名の空白を整え（全角→半角）、生年月日は trim */
function personKey(p: Patient): string {
  const n = (s: string) => s.replace(/[\s　]+/g, " ").trim();
  return `${n(p.familyName)}\u0000${n(p.givenName)}\u0000${p.birthDate.trim()}`;
}

/** a が b より新しいか。a が読めなければ false、b だけ読めなければ true */
function isNewer(a: string, b: string): boolean {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta)) return false;
  if (Number.isNaN(tb)) return true;
  return ta > tb;
}

function unique(ids: string[]): string[] {
  return [...new Set(ids)];
}

function replaceStore(incoming: ExportFile): { store: PatientStore; summary: ImportSummary } {
  const groups = structuredClone(incoming.groups);
  const groupIds = new Set(groups.map((g) => g.id));
  const patients = structuredClone(incoming.patients).map((p) => ({
    ...p,
    groupIds: unique(p.groupIds.filter((id) => groupIds.has(id))),
  }));
  return {
    store: { version: 1, patients, groups, selectedPatientId: null },
    summary: { added: patients.length, updated: 0, unchanged: 0, groupsAdded: groups.length, warnings: [] },
  };
}

export const mergeStores: MergeStoresFn = (local, incoming, mode) => {
  if (mode === "replace") return replaceStore(incoming);

  const warnings: string[] = [];

  // グループ: 名前（trim）で突き合わせ。無ければ追加
  const groups: Group[] = local.groups.map((g) => ({ ...g, manualOrder: [...g.manualOrder] }));
  const usedGroupIds = new Set(groups.map((g) => g.id));
  const groupByName = new Map<string, Group>();
  for (const g of groups) {
    const name = g.name.trim();
    if (!groupByName.has(name)) groupByName.set(name, g);
  }
  const groupIdMap = new Map<string, string>(); // 読み込み側の id → 結果の id
  const incomingOrder = new Map<string, string[]>(); // 新しく追加したグループの id → 読み込み側の manualOrder
  let groupsAdded = 0;
  for (const ig of incoming.groups) {
    const name = ig.name.trim();
    const hit = groupByName.get(name);
    if (hit) {
      groupIdMap.set(ig.id, hit.id);
      continue;
    }
    const created: Group = { ...structuredClone(ig), id: freshId(ig.id, usedGroupIds), name, manualOrder: [] };
    groups.push(created);
    groupByName.set(name, created);
    groupIdMap.set(ig.id, created.id);
    incomingOrder.set(created.id, ig.manualOrder);
    groupsAdded++;
  }

  // 患者: 氏名 + 生年月日で突き合わせ
  const patients: Patient[] = local.patients.map((p) => structuredClone(p));
  const usedPatientIds = new Set(patients.map((p) => p.id));
  const indexByKey = new Map<string, number>();
  patients.forEach((p, i) => {
    const key = personKey(p);
    if (!indexByKey.has(key)) indexByKey.set(key, i);
  });
  const patientIdMap = new Map<string, string>(); // 読み込み側の id → 結果の id
  const addedByImport = new Set<string>(); // 今回の読み込みで追加した患者の id
  const touched = new Set<string>(); // 追加・更新した患者の id
  let added = 0;
  let updated = 0;
  let unchanged = 0;
  let duplicatesInFile = 0;

  for (const ip of incoming.patients) {
    const mappedGroupIds = unique(ip.groupIds.map((id) => groupIdMap.get(id)).filter((id): id is string => id !== undefined));
    const key = personKey(ip);
    const idx = indexByKey.get(key);

    if (idx === undefined) {
      const id = freshId(ip.id, usedPatientIds);
      patients.push({ ...structuredClone(ip), id, groupIds: mappedGroupIds });
      indexByKey.set(key, patients.length - 1);
      patientIdMap.set(ip.id, id);
      addedByImport.add(id);
      touched.add(id);
      added++;
      continue;
    }

    const existing = patients[idx];
    patientIdMap.set(ip.id, existing.id);
    const fromImport = addedByImport.has(existing.id);
    if (fromImport) duplicatesInFile++;
    if (isNewer(ip.updatedAt, existing.updatedAt)) {
      // 読み込み側が新しい: 内容は読み込み側、id と createdAt は端末側
      patients[idx] = { ...structuredClone(ip), id: existing.id, createdAt: existing.createdAt, groupIds: mappedGroupIds };
      touched.add(existing.id);
      if (!fromImport) updated++;
    } else if (!fromImport) {
      unchanged++;
    }
  }
  if (duplicatesInFile > 0) {
    warnings.push(`ファイル内で同じ人が重複していた患者 ${duplicatesInFile} 件を 1 人にまとめました`);
  }

  // 手動並び: 新しいグループは読み込み側の並びを付け替え、増えた・更新された人は末尾に足す
  // グループ id → 所属患者 id（患者の並び順）を 1 回の走査で作る
  const membersByGroup = new Map<string, Set<string>>();
  for (const p of patients) {
    for (const gid of p.groupIds) {
      let set = membersByGroup.get(gid);
      if (!set) {
        set = new Set();
        membersByGroup.set(gid, set);
      }
      set.add(p.id);
    }
  }
  const noMembers = new Set<string>();
  const finalGroups = groups.map((g) => {
    const members = membersByGroup.get(g.id) ?? noMembers;
    let order = g.manualOrder;
    const fromIncoming = incomingOrder.get(g.id);
    if (fromIncoming) {
      order = fromIncoming.map((id) => patientIdMap.get(id)).filter((id): id is string => id !== undefined && members.has(id));
    }
    if (g.sortMode === "manual") {
      const have = new Set(order);
      const tail = [...members].filter((id) => touched.has(id) && !have.has(id));
      order = [...order, ...tail];
    }
    return { ...g, manualOrder: unique(order) };
  });

  return {
    store: { version: 1, patients, groups: finalGroups, selectedPatientId: local.selectedPatientId },
    summary: { added, updated, unchanged, groupsAdded, warnings },
  };
};

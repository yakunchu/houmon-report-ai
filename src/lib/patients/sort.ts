/** 患者の並び順（あいうえお順・手動）。純関数。 */
import type { GroupFilter, Patient, PatientsInGroupFn, PatientStore, SortByKanaFn } from "./types";

const collator = new Intl.Collator("ja");

/** カナが空なら氏名で代用して比較する（カナの無い人も同じ土俵で並ぶ） */
function comparePatients(a: Patient, b: Patient): number {
  return (
    collator.compare(a.familyNameKana || a.familyName, b.familyNameKana || b.familyName) ||
    collator.compare(a.givenNameKana || a.givenName, b.givenNameKana || b.givenName) ||
    collator.compare(a.familyName, b.familyName) ||
    collator.compare(a.givenName, b.givenName)
  );
}

export const sortByKana: SortByKanaFn = (patients) => [...patients].sort(comparePatients);

/** 手動並び: order にある順 → 含まれない人はカナ順で末尾 */
function applyManualOrder(members: Patient[], order: string[]): Patient[] {
  const byId = new Map(members.map((p) => [p.id, p]));
  const placed: Patient[] = [];
  for (const id of order) {
    const p = byId.get(id);
    if (p) {
      placed.push(p);
      byId.delete(id); // manualOrder に重複があっても 1 回だけ
    }
  }
  return [...placed, ...sortByKana([...byId.values()])];
}

export const patientsInGroup: PatientsInGroupFn = (store: PatientStore, filter: GroupFilter) => {
  if (filter === "all") return sortByKana(store.patients);
  if (filter === "ungrouped") return sortByKana(store.patients.filter((p) => p.groupIds.length === 0));

  const members = store.patients.filter((p) => p.groupIds.includes(filter));
  const group = store.groups.find((g) => g.id === filter);
  if (!group || group.sortMode !== "manual") return sortByKana(members);
  return applyManualOrder(members, group.manualOrder);
};

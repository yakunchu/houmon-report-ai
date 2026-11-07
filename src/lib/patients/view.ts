/**
 * 患者・施設の一覧の区分け（純関数）。画面 v2（docs/UI-V2.md §3）。
 * 契約は types.ts の「view.ts」の節。並びの計算は sort.ts に任せ、ここでは見出しごとにまとめるだけ。
 */
import { patientsInScope } from "./sort";
import {
  WEEKDAYS,
  WEEKDAY_LABELS,
  type Facility,
  type ListSection,
  type MoveItemFn,
  type Patient,
  type PatientStore,
  type Weekday,
} from "./types";

/** 見出しの並び（五十音の行 → 他） */
export const KANA_ROWS = ["あ", "か", "さ", "た", "な", "は", "ま", "や", "ら", "わ"] as const;
export const KANA_OTHER = "他";

/** 行ごとの先頭のカタカナ（濁音・半濁音・小書きを外した形） */
const ROW_OF_BASE: Record<string, (typeof KANA_ROWS)[number]> = {};
const ROW_CHARS: Record<(typeof KANA_ROWS)[number], string> = {
  あ: "アイウエオ",
  か: "カキクケコ",
  さ: "サシスセソ",
  た: "タチツテト",
  な: "ナニヌネノ",
  は: "ハヒフヘホ",
  ま: "マミムメモ",
  や: "ヤユヨ",
  ら: "ラリルレロ",
  わ: "ワヰヱヲン",
};
for (const row of KANA_ROWS) {
  for (const ch of ROW_CHARS[row]) ROW_OF_BASE[ch] = row;
}

/** 小書きのカナ → 大きいカナ */
const SMALL_TO_LARGE: Record<string, string> = {
  ァ: "ア",
  ィ: "イ",
  ゥ: "ウ",
  ェ: "エ",
  ォ: "オ",
  ッ: "ツ",
  ャ: "ヤ",
  ュ: "ユ",
  ョ: "ヨ",
  ヮ: "ワ",
  ヵ: "カ",
  ヶ: "ケ",
};

/** 1 文字を「濁点・半濁点・小書き・ひらがな・半角」の違いを吸収したカタカナの基本形にする */
function baseKana(ch: string): string {
  let s = ch.normalize("NFKC");
  // ひらがな（ぁ〜ゖ）→ カタカナ
  s = s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
  // 濁点・半濁点を外す（ガ → カ + 結合濁点）
  s = s.normalize("NFD").charAt(0);
  if (s === "ヴ") return "ウ";
  return SMALL_TO_LARGE[s] ?? s;
}

/** カナ 1 文字から行の見出し（「あ」…「わ」。それ以外は「他」） */
export function kanaRowOfString(text: string): string {
  const trimmed = text.trim();
  if (trimmed === "") return KANA_OTHER;
  const first = Array.from(trimmed)[0] ?? "";
  return ROW_OF_BASE[baseKana(first)] ?? KANA_OTHER;
}

/** 五十音の見出し。カナが空ならカナで読める氏名（ひらがな・カタカナ）で代用し、それも無ければ「他」 */
export function kanaRowOf(p: Patient): string {
  const fromKana = kanaRowOfString(p.familyNameKana);
  if (fromKana !== KANA_OTHER) return fromKana;
  if (p.familyNameKana.trim() !== "") return KANA_OTHER;
  return kanaRowOfString(p.familyName);
}

/** 施設の五十音の見出し（nameKana → 無ければ name） */
export function kanaRowOfFacility(f: Facility): string {
  const fromKana = kanaRowOfString(f.nameKana);
  if (fromKana !== KANA_OTHER) return fromKana;
  if (f.nameKana.trim() !== "") return KANA_OTHER;
  return kanaRowOfString(f.name);
}

/** 入力の並びを保ったまま、見出しごとにまとめる（空の区分は出さない。「他」は最後） */
function sectionsByKeyFn<T>(items: readonly T[], keyOf: (item: T) => string): ListSection<T>[] {
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const list = buckets.get(key);
    if (list) list.push(item);
    else buckets.set(key, [item]);
  }
  const order = [...KANA_ROWS, KANA_OTHER];
  return order.flatMap((key) => {
    const list = buckets.get(key);
    return list ? [{ key, title: key, items: list }] : [];
  });
}

export function sectionsByKana(patients: Patient[]): ListSection[] {
  return sectionsByKeyFn(patients, kanaRowOf);
}

export function facilitySectionsByKana(facilities: Facility[]): ListSection<Facility>[] {
  return sectionsByKeyFn(facilities, kanaRowOfFacility);
}

export const UNGROUPED_KEY = "ungrouped";
export const NO_WEEKDAY_KEY = "none";

export function weekdayKey(day: Weekday): string {
  return `w${day}`;
}

export function weekdayTitle(day: Weekday): string {
  return `${WEEKDAY_LABELS[day]}曜日`;
}

/** 有効な曜日（0〜6）だけにして重複を除く */
function validDays(days: readonly number[] | undefined): Weekday[] {
  const set = new Set<number>(days ?? []);
  return WEEKDAYS.filter((d) => set.has(d));
}

/**
 * グループ別。store.groups の順 → 最後に「グループなし」。空の区分は出さない。
 * 各区分の並びは patientsInScope(group) の順に従い、入力 patients に含まれる人だけを出す。
 * 複数のグループに入っている人は各グループに出る。
 */
export function sectionsByGroup(store: PatientStore, patients: Patient[]): ListSection[] {
  const ids = new Set(patients.map((p) => p.id));
  const groupIds = new Set(store.groups.map((g) => g.id));
  const sections: ListSection[] = [];
  for (const g of store.groups) {
    const items = patientsInScope(store, { kind: "group", groupId: g.id }).filter((p) => ids.has(p.id));
    if (items.length > 0) sections.push({ key: g.id, title: g.name, items });
  }
  // 存在しないグループだけを指している人も「グループなし」に入れる
  const none = patients.filter((p) => !p.groupIds.some((id) => groupIds.has(id)));
  if (none.length > 0) sections.push({ key: UNGROUPED_KEY, title: "グループなし", items: none });
  return sections;
}

/** 曜日別（月〜日 → 最後に「曜日なし」）。複数曜日の人は各曜日に出る。入力の並びを保つ */
export function sectionsByWeekday(patients: Patient[]): ListSection[] {
  const sections: ListSection[] = [];
  for (const day of WEEKDAYS) {
    const items = patients.filter((p) => validDays(p.visitDays).includes(day));
    if (items.length > 0) sections.push({ key: weekdayKey(day), title: weekdayTitle(day), items });
  }
  const none = patients.filter((p) => validDays(p.visitDays).length === 0);
  if (none.length > 0) sections.push({ key: NO_WEEKDAY_KEY, title: "曜日なし", items: none });
  return sections;
}

/** 施設のグループ別。並びは入力順を保つ */
export function facilitySectionsByGroup(store: PatientStore, facilities: Facility[]): ListSection<Facility>[] {
  const groupIds = new Set(store.groups.map((g) => g.id));
  const sections: ListSection<Facility>[] = [];
  for (const g of store.groups) {
    const items = facilities.filter((f) => f.groupIds.includes(g.id));
    if (items.length > 0) sections.push({ key: g.id, title: g.name, items });
  }
  const none = facilities.filter((f) => !f.groupIds.some((id) => groupIds.has(id)));
  if (none.length > 0) sections.push({ key: UNGROUPED_KEY, title: "グループなし", items: none });
  return sections;
}

/** 施設の曜日別。並びは入力順を保つ */
export function facilitySectionsByWeekday(facilities: Facility[]): ListSection<Facility>[] {
  const sections: ListSection<Facility>[] = [];
  for (const day of WEEKDAYS) {
    const items = facilities.filter((f) => validDays(f.visitDays).includes(day));
    if (items.length > 0) sections.push({ key: weekdayKey(day), title: weekdayTitle(day), items });
  }
  const none = facilities.filter((f) => validDays(f.visitDays).length === 0);
  if (none.length > 0) sections.push({ key: NO_WEEKDAY_KEY, title: "曜日なし", items: none });
  return sections;
}

/** 配列の from 番目を to 番目へ動かした新しい配列。範囲外の添字は元のコピーを返す */
export const moveItem: MoveItemFn = (items, from, to) => {
  const next = [...items];
  if (from < 0 || from >= next.length || to < 0 || to >= next.length || from === to) return next;
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
};

/**
 * 全体の並び full のうち、subset に含まれる人の位置だけを、subsetOrdered の順に入れ替える。
 * 画面に出ている一部の人（例: グループのうち個人宅の人だけ）をドラッグしても、画面に出ていない人の位置を動かさないために使う。
 * subsetOrdered に full に無い id があれば無視する。
 */
export function mergeSubsetOrder(full: readonly string[], subsetOrdered: readonly string[]): string[] {
  const inFull = new Set(full);
  const queue = subsetOrdered.filter((id) => inFull.has(id));
  const inSubset = new Set(queue);
  let i = 0;
  return full.map((id) => (inSubset.has(id) ? (queue[i++] ?? id) : id));
}

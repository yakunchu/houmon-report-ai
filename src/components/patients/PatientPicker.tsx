"use client";

/**
 * 患者リスト（選ぶ・探す・並べる）。
 * - 検索: 氏名・カナ・生年月日
 * - グループ: 全員／未分類／各グループで絞り込み。グループごとに「あいうえお順」か「手動（↑↓）」
 * - 患者データはこの端末の中だけ。ここでは何も送信しない。
 */
import { useMemo, useState } from "react";
import {
  calcAge,
  formatBirthDate,
  movePatientInGroup,
  patientsInGroup,
  searchPatients,
  setGroupSortMode,
  type GroupFilter,
  type GroupSortMode,
  type Patient,
  type PatientId,
  type PatientStore,
} from "@/lib/patients";
import { Button, inputClass } from "../ui";
import { GroupManager } from "./GroupManager";

type Props = {
  store: PatientStore;
  /** 患者リストに登録済みで、いま作業中の患者（未登録の新しい患者なら null） */
  selectedId: PatientId | null;
  onSelect: (id: PatientId) => void;
  onNew: () => void;
  onStoreChange: (next: PatientStore) => void;
};

function fullName(p: Patient): string {
  return [p.familyName, p.givenName].filter(Boolean).join(" ") || "（氏名なし）";
}

function filterButtonClass(selected: boolean): string {
  return `inline-flex min-h-12 cursor-pointer items-center justify-center gap-1 rounded-lg border-2 px-4 py-2 text-lg font-bold focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-blue-700 ${
    selected
      ? "border-blue-800 bg-blue-800 text-white"
      : "border-slate-500 bg-white text-slate-900 hover:bg-slate-100"
  }`;
}

export function PatientPicker({ store, selectedId, onSelect, onNew, onStoreChange }: Props) {
  const [query, setQuery] = useState("");
  const [filterState, setFilter] = useState<GroupFilter>("all");
  const [manageOpen, setManageOpen] = useState(false);

  // 削除されたグループが選ばれていたら「全員」に戻す
  const filter: GroupFilter =
    filterState === "all" || filterState === "ungrouped" || store.groups.some((g) => g.id === filterState)
      ? filterState
      : "all";
  const group = store.groups.find((g) => g.id === filter) ?? null;
  const searching = query.trim() !== "";
  const manual = group !== null && group.sortMode === "manual";

  const list = useMemo(
    () => searchPatients(patientsInGroup(store, filter), query),
    [store, filter, query],
  );
  const groupName = useMemo(() => new Map(store.groups.map((g) => [g.id, g.name])), [store.groups]);
  const countOf = (f: GroupFilter) => patientsInGroup(store, f).length;

  function setSortMode(mode: GroupSortMode): void {
    if (group) onStoreChange(setGroupSortMode(store, group.id, mode));
  }

  function move(id: PatientId, delta: -1 | 1): void {
    if (group) onStoreChange(movePatientInGroup(store, group.id, id, delta));
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={onNew}>
          ＋ 新しい患者
        </Button>
        <Button onClick={() => setManageOpen((o) => !o)} aria-expanded={manageOpen}>
          グループを管理
        </Button>
      </div>

      {manageOpen ? (
        <GroupManager store={store} onStoreChange={onStoreChange} onClose={() => setManageOpen(false)} />
      ) : null}

      <label className="mt-4 block">
        <span className="mb-1 block font-bold">患者を探す</span>
        <input
          type="search"
          className={inputClass}
          placeholder="氏名・カナ・生年月日で検索"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
        />
      </label>

      <div role="group" aria-label="グループで絞り込む" className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          aria-pressed={filter === "all"}
          className={filterButtonClass(filter === "all")}
          onClick={() => setFilter("all")}
        >
          {filter === "all" ? <span aria-hidden="true">✓</span> : null}
          全員（{countOf("all")}）
        </button>
        <button
          type="button"
          aria-pressed={filter === "ungrouped"}
          className={filterButtonClass(filter === "ungrouped")}
          onClick={() => setFilter("ungrouped")}
        >
          {filter === "ungrouped" ? <span aria-hidden="true">✓</span> : null}
          未分類（{countOf("ungrouped")}）
        </button>
        {store.groups.map((g) => (
          <button
            key={g.id}
            type="button"
            aria-pressed={filter === g.id}
            className={filterButtonClass(filter === g.id)}
            onClick={() => setFilter(g.id)}
          >
            {filter === g.id ? <span aria-hidden="true">✓</span> : null}
            {g.name}（{countOf(g.id)}）
          </button>
        ))}
      </div>

      {group ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="font-bold">「{group.name}」の並び:</span>
          <div role="group" aria-label="並び順" className="flex flex-wrap gap-2">
            <button
              type="button"
              aria-pressed={!manual}
              className={filterButtonClass(!manual)}
              onClick={() => setSortMode("kana")}
            >
              {!manual ? <span aria-hidden="true">✓</span> : null}
              あいうえお順
            </button>
            <button
              type="button"
              aria-pressed={manual}
              className={filterButtonClass(manual)}
              onClick={() => setSortMode("manual")}
            >
              {manual ? <span aria-hidden="true">✓</span> : null}
              手動
            </button>
          </div>
        </div>
      ) : null}
      {manual && searching ? (
        <p className="mt-2 text-slate-800">検索中は並べ替えできません。検索を空にすると ↑↓ が出ます。</p>
      ) : null}
      {group && !manual ? (
        <p className="mt-2 text-slate-800">「手動」にすると、各患者の ↑↓ で順番を変えられます。</p>
      ) : null}

      <p className="mt-3 font-bold" role="status">
        {list.length}人{searching ? "（検索結果）" : ""}
      </p>

      {store.patients.length === 0 ? (
        <p className="mt-2 rounded-lg bg-slate-100 px-3 py-3 text-slate-900">
          まだ患者が登録されていません。「＋ 新しい患者」から氏名などを入れて登録すると、次回からここで選べます。
        </p>
      ) : list.length === 0 ? (
        <p className="mt-2 rounded-lg bg-slate-100 px-3 py-3 text-slate-900">条件に合う患者がいません。</p>
      ) : (
        <ul className="mt-2 max-h-[30rem] space-y-2 overflow-y-auto pr-1" aria-label="患者の一覧">
          {list.map((p, i) => {
            const selected = p.id === selectedId;
            const age = calcAge(p.birthDate);
            const birth = formatBirthDate(p.birthDate);
            const groups = p.groupIds.map((id) => groupName.get(id)).filter((n): n is string => Boolean(n));
            const kana = [p.familyNameKana, p.givenNameKana].filter(Boolean).join(" ");
            return (
              <li key={p.id} className="flex flex-wrap items-stretch gap-2">
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onSelect(p.id)}
                  className={`min-h-14 flex-1 basis-60 cursor-pointer rounded-lg border-2 px-4 py-2 text-left focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-blue-700 ${
                    selected
                      ? "border-blue-800 bg-blue-50 ring-2 ring-blue-800"
                      : "border-slate-500 bg-white hover:bg-slate-100"
                  }`}
                >
                  <span className="flex flex-wrap items-baseline gap-x-3">
                    <span className="text-xl font-bold text-slate-900">
                      {selected ? <span aria-hidden="true">✓ </span> : null}
                      {fullName(p)}
                    </span>
                    {kana ? <span className="text-base text-slate-800">{kana}</span> : null}
                    {selected ? <span className="text-base font-bold text-blue-900">選択中</span> : null}
                  </span>
                  <span className="mt-0.5 block text-base text-slate-800">
                    {birth ? `${birth}${age !== null ? ` ／ ${age}歳` : ""}` : "生年月日なし"}
                    {groups.length > 0 ? ` ／ ${groups.join("・")}` : ""}
                  </span>
                </button>
                {manual && !searching ? (
                  <div className="flex shrink-0 gap-2">
                    <Button
                      className="w-12 px-0"
                      aria-label={`${fullName(p)}を上へ`}
                      disabled={i === 0}
                      onClick={() => move(p.id, -1)}
                    >
                      ↑
                    </Button>
                    <Button
                      className="w-12 px-0"
                      aria-label={`${fullName(p)}を下へ`}
                      disabled={i === list.length - 1}
                      onClick={() => move(p.id, 1)}
                    >
                      ↓
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

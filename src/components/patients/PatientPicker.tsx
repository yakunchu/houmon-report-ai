"use client";

/**
 * 患者を選ぶ（①患者タブの先頭）。docs/UI-V2.md §3-a〜3-d。
 * 画面の流れ: 入口（個人宅／施設）→ 個人宅の一覧 ／ 施設の一覧 → 施設の入居者一覧。
 * 患者を選んでいるときは入口の代わりに「選択中: ○○ さん［患者を選び直す］」の 1 行だけを出す。
 * 患者データはこの端末の中だけ。ここでは何も送信しない。
 */
import { useMemo, useState, type ReactNode } from "react";
import {
  calcAge,
  searchPatients,
  type Facility,
  type FacilityId,
  type Group,
  type GroupSortMode,
  type ListSection,
  type OrderScope,
  type Patient,
  type PatientExtras,
  type PatientId,
  type PatientStore,
} from "@/lib/patients";
import { sortByKana, facilitiesSorted, patientsInScope } from "@/lib/patients/sort";
import {
  createEmptyFacility,
  deleteFacility,
  setManualOrder,
  setScopeSortMode,
  upsertFacility,
} from "@/lib/patients/store";
import { WEEKDAYS, WEEKDAY_LABELS } from "@/lib/patients/types";
import {
  UNGROUPED_KEY,
  facilitySectionsByGroup,
  facilitySectionsByWeekday,
  mergeSubsetOrder,
  sectionsByGroup,
  sectionsByKana,
  sectionsByWeekday,
} from "@/lib/patients/view";
import { SAMPLES, type SampleId } from "@/lib/sample";
import { Button, inputClass } from "../ui";
import { FacilityForm } from "./FacilityForm";
import { GroupManager } from "./GroupManager";
import { ReorderList } from "./ReorderList";
import { TransferPanel } from "./TransferPanel";

type Props = {
  store: PatientStore;
  /** 患者リストに登録済みで、いま作業中の患者（未登録の新しい患者なら null） */
  selectedId: PatientId | null;
  onSelect: (id: PatientId) => void;
  /** 新しい患者。施設の画面からは住まいを施設にして開く */
  onNew: (preset?: Partial<PatientExtras>) => void;
  onStoreChange: (next: PatientStore) => void;
  /** 書き出し・読み込みで読み込んだ結果（作業中の患者が更新されることがあるため、通常の変更と分ける） */
  onImport: (next: PatientStore) => void;
  onLoadSample: (id: SampleId) => void;
  /** 作業中の入力（基本情報・会話・下書き）を消す。患者リストは残す */
  onClearSaved: () => void;
  /** 患者リストも含めて、この端末の保存をすべて消す */
  onClearEverything: () => void;
};

type Screen =
  | { kind: "entrance" }
  | { kind: "home" }
  | { kind: "facilities" }
  /** facilityId が null = 「施設（未設定）」の入居者 */
  | { kind: "residents"; facilityId: FacilityId | null };

type ViewMode = "kana" | "group" | "weekday";

const VIEW_OPTIONS: readonly (readonly [ViewMode, string])[] = [
  ["kana", "五十音"],
  ["group", "グループ"],
  ["weekday", "曜日"],
];

function fullName(p: Patient): string {
  return [p.familyName, p.givenName].filter(Boolean).join(" ") || "（氏名なし）";
}

function daysText(days: readonly number[]): string {
  return WEEKDAYS.filter((d) => days.includes(d))
    .map((d) => WEEKDAY_LABELS[d])
    .join("・");
}

const focusRing = "focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-hanada";

/** 切り替え（五十音／グループ／曜日 など）。選択中は藍の塗り + ✓ */
function Segmented<V extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: V;
  options: readonly (readonly [V, string])[];
  onChange: (next: V) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map(([v, text]) => {
        const on = v === value;
        return (
          <button
            key={v}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(v)}
            className={`inline-flex min-h-12 flex-1 cursor-pointer items-center justify-center gap-1 rounded-xl border-2 px-2 py-2 text-base font-bold whitespace-nowrap ${focusRing} ${
              on ? "border-ai bg-ai text-on-ai" : "border-ink-muted bg-raised text-ink hover:bg-surface"
            }`}
          >
            {on ? <span aria-hidden="true">✓</span> : null}
            {text}
          </button>
        );
      })}
    </div>
  );
}

function SectionHeading({ id, title, children }: { id?: string; title: string; children?: ReactNode }) {
  return (
    <div id={id} className="mt-5 mb-2 flex scroll-mt-24 items-center gap-3 border-b-2 border-line pb-1">
      <h3 className="font-display text-xl font-bold text-ink">{title}</h3>
      <div className="ml-auto">{children}</div>
    </div>
  );
}

function PatientRow({ p, selected, onSelect }: { p: Patient; selected: boolean; onSelect: (id: PatientId) => void }) {
  const age = calcAge(p.birthDate);
  const kana = [p.familyNameKana, p.givenNameKana].filter(Boolean).join(" ");
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(p.id)}
      className={`flex min-h-16 w-full cursor-pointer flex-wrap items-baseline gap-x-3 gap-y-0 rounded-xl border-2 px-4 py-2 text-left ${focusRing} ${
        selected ? "border-ai bg-shiroai ring-2 ring-ai" : "border-ink-muted bg-raised hover:bg-surface"
      }`}
    >
      <span className="text-[22px] leading-snug font-bold text-ink">
        {selected ? <span aria-hidden="true">✓ </span> : null}
        {fullName(p)}
      </span>
      {kana ? <span className="text-base text-ink">{kana}</span> : null}
      {age !== null ? <span className="text-base text-ink">{age}歳</span> : null}
    </button>
  );
}

function PlainList({
  patients,
  selectedId,
  onSelect,
  label,
}: {
  patients: Patient[];
  selectedId: PatientId | null;
  onSelect: (id: PatientId) => void;
  label: string;
}) {
  return (
    <ul className="space-y-2" aria-label={label}>
      {patients.map((p) => (
        <li key={p.id}>
          <PatientRow p={p} selected={p.id === selectedId} onSelect={onSelect} />
        </li>
      ))}
    </ul>
  );
}

function OrderedList({
  patients,
  selectedId,
  onSelect,
  onReorder,
  label,
}: {
  patients: Patient[];
  selectedId: PatientId | null;
  onSelect: (id: PatientId) => void;
  onReorder: (ids: string[]) => void;
  label: string;
}) {
  return (
    <ReorderList
      items={patients}
      ariaLabel={label}
      labelOf={fullName}
      onReorder={onReorder}
      renderItem={(p) => <PatientRow p={p} selected={p.id === selectedId} onSelect={onSelect} />}
    />
  );
}

function SortToggle({ mode, onChange }: { mode: GroupSortMode; onChange: (next: GroupSortMode) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-bold text-ink">並び:</span>
      <Segmented
        label="並び順"
        value={mode}
        options={[
          ["kana", "五十音"],
          ["manual", "手動"],
        ]}
        onChange={onChange}
      />
    </div>
  );
}

function BackBar({ onBack, backText, title }: { onBack: () => void; backText: string; title: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Button onClick={onBack}>← {backText}</Button>
      <h2 className="font-display text-2xl font-bold text-ink">{title}</h2>
    </div>
  );
}

/* ---------- 個人宅の一覧（§3-b） ---------- */

function HomeList({
  store,
  selectedId,
  onSelect,
  onStoreChange,
  onBack,
}: {
  store: PatientStore;
  selectedId: PatientId | null;
  onSelect: (id: PatientId) => void;
  onStoreChange: (next: PatientStore) => void;
  onBack: () => void;
}) {
  const [mode, setMode] = useState<ViewMode>("kana");
  const [query, setQuery] = useState("");

  const homeScope: OrderScope = { kind: "home" };
  const searching = query.trim() !== "";
  const homePatients = useMemo(() => store.patients.filter((p) => p.residence.kind === "home"), [store.patients]);
  const byKana = useMemo(() => sortByKana(homePatients), [homePatients]);
  const hits = useMemo(() => (searching ? searchPatients(byKana, query) : []), [searching, byKana, query]);
  const homeOrdered = useMemo(() => patientsInScope(store, { kind: "home" }), [store]);
  const manualHome = store.homeSortMode === "manual";

  const kanaSections = useMemo(() => sectionsByKana(byKana), [byKana]);
  const groupSections = useMemo(() => sectionsByGroup(store, byKana), [store, byKana]);
  const weekdaySections = useMemo(() => sectionsByWeekday(byKana), [byKana]);

  function jumpTo(key: string): void {
    document.getElementById(`picker-kana-${key}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function reorderGroup(group: Group, ids: string[]): void {
    const full = patientsInScope(store, { kind: "group", groupId: group.id }).map((p) => p.id);
    onStoreChange(setManualOrder(store, { kind: "group", groupId: group.id }, mergeSubsetOrder(full, ids)));
  }

  let body: ReactNode;
  if (homePatients.length === 0) {
    body = (
      <p className="mt-3 rounded-xl bg-shiroai px-3 py-3 text-ink">
        個人宅の患者はまだいません。戻って「＋ 新しい患者」から登録してください。
      </p>
    );
  } else if (searching) {
    body =
      hits.length === 0 ? (
        <p className="mt-3 rounded-xl bg-shiroai px-3 py-3 text-ink">条件に合う患者がいません。</p>
      ) : (
        <div className="mt-3">
          <p className="mb-2 font-bold text-ink" role="status">
            {hits.length}人（検索結果。並べ替えは検索を空にすると使えます）
          </p>
          <PlainList patients={hits} selectedId={selectedId} onSelect={onSelect} label="検索結果" />
        </div>
      );
  } else if (mode === "kana") {
    body = (
      <div className="mt-3">
        <SortToggle
          mode={store.homeSortMode}
          onChange={(m) => onStoreChange(setScopeSortMode(store, homeScope, m))}
        />
        {manualHome ? (
          <div className="mt-3">
            <p className="mb-2 text-ink">右端の ≡ をつかんで上下に動かすと、順番が変わります。</p>
            <OrderedList
              patients={homeOrdered}
              selectedId={selectedId}
              onSelect={onSelect}
              onReorder={(ids) => onStoreChange(setManualOrder(store, homeScope, ids))}
              label="個人宅の患者（手動の並び）"
            />
          </div>
        ) : (
          <>
            <div role="group" aria-label="五十音の索引" className="mt-3 flex flex-wrap gap-1">
              {kanaSections.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => jumpTo(s.key)}
                  aria-label={`${s.title}の行へ`}
                  className={`size-12 cursor-pointer rounded-xl border-2 border-ink-muted bg-raised text-lg font-bold text-ink hover:bg-surface ${focusRing}`}
                >
                  {s.title}
                </button>
              ))}
            </div>
            {kanaSections.map((s) => (
              <div key={s.key}>
                <SectionHeading id={`picker-kana-${s.key}`} title={s.title} />
                <PlainList patients={s.items} selectedId={selectedId} onSelect={onSelect} label={`${s.title}の患者`} />
              </div>
            ))}
          </>
        )}
      </div>
    );
  } else if (mode === "group") {
    body = (
      <div className="mt-3">
        {store.groups.length === 0 ? (
          <p className="mb-2 rounded-xl bg-shiroai px-3 py-3 text-ink">
            グループはまだありません。入口の「その他」の「グループを管理」で作れます。
          </p>
        ) : null}
        {groupSections.map((s) => {
          const group = s.key === UNGROUPED_KEY ? undefined : store.groups.find((g) => g.id === s.key);
          const manual = group?.sortMode === "manual";
          return (
            <div key={s.key}>
              <SectionHeading title={`${s.title}（${s.items.length}人）`}>
                {group ? (
                  <Button
                    className="min-h-12 px-3"
                    onClick={() =>
                      onStoreChange(
                        setScopeSortMode(store, { kind: "group", groupId: group.id }, manual ? "kana" : "manual"),
                      )
                    }
                  >
                    {manual ? "五十音に戻す" : "手動で並べる"}
                  </Button>
                ) : null}
              </SectionHeading>
              {group && manual ? (
                <OrderedList
                  patients={s.items}
                  selectedId={selectedId}
                  onSelect={onSelect}
                  onReorder={(ids) => reorderGroup(group, ids)}
                  label={`${s.title}の患者（手動の並び）`}
                />
              ) : (
                <PlainList patients={s.items} selectedId={selectedId} onSelect={onSelect} label={`${s.title}の患者`} />
              )}
            </div>
          );
        })}
      </div>
    );
  } else {
    body = (
      <div className="mt-3">
        <p className="text-ink">複数の曜日に訪問する人は、それぞれの曜日に出ます。曜日は患者カードの「住まい・曜日を変更」で付けます。</p>
        {weekdaySections.map((s: ListSection) => (
          <div key={s.key}>
            <SectionHeading title={`${s.title}（${s.items.length}人）`} />
            <PlainList patients={s.items} selectedId={selectedId} onSelect={onSelect} label={`${s.title}の患者`} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div>
      <BackBar onBack={onBack} backText="入口へ" title={`個人宅（${homePatients.length}人）`} />
      <div className="mt-3">
        <Segmented label="区分けの切り替え" value={mode} options={VIEW_OPTIONS} onChange={setMode} />
      </div>
      <label className="mt-3 block">
        <span className="sr-only">患者を探す</span>
        <input
          type="search"
          className={inputClass}
          placeholder="🔍 氏名・カナ・生年月日で検索"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
        />
      </label>
      {body}
    </div>
  );
}

/* ---------- 施設の一覧（§3-c） ---------- */

function FacilityRow({ f, count, onOpen }: { f: Facility; count: number; onOpen: () => void }) {
  const days = daysText(f.visitDays);
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`flex min-h-16 w-full cursor-pointer flex-wrap items-baseline gap-x-3 rounded-xl border-2 border-ink-muted bg-raised px-4 py-2 text-left hover:bg-surface ${focusRing}`}
    >
      <span className="text-[22px] leading-snug font-bold text-ink">{f.name || "（名前なし）"}</span>
      <span className="text-base text-ink">入居者 {count} 人</span>
      {days ? (
        <span className="rounded-full border-2 border-ai bg-shiroai px-2 text-base font-bold text-ai">{days}</span>
      ) : null}
    </button>
  );
}

function FacilityListScreen({
  store,
  unassigned,
  onStoreChange,
  onBack,
  onOpen,
}: {
  store: PatientStore;
  unassigned: Patient[];
  onStoreChange: (next: PatientStore) => void;
  onBack: () => void;
  onOpen: (facilityId: FacilityId | null) => void;
}) {
  const [mode, setMode] = useState<ViewMode>("kana");
  const [form, setForm] = useState<Facility | null>(null);

  const facilities = useMemo(() => facilitiesSorted(store), [store]);
  const countOf = (id: FacilityId) =>
    store.patients.filter((p) => p.residence.kind === "facility" && p.residence.facilityId === id).length;

  const sections: ListSection<Facility>[] =
    mode === "group"
      ? facilitySectionsByGroup(store, facilities)
      : mode === "weekday"
        ? facilitySectionsByWeekday(facilities)
        : [];

  return (
    <div>
      <BackBar onBack={onBack} backText="入口へ" title={`施設（${facilities.length} 施設）`} />
      <div className="mt-3">
        <Segmented label="区分けの切り替え" value={mode} options={VIEW_OPTIONS} onChange={setMode} />
      </div>

      {facilities.length === 0 && unassigned.length === 0 ? (
        <p className="mt-3 rounded-xl bg-shiroai px-3 py-3 text-ink">
          施設はまだありません。下の「＋ 新しい施設」から登録してください。
        </p>
      ) : mode === "kana" ? (
        <ul className="mt-3 space-y-2" aria-label="施設の一覧">
          {facilities.map((f) => (
            <li key={f.id}>
              <FacilityRow f={f} count={countOf(f.id)} onOpen={() => onOpen(f.id)} />
            </li>
          ))}
        </ul>
      ) : (
        sections.map((s) => (
          <div key={s.key}>
            <SectionHeading title={`${s.title}（${s.items.length} 施設）`} />
            <ul className="space-y-2" aria-label={`${s.title}の施設`}>
              {s.items.map((f) => (
                <li key={f.id}>
                  <FacilityRow f={f} count={countOf(f.id)} onOpen={() => onOpen(f.id)} />
                </li>
              ))}
            </ul>
          </div>
        ))
      )}

      {unassigned.length > 0 ? (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => onOpen(null)}
            className={`flex min-h-16 w-full cursor-pointer items-center rounded-xl border-2 border-dashed border-akane bg-raised px-4 py-2 text-left text-[22px] font-bold text-ink hover:bg-surface ${focusRing}`}
          >
            施設（未設定）の入居者（{unassigned.length} 人）
          </button>
        </div>
      ) : null}

      {form ? (
        <FacilityForm
          key={form.id}
          initial={form}
          groups={store.groups}
          isNew
          onSave={(next) => {
            onStoreChange(upsertFacility(store, next));
            setForm(null);
          }}
          onCancel={() => setForm(null)}
        />
      ) : (
        <Button variant="secondary" className="mt-4 min-h-14 w-full text-xl" onClick={() => setForm(createEmptyFacility())}>
          ＋ 新しい施設
        </Button>
      )}
    </div>
  );
}

/* ---------- 施設の入居者一覧（§3-d） ---------- */

function ResidentsScreen({
  store,
  facility,
  unassigned,
  selectedId,
  onSelect,
  onNew,
  onStoreChange,
  onBack,
}: {
  store: PatientStore;
  /** null = 施設（未設定） */
  facility: Facility | null;
  unassigned: Patient[];
  selectedId: PatientId | null;
  onSelect: (id: PatientId) => void;
  onNew: (preset?: Partial<PatientExtras>) => void;
  onStoreChange: (next: PatientStore) => void;
  onBack: () => void;
}) {
  const [editing, setEditing] = useState(false);

  const scope: OrderScope | null = facility ? { kind: "facility", facilityId: facility.id } : null;
  const residents = useMemo(
    () => (facility ? patientsInScope(store, { kind: "facility", facilityId: facility.id }) : sortByKana(unassigned)),
    [store, facility, unassigned],
  );
  const manual = facility?.sortMode === "manual";

  function handleDelete(): void {
    if (!facility) return;
    const ok = window.confirm(
      `施設「${facility.name}」を削除します。入居者の患者は消えず、「施設（未設定）」の入居者になります。よろしいですか？`,
    );
    if (!ok) return;
    onStoreChange(deleteFacility(store, facility.id));
    onBack();
  }

  return (
    <div>
      <BackBar
        onBack={onBack}
        backText="施設一覧へ"
        title={`${facility ? facility.name || "（名前なし）" : "施設（未設定）"}（${residents.length}人）`}
      />

      {facility && scope ? (
        <div className="mt-3">
          <SortToggle
            mode={facility.sortMode}
            onChange={(m) => onStoreChange(setScopeSortMode(store, scope, m))}
          />
          {daysText(facility.visitDays) ? (
            <p className="mt-2 text-ink">訪問曜日: {daysText(facility.visitDays)}</p>
          ) : null}
        </div>
      ) : (
        <p className="mt-3 rounded-xl bg-shiroai px-3 py-3 text-ink">
          住まいが「施設」で、施設がまだ決まっていない（または施設が削除された）患者です。患者を選んで「住まい・曜日を変更」で施設を選べます。
        </p>
      )}

      <div className="mt-3">
        {residents.length === 0 ? (
          <p className="rounded-xl bg-shiroai px-3 py-3 text-ink">入居者はまだいません。</p>
        ) : facility && scope && manual ? (
          <>
            <p className="mb-2 text-ink">右端の ≡ をつかんで上下に動かすと、順番が変わります。</p>
            <OrderedList
              patients={residents}
              selectedId={selectedId}
              onSelect={onSelect}
              onReorder={(ids) => onStoreChange(setManualOrder(store, scope, ids))}
              label="入居者（手動の並び）"
            />
          </>
        ) : (
          <PlainList patients={residents} selectedId={selectedId} onSelect={onSelect} label="入居者の一覧" />
        )}
      </div>

      {facility ? (
        <div className="mt-4 space-y-3">
          <Button
            variant="secondary"
            className="min-h-14 w-full text-xl"
            onClick={() => onNew({ residence: { kind: "facility", facilityId: facility.id } })}
          >
            ＋ この施設に新しい患者
          </Button>
          {editing ? (
            <FacilityForm
              key={facility.id}
              initial={facility}
              groups={store.groups}
              isNew={false}
              onSave={(next) => {
                onStoreChange(upsertFacility(store, next));
                setEditing(false);
              }}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <div className="flex flex-wrap gap-3">
              <Button onClick={() => setEditing(true)}>この施設を編集</Button>
              <Button variant="danger" onClick={handleDelete}>
                この施設を削除
              </Button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

/* ---------- 入口（§3-a） ---------- */

function Entrance({
  store,
  homeCount,
  residentCount,
  onGo,
  onNew,
  onStoreChange,
  onImport,
  selectedId,
  onLoadSample,
  onClearSaved,
  onClearEverything,
}: {
  store: PatientStore;
  homeCount: number;
  residentCount: number;
  onGo: (screen: Screen) => void;
  onNew: () => void;
  onStoreChange: (next: PatientStore) => void;
  onImport: (next: PatientStore) => void;
  selectedId: PatientId | null;
  onLoadSample: (id: SampleId) => void;
  onClearSaved: () => void;
  onClearEverything: () => void;
}) {
  const [other, setOther] = useState<"transfer" | "groups" | null>(null);
  const bigClass = `flex min-h-24 flex-col items-center justify-center gap-1 rounded-xl border-2 border-ai bg-ai px-3 py-4 text-on-ai hover:bg-ai-hover cursor-pointer ${focusRing}`;

  return (
    <div>
      <h2 className="font-display text-2xl font-bold text-ink">誰の訪問ですか？</h2>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <button type="button" className={bigClass} onClick={() => onGo({ kind: "home" })}>
          <span className="text-2xl font-bold">個人宅</span>
          <span className="text-base">{homeCount} 人</span>
        </button>
        <button type="button" className={bigClass} onClick={() => onGo({ kind: "facilities" })}>
          <span className="text-2xl font-bold">施設</span>
          <span className="text-base">
            {store.facilities.length} 施設／{residentCount} 人
          </span>
        </button>
      </div>
      <Button variant="secondary" className="mt-3 min-h-14 w-full text-xl" onClick={onNew}>
        ＋ 新しい患者
      </Button>

      <details className="mt-4 rounded-xl border-2 border-line bg-raised">
        <summary className={`min-h-12 cursor-pointer list-none px-4 py-3 text-lg font-bold text-ink ${focusRing}`}>
          <span aria-hidden="true">▸ </span>その他（読み込み・書き出し・グループ・架空サンプル）
        </summary>
        <div className="space-y-4 px-4 pb-4">
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => setOther((o) => (o === "transfer" ? null : "transfer"))} aria-expanded={other === "transfer"}>
              書き出し・読み込み
            </Button>
            <Button onClick={() => setOther((o) => (o === "groups" ? null : "groups"))} aria-expanded={other === "groups"}>
              グループを管理
            </Button>
          </div>
          {other === "transfer" ? (
            <TransferPanel store={store} selectedId={selectedId} onImport={onImport} onClose={() => setOther(null)} />
          ) : null}
          {other === "groups" ? (
            <GroupManager store={store} onStoreChange={onStoreChange} onClose={() => setOther(null)} />
          ) : null}

          <div>
            <p className="mb-1 font-bold text-ink">架空サンプル（デモ・動作確認用）</p>
            <div className="flex flex-wrap gap-3">
              {SAMPLES.map((s) => (
                <Button key={s.id} onClick={() => onLoadSample(s.id)} title={s.description}>
                  {s.label}を読み込む
                </Button>
              ))}
            </div>
            <p className="mt-2 text-base text-ink">
              サンプル①は登録済みの患者の流れ（ケアマネ宛）、②は新しい患者の流れ（医師宛。会話から基本情報が自動入力されます）。
            </p>
          </div>

          <div>
            <p className="mb-1 font-bold text-ink">保存データの消去</p>
            <div className="flex flex-wrap gap-3">
              <Button variant="danger" onClick={onClearSaved}>
                作業中の入力（基本情報・会話・下書き）を消す
              </Button>
              <Button variant="danger" onClick={onClearEverything}>
                患者リストも含めて、この端末の保存をすべて消す
              </Button>
            </div>
          </div>
        </div>
      </details>
    </div>
  );
}

/* ---------- 本体 ---------- */

export function PatientPicker({
  store,
  selectedId,
  onSelect,
  onNew,
  onStoreChange,
  onImport,
  onLoadSample,
  onClearSaved,
  onClearEverything,
}: Props) {
  const [screen, setScreen] = useState<Screen>({ kind: "entrance" });
  /** 「患者を選び直す」を押したときの selectedId。いまの selectedId と同じ間だけ一覧を開く */
  const [repickFor, setRepickFor] = useState<PatientId | null>(null);

  const selected = selectedId !== null ? store.patients.find((p) => p.id === selectedId) : undefined;
  const collapsed = selected !== undefined && repickFor !== selected.id;

  const homeCount = store.patients.filter((p) => p.residence.kind === "home").length;
  const facilityIds = useMemo(() => new Set(store.facilities.map((f) => f.id)), [store.facilities]);
  const facilityResidents = useMemo(
    () => store.patients.filter((p) => p.residence.kind === "facility"),
    [store.patients],
  );
  const unassigned = useMemo(
    () =>
      facilityResidents.filter((p) => p.residence.facilityId === null || !facilityIds.has(p.residence.facilityId)),
    [facilityResidents, facilityIds],
  );

  function handleSelect(id: PatientId): void {
    setRepickFor(null);
    onSelect(id);
  }

  if (collapsed && selected) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xl font-bold text-ink">選択中: {fullName(selected)} さん</p>
        <Button
          onClick={() => {
            setScreen({ kind: "entrance" });
            setRepickFor(selected.id);
          }}
        >
          患者を選び直す
        </Button>
      </div>
    );
  }

  // 削除された施設の画面に居続けないよう、見つからなければ施設の一覧に戻す
  let current: Screen = screen;
  let facility: Facility | null = null;
  if (screen.kind === "residents" && screen.facilityId !== null) {
    facility = store.facilities.find((f) => f.id === screen.facilityId) ?? null;
    if (!facility) current = { kind: "facilities" };
  }

  return (
    <div>
      {selected ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-lg text-ink">いま選んでいる患者: {fullName(selected)} さん</p>
          <Button onClick={() => setRepickFor(null)}>やめて戻る</Button>
        </div>
      ) : null}

      {current.kind === "entrance" ? (
        <Entrance
          store={store}
          homeCount={homeCount}
          residentCount={facilityResidents.length}
          onGo={setScreen}
          onNew={() => onNew()}
          onStoreChange={onStoreChange}
          onImport={onImport}
          selectedId={selectedId}
          onLoadSample={onLoadSample}
          onClearSaved={onClearSaved}
          onClearEverything={onClearEverything}
        />
      ) : current.kind === "home" ? (
        <HomeList
          store={store}
          selectedId={selectedId}
          onSelect={handleSelect}
          onStoreChange={onStoreChange}
          onBack={() => setScreen({ kind: "entrance" })}
        />
      ) : current.kind === "facilities" ? (
        <FacilityListScreen
          store={store}
          unassigned={unassigned}
          onStoreChange={onStoreChange}
          onBack={() => setScreen({ kind: "entrance" })}
          onOpen={(facilityId) => setScreen({ kind: "residents", facilityId })}
        />
      ) : (
        <ResidentsScreen
          key={current.facilityId ?? "unassigned"}
          store={store}
          facility={facility}
          unassigned={unassigned}
          selectedId={selectedId}
          onSelect={handleSelect}
          onNew={onNew}
          onStoreChange={onStoreChange}
          onBack={() => setScreen({ kind: "facilities" })}
        />
      )}
    </div>
  );
}

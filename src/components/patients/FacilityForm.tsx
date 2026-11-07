"use client";

/** 施設の追加・編集フォーム（名前・カナ・訪問曜日・グループ）。保存は呼び出し側（upsertFacility） */
import { useState } from "react";
import { WEEKDAYS, WEEKDAY_LABELS, type Facility, type Group, type Weekday } from "@/lib/patients/types";
import { Button, Field, inputClass } from "../ui";

const toggleClass = (selected: boolean) =>
  `inline-flex min-h-12 min-w-12 cursor-pointer select-none items-center justify-center gap-1 rounded-xl border-2 px-3 py-2 text-lg font-bold focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-hanada ${
    selected ? "border-ai bg-ai text-on-ai" : "border-ink-muted bg-raised text-ink hover:bg-surface"
  }`;

export function FacilityForm({
  initial,
  groups,
  isNew,
  onSave,
  onCancel,
}: {
  initial: Facility;
  groups: Group[];
  isNew: boolean;
  onSave: (next: Facility) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [nameKana, setNameKana] = useState(initial.nameKana);
  const [visitDays, setVisitDays] = useState<Weekday[]>(initial.visitDays);
  const [groupIds, setGroupIds] = useState<string[]>(initial.groupIds);

  const canSave = name.trim() !== "";

  function toggleDay(day: Weekday): void {
    setVisitDays((cur) => WEEKDAYS.filter((d) => (d === day ? !cur.includes(d) : cur.includes(d))));
  }

  function toggleGroup(id: string): void {
    setGroupIds((cur) => (cur.includes(id) ? cur.filter((g) => g !== id) : [...cur, id]));
  }

  return (
    <form
      className="mt-3 space-y-4 rounded-xl border-2 border-ai bg-raised p-3 sm:p-4"
      aria-label={isNew ? "新しい施設" : "施設を編集"}
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSave) return;
        onSave({ ...initial, name: name.trim(), nameKana: nameKana.trim(), visitDays, groupIds });
      }}
    >
      <h3 className="font-display text-xl font-bold text-ink">{isNew ? "新しい施設" : "施設を編集"}</h3>
      <Field label="施設名（必須。端末内のみ・AI には送りません）">
        <input
          className={inputClass}
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="off"
          required
        />
      </Field>
      <Field label="カナ（並び順に使います。空でも可）">
        <input
          className={inputClass}
          value={nameKana}
          onChange={(e) => setNameKana(e.target.value)}
          autoComplete="off"
        />
      </Field>
      <div>
        <p className="mb-1 font-bold text-ink">訪問曜日（複数選べます）</p>
        <div role="group" aria-label="訪問曜日" className="flex flex-wrap gap-2">
          {WEEKDAYS.map((d) => {
            const on = visitDays.includes(d);
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                aria-label={`${WEEKDAY_LABELS[d]}曜日`}
                className={toggleClass(on)}
                onClick={() => toggleDay(d)}
              >
                {on ? <span aria-hidden="true">✓</span> : null}
                {WEEKDAY_LABELS[d]}
              </button>
            );
          })}
        </div>
      </div>
      <fieldset className="min-w-0">
        <legend className="mb-1 font-bold text-ink">グループ</legend>
        {groups.length === 0 ? (
          <p className="text-ink">グループがありません。「その他」の「グループを管理」で作れます。</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {groups.map((g) => {
              const on = groupIds.includes(g.id);
              return (
                <label
                  key={g.id}
                  className={`${toggleClass(on)} has-[:focus-visible]:outline-4 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-hanada`}
                >
                  <input type="checkbox" className="sr-only" checked={on} onChange={() => toggleGroup(g.id)} />
                  {on ? <span aria-hidden="true">✓</span> : null}
                  {g.name}
                </label>
              );
            })}
          </div>
        )}
      </fieldset>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" variant="primary" className="min-h-14" disabled={!canSave}>
          保存
        </Button>
        <Button className="min-h-14" onClick={onCancel}>
          やめる
        </Button>
      </div>
    </form>
  );
}

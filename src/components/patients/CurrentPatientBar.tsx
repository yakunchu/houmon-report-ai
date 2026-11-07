"use client";

/**
 * いま作業中の患者の「常時画面」（患者カード）。docs/UI-V2.md §3-e。
 * - 名前・カナ・年齢、住まいと訪問曜日、赤い「申し送り・注意事項」ボタン（タップでダイアログ）
 * - 住まい・曜日の変更（変更のたびに onSaveExtras で即保存）
 * - 保存の状態、「患者リストに保存」「この患者を編集」「リストから削除」（基本情報フォームの開閉は BasicInfoSection 側のボタン）
 * 申し送りは実名を含みうるので端末内のみ。ここでは何も送信しない。
 */
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { WEEKDAYS, WEEKDAY_LABELS, type Facility, type PatientExtras, type Weekday } from "@/lib/patients/types";
import { Button, inputClass } from "../ui";

type Props = {
  /** 氏名（未入力なら空文字） */
  name: string;
  /** 患者リストに登録済み */
  saved: boolean;
  /** 患者リストの記録と違う（未登録を含む） */
  dirty: boolean;
  /** 氏名が入っていて保存できる */
  canSave: boolean;
  /** 保存した直後などのお知らせ */
  notice: string | null;
  onEdit: () => void;
  onSave: () => void;
  onDelete: () => void;
  /** 表示用のカナ（空可） */
  kana: string;
  /** 表示用の年齢 */
  age: number | null;
  /** 作業中の患者の住まい・曜日・申し送り */
  extras: PatientExtras;
  /** 住まいの選択肢（store.facilities） */
  facilities: Facility[];
  /** 住まい・曜日・申し送りを変えたとき（即保存） */
  onSaveExtras: (next: PatientExtras) => void;
};

const toggleClass = (selected: boolean) =>
  `inline-flex min-h-12 min-w-12 cursor-pointer items-center justify-center gap-1 rounded-xl border-2 px-3 py-2 text-lg font-bold focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-hanada ${
    selected ? "border-ai bg-ai text-on-ai" : "border-ink-muted bg-raised text-ink hover:bg-surface"
  }`;

/** 申し送り・注意事項のダイアログ。開いている間だけ描画する（編集中の文字はここだけに持つ） */
function HandoverDialog({
  note,
  onSave,
  onClose,
}: {
  note: string;
  onSave: (next: string) => void;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note);
  const onCloseRef = useRef(onClose);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const live = useRef({ editing, draft, note });
  const cancelEditRef = useRef<() => boolean>(() => false);

  useEffect(() => {
    onCloseRef.current = onClose;
    live.current = { editing, draft, note };
    cancelEditRef.current = cancelEdit;
  });

  /** 編集をやめる。書き換えがあるときは確認する。やめたら true */
  function cancelEdit(): boolean {
    const s = live.current;
    if (s.draft !== s.note && !window.confirm("書いた内容は保存されません。やめますか？")) return false;
    setDraft(s.note);
    setEditing(false);
    return true;
  }

  // Esc: 編集中は「やめる」と同じ、そうでなければ閉じる。開いたら「閉じる」にフォーカスし、背景のスクロールを止める
  useEffect(() => {
    document.getElementById("handover-close")?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        if (live.current.editing) cancelEditRef.current();
        else onCloseRef.current();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  // Tab / Shift+Tab をダイアログの中でぐるぐる回す
  function trapTab(e: ReactKeyboardEvent<HTMLDivElement>): void {
    if (e.key !== "Tab" || !dialogRef.current) return;
    const items = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), textarea, [href], input, select, [tabindex]:not([tabindex='-1'])"),
    );
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const cur = document.activeElement;
    if (e.shiftKey && (cur === first || !dialogRef.current.contains(cur))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (cur === last || !dialogRef.current.contains(cur))) {
      e.preventDefault();
      first.focus();
    }
  }
  function startEdit(): void {
    setDraft(note);
    setEditing(true);
    // textarea が描画されてからフォーカスする
    setTimeout(() => areaRef.current?.focus(), 0);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4"
      onClick={(e) => {
        // 編集中は背景のタップで閉じない（書きかけを守る）
        if (e.target === e.currentTarget && !editing) onClose();
      }}
    >
      <div
        ref={dialogRef}
        onKeyDown={trapTab}
        role="dialog"
        aria-modal="true"
        aria-labelledby="handover-title"
        className="flex max-h-[90vh] w-full max-w-xl flex-col rounded-xl border-2 border-akane bg-raised p-4 shadow-xl sm:p-6"
      >
        <h2 id="handover-title" className="font-display text-2xl font-bold text-akane">
          申し送り・注意事項
        </h2>
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
          {editing ? (
            <label className="block">
              <span className="sr-only">申し送り・注意事項を入力</span>
              <textarea
                ref={areaRef}
                className={`${inputClass} min-h-48 text-xl`}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="例: 玄関の呼び鈴が鳴らないことがある。裏口から声をかける。"
              />
              <span className="mt-1 block text-base text-ink-muted">
                この内容は端末の中にだけ保存されます。AI には送りません。
              </span>
            </label>
          ) : note.trim() !== "" ? (
            <p className="text-xl leading-relaxed whitespace-pre-wrap text-ink">{note}</p>
          ) : (
            <p className="text-xl leading-relaxed text-ink">登録されていません。「編集」で書けます。</p>
          )}
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          {editing ? (
            <>
              <Button
                variant="primary"
                className="min-h-14 flex-1 text-xl"
                onClick={() => {
                  onSave(draft);
                  setEditing(false);
                }}
              >
                保存
              </Button>
              <Button
                className="min-h-14 flex-1 text-xl"
                onClick={() => cancelEdit()}

              >
                やめる
              </Button>
            </>
          ) : (
            <>
              <Button className="min-h-14 flex-1 text-xl" onClick={startEdit}>
                編集
              </Button>
              <Button id="handover-close" variant="primary" className="min-h-14 flex-1 text-xl" onClick={onClose}>
                閉じる
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function CurrentPatientBar({
  name,
  saved,
  dirty,
  canSave,
  notice,
  onEdit,
  onSave,
  onDelete,
  kana,
  age,
  extras,
  facilities,
  onSaveExtras,
}: Props) {
  const [handoverOpen, setHandoverOpen] = useState(false);
  const [changeOpen, setChangeOpen] = useState(false);
  const handoverBtn = useRef<HTMLButtonElement>(null);

  const needsSave = !saved || dirty;
  const status = !saved
    ? "患者リストにまだ登録されていません"
    : dirty
      ? "患者リストの記録から変更があります（未保存）"
      : "✓ 患者リストに保存済み";

  const hasNote = extras.handoverNote.trim() !== "";
  const isFacility = extras.residence.kind === "facility";
  const facility = isFacility ? facilities.find((f) => f.id === extras.residence.facilityId) : undefined;
  const residenceText = !isFacility ? "個人宅" : facility ? facility.name : "施設（未設定）";
  const daysText =
    WEEKDAYS.filter((d) => extras.visitDays.includes(d))
      .map((d) => WEEKDAY_LABELS[d])
      .join("・") || "曜日は未設定";

  function toggleDay(day: Weekday): void {
    const has = extras.visitDays.includes(day);
    const next = WEEKDAYS.filter((d) => (d === day ? !has : extras.visitDays.includes(d)));
    onSaveExtras({ ...extras, visitDays: next });
  }

  function closeHandover(): void {
    setHandoverOpen(false);
    handoverBtn.current?.focus();
  }

  return (
    <div
      className={`mt-4 rounded-xl border-2 p-3 sm:p-4 ${
        needsSave && canSave ? "border-akane bg-raised" : "border-line bg-surface"
      }`}
      aria-label="いま作業中の患者"
    >
      <p className="text-ink">いま作業中の患者</p>
      <p className="flex flex-wrap items-baseline gap-x-3 text-2xl font-bold text-ink">
        <span>{name ? `${name} さん` : "（氏名が未入力です）"}</span>
        {kana || age !== null ? (
          <span className="text-lg font-normal">
            {kana}
            {kana && age !== null ? "　" : ""}
            {age !== null ? `${age}歳` : ""}
          </span>
        ) : null}
      </p>

      <button
        ref={handoverBtn}
        type="button"
        onClick={() => setHandoverOpen(true)}
        aria-haspopup="dialog"
        className="mt-3 flex min-h-14 w-full cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border-2 border-akane bg-akane px-4 py-2 text-left text-lg font-bold text-on-akane hover:opacity-90 focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-hanada"
      >
        <span className="whitespace-nowrap">
          <span aria-hidden="true">⚠ </span>申し送り・注意事項
        </span>
        <span className="ml-auto shrink-0 whitespace-nowrap rounded-full bg-raised px-3 py-0.5 text-base text-akane">{hasNote ? "あり" : "なし"}</span>
      </button>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-lg font-bold text-ink">
          <span aria-hidden="true">{isFacility ? "🏢 " : "🏠 "}</span>
          {residenceText} ／ {daysText}
        </p>
        <Button onClick={() => setChangeOpen((o) => !o)} aria-expanded={changeOpen} aria-controls="residence-editor">
          {changeOpen ? "▲ 住まい・曜日を閉じる" : "▼ 住まい・曜日を変更"}
        </Button>
      </div>

      {changeOpen ? (
        <div id="residence-editor" className="mt-2 space-y-4 rounded-xl border-2 border-line bg-raised p-3">
          <div>
            <p className="mb-1 font-bold text-ink">住まい</p>
            <div role="group" aria-label="住まい" className="flex flex-wrap gap-2">
              <button
                type="button"
                aria-pressed={!isFacility}
                className={toggleClass(!isFacility)}
                onClick={() => onSaveExtras({ ...extras, residence: { kind: "home", facilityId: null } })}
              >
                {!isFacility ? <span aria-hidden="true">✓</span> : null}
                個人宅
              </button>
              <button
                type="button"
                aria-pressed={isFacility}
                className={toggleClass(isFacility)}
                onClick={() =>
                  onSaveExtras({
                    ...extras,
                    residence: { kind: "facility", facilityId: facilities.length === 1 ? facilities[0].id : null },
                  })
                }
              >
                {isFacility ? <span aria-hidden="true">✓</span> : null}
                施設
              </button>
            </div>
            {isFacility ? (
              facilities.length === 0 ? (
                <p className="mt-2 text-ink">
                  施設がまだありません。「患者を選び直す」→「施設」→「＋ 新しい施設」で作れます。
                </p>
              ) : (
                <label className="mt-2 block">
                  <span className="mb-1 block font-bold text-ink">施設を選ぶ</span>
                  <select
                    className={inputClass}
                    value={extras.residence.facilityId ?? ""}
                    onChange={(e) =>
                      onSaveExtras({
                        ...extras,
                        residence: { kind: "facility", facilityId: e.target.value === "" ? null : e.target.value },
                      })
                    }
                  >
                    <option value="">（未設定）</option>
                    {facilities.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name || "（名前なし）"}
                      </option>
                    ))}
                  </select>
                </label>
              )
            ) : null}
          </div>
          <div>
            <p className="mb-1 font-bold text-ink">訪問曜日（複数選べます）</p>
            <div role="group" aria-label="訪問曜日" className="flex flex-wrap gap-2">
              {WEEKDAYS.map((d) => {
                const on = extras.visitDays.includes(d);
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
          <p className="text-base text-ink-muted">変えるとすぐ保存されます（患者リストに登録済みのとき）。</p>
        </div>
      ) : null}

      <p className={`mt-3 font-bold ${needsSave ? "text-akane" : "text-ink"}`}>
        {needsSave ? <span aria-hidden="true">⚠ </span> : null}
        {status}
      </p>
      {!saved ? (
        <p className="mt-1 text-ink">
          登録すると、次回からリストから選ぶだけで基本情報が入ります。氏名を入れて「患者リストに保存」を押してください。
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-3">
        <Button variant={needsSave ? "primary" : "secondary"} onClick={onSave} disabled={!canSave}>
          患者リストに保存
        </Button>
        <Button onClick={onEdit}>この患者を編集</Button>
        {saved ? (
          <Button variant="danger" onClick={onDelete}>
            リストから削除
          </Button>
        ) : null}
      </div>
      {notice ? (
        <p role="status" className="mt-2 font-bold text-ink">
          {notice}
        </p>
      ) : null}

      {handoverOpen ? (
        <HandoverDialog
          note={extras.handoverNote}
          onSave={(next) => onSaveExtras({ ...extras, handoverNote: next })}
          onClose={closeHandover}
        />
      ) : null}
    </div>
  );
}

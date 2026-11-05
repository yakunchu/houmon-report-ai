"use client";

/** いま作業中の患者と、保存の状態。編集・保存・リストから削除のボタンをまとめる */
import { Button } from "../ui";

export function CurrentPatientBar({
  name,
  saved,
  dirty,
  canSave,
  notice,
  onEdit,
  onSave,
  onDelete,
}: {
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
}) {
  const needsSave = !saved || dirty;
  const status = !saved
    ? "患者リストにまだ登録されていません"
    : dirty
      ? "患者リストの記録から変更があります（未保存）"
      : "✓ 患者リストに保存済み";

  return (
    <div
      className={`mt-4 rounded-xl border-2 p-3 sm:p-4 ${
        needsSave && canSave ? "border-akane bg-raised" : "border-line bg-surface"
      }`}
      aria-label="いま作業中の患者"
    >
      <p className="text-ink">いま作業中の患者</p>
      <p className="text-2xl font-bold text-ink">{name ? `${name} さん` : "（氏名が未入力です）"}</p>
      <p className={`mt-1 font-bold ${needsSave ? "text-akane" : "text-ink"}`}>
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
    </div>
  );
}

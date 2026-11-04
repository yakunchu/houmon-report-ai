"use client";

/**
 * 「会話から読み取った基本情報」パネル（③下書きの上）。
 * - 患者の空欄は下書きができた時点で自動入力済み（「AI の提案（会話から）」バッジ）。ここでは確認用に一覧する。
 * - 記録に値があって会話と違う項目は「記録: ○○ → 会話: △△ [反映]」。[反映] を押したときだけ上書きする。
 * - AI は提案まで。患者の記録として保存するかどうかは薬剤師が決める。
 */
import {
  SUGGESTION_LABELS,
  isSameAsCurrent,
  type AiField,
  type SuggestionItem,
  type SuggestionKey,
} from "@/lib/ui/suggestions";
import type { BasicInfo } from "@/lib/ui/types";
import { AiBadge, Button } from "../ui";

export function SuggestionPanel({
  basic,
  items,
  aiFields,
  saved,
  dirty,
  canSave,
  onApply,
  onSave,
}: {
  basic: BasicInfo;
  items: SuggestionItem[];
  aiFields: readonly AiField[];
  saved: boolean;
  dirty: boolean;
  canSave: boolean;
  onApply: (item: SuggestionItem) => void;
  onSave: () => void;
}) {
  const found = new Set<SuggestionKey>(items.map((i) => i.key));
  const missing = (Object.keys(SUGGESTION_LABELS) as SuggestionKey[])
    .filter((k) => !found.has(k))
    .map((k) => SUGGESTION_LABELS[k]);
  const needsSave = !saved || dirty;

  return (
    <section
      aria-label="会話から読み取った基本情報"
      className="rounded-2xl border-2 border-blue-800 bg-blue-50 p-4 sm:p-6"
    >
      <h2 className="text-2xl font-bold text-slate-900">会話から読み取った基本情報</h2>
      <p className="mt-1 text-slate-900">
        会話から判断できた項目の提案です。空欄は自動で入れました。内容を確認して、よければ患者リストに保存してください。
      </p>

      {items.length === 0 ? (
        <p className="mt-3 rounded-lg bg-white px-3 py-3 text-slate-900">
          この会話からは、基本情報の項目を読み取れませんでした。
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {items.map((item) => {
            const same = isSameAsCurrent(basic, item);
            const autoFilled = same && item.fields.some((f) => aiFields.includes(f));
            return (
              <li key={item.key} className="rounded-xl border-2 border-slate-300 bg-white p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-xl font-bold">{item.label}</h3>
                  {autoFilled ? <AiBadge /> : null}
                </div>
                {item.blocked ? (
                  <div className="mt-1 text-lg">
                    <p>
                      会話: <span className="font-bold">{item.suggested}</span>
                    </p>
                    <p className="mt-1 font-bold text-amber-950">
                      <span aria-hidden="true">⚠ </span>
                      {item.blocked}
                    </p>
                  </div>
                ) : same ? (
                  <p className="mt-1 text-lg">
                    {autoFilled ? "自動入力: " : "記録と会話が一致: "}
                    <span className="font-bold">{item.suggested}</span>
                  </p>
                ) : (
                  <div className="mt-1 flex flex-wrap items-center gap-3">
                    <p className="min-w-0 flex-1 basis-60 text-lg">
                      記録: <span className="font-bold">{item.current || "（空欄）"}</span>
                      <span aria-hidden="true"> → </span>
                      <span className="sr-only">、</span>
                      会話: <span className="font-bold">{item.suggested}</span>
                    </p>
                    <Button onClick={() => onApply(item)} aria-label={`${item.label}を会話の内容に反映する`}>
                      反映
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {missing.length > 0 && items.length > 0 ? (
        <p className="mt-3 text-slate-900">会話からは読み取れなかった項目: {missing.join("、")}（入力済みの値はそのままです）</p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button variant={needsSave ? "primary" : "secondary"} onClick={onSave} disabled={!canSave}>
          患者リストに保存
        </Button>
        <span className={`font-bold ${needsSave ? "text-amber-950" : "text-slate-900"}`}>
          {!saved
            ? "⚠ この患者はまだ登録されていません"
            : dirty
              ? "⚠ 未保存の変更があります"
              : "✓ 保存済み"}
        </span>
      </div>
    </section>
  );
}

"use client";

/**
 * ドラッグで並べ替えられる一覧（汎用）。docs/UI-V2.md §3-f。
 * - 行の右端の ≡ ハンドル（48×48px、touch-action: none）を押さえて上下に動かす。Pointer Events なのでマウスでもタッチでも動く。
 *   長押しは使わない（iPhone の文字選択と取り合いになるため）。ライブラリは使わない。
 * - 動かしている行は少し持ち上がった見た目、入れ替え先に 4px の藍の線を出す。指を離すと onReorder(並べ替え後の id の並び)。
 * - キーボード・補助用に、ハンドルの左に↑ ↓（48px 角） を残す（ハンドルにフォーカスして ↑ ↓ キーでも動く）。
 * 保存は呼び出し側（onReorder の中）で行う。この部品は何も保存しない。
 */
import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { moveItem } from "@/lib/patients/view";

type Props<T extends { id: string }> = {
  items: readonly T[];
  /** 行の中身（名前など）。タップで選ぶボタンなどを返す。ハンドルと ↑↓ はこの部品が付ける */
  renderItem: (item: T, index: number) => ReactNode;
  /** 読み上げ用の名前（「○○を上へ」などに使う） */
  labelOf: (item: T) => string;
  /** 並べ替えが確定したとき。並べ替え後の id の並び */
  onReorder: (orderedIds: string[]) => void;
  /** 一覧全体の名前（読み上げ用） */
  ariaLabel: string;
  className?: string;
};

type Drag = { id: string; from: number; over: number; dy: number };

type DragInfo = {
  pointerId: number;
  /** 押したときのページ上の Y（スクロール込み） */
  startY: number;
  /** 各行の中心のページ上の Y（押したとき） */
  centers: number[];
  from: number;
  ids: string[];
  /** 最後に計算した入れ替え先（指を離したときに state を待たず使う） */
  over: number;
};

const EDGE = 72;

export function ReorderList<T extends { id: string }>({
  items,
  renderItem,
  labelOf,
  onReorder,
  ariaLabel,
  className = "",
}: Props<T>) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const liRefs = useRef(new Map<string, HTMLLIElement>());
  const info = useRef<DragInfo | null>(null);

  function nearestIndex(centers: number[], y: number): number {
    let best = 0;
    let bestDist = Infinity;
    centers.forEach((c, i) => {
      const d = Math.abs(c - y);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    return best;
  }

  function onPointerDown(e: PointerEvent<HTMLButtonElement>, index: number): void {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const ids = items.map((it) => it.id);
    const centers = ids.map((id) => {
      const el = liRefs.current.get(id);
      if (!el) return 0;
      const r = el.getBoundingClientRect();
      return r.top + window.scrollY + r.height / 2;
    });
    e.currentTarget.setPointerCapture(e.pointerId);
    info.current = {
      pointerId: e.pointerId,
      startY: e.clientY + window.scrollY,
      centers,
      from: index,
      ids,
      over: index,
    };
    setDrag({ id: ids[index], from: index, over: index, dy: 0 });
  }

  function onPointerMove(e: PointerEvent<HTMLButtonElement>): void {
    const d = info.current;
    if (!d || d.pointerId !== e.pointerId) return;
    // 画面の端に近いときはページを少し送る
    if (e.clientY < EDGE) window.scrollBy(0, -12);
    else if (e.clientY > window.innerHeight - EDGE) window.scrollBy(0, 12);
    const pageY = e.clientY + window.scrollY;
    const dy = pageY - d.startY;
    const over = nearestIndex(d.centers, d.centers[d.from] + dy);
    d.over = over;
    setDrag({ id: d.ids[d.from], from: d.from, over, dy });
  }

  function finish(e: PointerEvent<HTMLButtonElement>, commit: boolean): void {
    const d = info.current;
    if (!d || d.pointerId !== e.pointerId) return;
    info.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    const over = d.over;
    setDrag(null);
    if (commit && over !== d.from) onReorder(moveItem(d.ids, d.from, over));
  }

  function step(index: number, delta: -1 | 1): void {
    const to = index + delta;
    if (to < 0 || to >= items.length) return;
    onReorder(moveItem(items.map((it) => it.id), index, to));
  }

  function onHandleKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number): void {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      step(index, -1);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      step(index, 1);
    }
  }

  return (
    <ul className={`select-none space-y-2 ${className}`} aria-label={ariaLabel}>
      {items.map((item, i) => {
        const dragging = drag?.id === item.id;
        // 入れ替え先の線: 下へ動かすときは over の行の下、上へ動かすときは over の行の上
        const lineTop = drag !== null && !dragging && drag.over === i && drag.over < drag.from;
        const lineBottom = drag !== null && !dragging && drag.over === i && drag.over > drag.from;
        const name = labelOf(item);
        return (
          <li
            key={item.id}
            ref={(el) => {
              if (el) liRefs.current.set(item.id, el);
              else liRefs.current.delete(item.id);
            }}
            style={dragging ? { transform: `translateY(${drag.dy}px)` } : undefined}
            className={`relative flex items-stretch gap-1 rounded-xl ${
              dragging ? "z-10 border-2 border-ai bg-shiroai shadow-lg" : ""
            }`}
          >
            {lineTop ? (
              <span aria-hidden="true" className="absolute -top-1.5 right-0 left-0 h-1 rounded-full bg-ai" />
            ) : null}
            {lineBottom ? (
              <span aria-hidden="true" className="absolute right-0 -bottom-1.5 left-0 h-1 rounded-full bg-ai" />
            ) : null}
            <div className="min-w-0 flex-1">{renderItem(item, i)}</div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                aria-label={`${name}を上へ`}
                disabled={i === 0}
                onClick={() => step(i, -1)}
                className="flex size-12 cursor-pointer items-center justify-center rounded-xl border-2 border-ink-muted bg-raised text-xl leading-none font-bold text-ink hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-hanada"
              >
                ↑
              </button>
              <button
                type="button"
                aria-label={`${name}を下へ`}
                disabled={i === items.length - 1}
                onClick={() => step(i, 1)}
                className="flex size-12 cursor-pointer items-center justify-center rounded-xl border-2 border-ink-muted bg-raised text-xl leading-none font-bold text-ink hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-hanada"
              >
                ↓
              </button>
            </div>
            <button
              type="button"
              aria-label={`${name}をドラッグして動かす（上下キーでも動かせます）`}
              title="つかんで上下に動かす"
              style={{ touchAction: "none" }}
              onPointerDown={(e) => onPointerDown(e, i)}
              onPointerMove={onPointerMove}
              onPointerUp={(e) => finish(e, true)}
              onPointerCancel={(e) => finish(e, false)}
              onKeyDown={(e) => onHandleKeyDown(e, i)}
              className={`flex size-12 shrink-0 cursor-grab items-center justify-center self-center rounded-xl border-2 text-2xl font-bold text-ink focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-hanada ${
                dragging ? "cursor-grabbing border-ai bg-shiroai" : "border-ink-muted bg-raised hover:bg-surface"
              }`}
            >
              <span aria-hidden="true">≡</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export type { Props as ReorderListProps };

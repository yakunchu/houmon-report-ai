/**
 * 画面下に固定の操作バー「← 戻る」「次へ →」。どのタブでも同じ場所にあり、押すだけで前後のタブへ移る。
 * 高さ 56px 以上・文字 20px 以上。iPhone の下端（ホームバー）を避け、印刷では出さない。
 * - ①: 戻るは出さない。「次へ」は患者の氏名が無いときだけ無効で、理由を 1 行添える。
 * - ④: 「次へ」の代わりに「最初へ戻る」（①患者へ）。
 */
import { Button } from "./ui";

export function BottomNav({
  step,
  nextDisabled = false,
  nextHint,
  onBack,
  onNext,
  onRestart,
}: {
  step: 1 | 2 | 3 | 4;
  /** 「次へ」を押せないとき true（①で患者の氏名が無いときだけ） */
  nextDisabled?: boolean;
  /** 「次へ」が無効なときに添える理由（1 行） */
  nextHint?: string;
  onBack: () => void;
  onNext: () => void;
  /** ④の「最初へ戻る」（①患者へ） */
  onRestart: () => void;
}) {
  const big = "min-h-14 flex-1 text-xl";
  return (
    <nav
      aria-label="前後のタブへ移る"
      className="fixed inset-x-0 bottom-0 z-30 border-t-2 border-line bg-raised pb-[env(safe-area-inset-bottom)] print:hidden"
    >
      <div className="mx-auto max-w-[900px] px-4 py-2">
        <div className="flex gap-3">
          {step > 1 ? (
            <Button variant="secondary" className={big} onClick={onBack}>
              ← 戻る
            </Button>
          ) : null}
          {step < 4 ? (
            <Button
              variant="primary"
              className={`${big} ${step === 1 ? "w-full" : ""}`}
              onClick={onNext}
              disabled={nextDisabled}
              aria-describedby={nextDisabled && nextHint ? "bottom-nav-hint" : undefined}
            >
              次へ →
            </Button>
          ) : (
            <Button variant="secondary" className={big} onClick={onRestart}>
              最初へ戻る
            </Button>
          )}
        </div>
        {nextDisabled && nextHint ? (
          <p id="bottom-nav-hint" className="mt-1 text-center text-base text-ink">
            {nextHint}
          </p>
        ) : null}
      </div>
    </nav>
  );
}

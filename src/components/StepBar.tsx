/** 上部のタブ見出し（①患者 ②会話 ③下書き ④出力）。押すとそのタブへ移る */

export type StepStatus = "done" | "current" | "todo";
export type StepNo = 1 | 2 | 3 | 4;

const STEPS = [
  { n: "①", label: "患者", no: 1 },
  { n: "②", label: "会話", no: 2 },
  { n: "③", label: "下書き", no: 3 },
  { n: "④", label: "出力", no: 4 },
] as const;

const STATUS_TEXT: Record<StepStatus, string> = { done: "済み", current: "次はここ", todo: "　" };

export function StepBar({
  statuses,
  active,
  onJump,
}: {
  /** いま開いているタブ（見出しの強調と aria-current に使う。省略時は statuses の「いまここ」） */
  active?: StepNo;
  statuses: readonly [StepStatus, StepStatus, StepStatus, StepStatus];
  onJump: (step: StepNo) => void;
}) {
  return (
    <nav aria-label="作業の流れ" className="sticky top-0 z-20 border-b-2 border-line bg-raised print:hidden">
      <ol className="mx-auto flex max-w-[900px]">
        {STEPS.map((s, i) => {
          const status = statuses[i];
          const isOpen = active === undefined ? status === "current" : active === s.no;
          const tone =
            isOpen
              ? "border-b-4 border-ai bg-shiroai text-ai"
              : status === "done"
                ? "border-b-4 border-transparent text-ink"
                : "border-b-4 border-transparent text-ink-muted";
          return (
            <li key={s.no} className="min-w-0 flex-1">
              <button
                type="button"
                onClick={() => onJump(s.no)}
                aria-current={isOpen ? "step" : undefined}
                className={`flex min-h-12 w-full cursor-pointer flex-col items-center px-1 py-1 font-bold leading-tight focus-visible:outline-4 focus-visible:-outline-offset-4 focus-visible:outline-hanada ${tone}`}
              >
                <span>
                  {s.n}
                  {s.label}
                </span>
                <span className="text-base font-normal">
                  {status === "done" ? <span className="text-ai">✓</span> : null}
                  {isOpen ? "いまここ" : STATUS_TEXT[status]}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

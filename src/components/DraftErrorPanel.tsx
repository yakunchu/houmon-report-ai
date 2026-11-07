"use client";

/**
 * 下書きを作れなかったときの表示。原因（code）ごとに、見出し・説明・「次にすること」を出し分ける。
 * - 再試行ボタンは retryable が true のときだけ（retryable が無い古い応答は、原因ごとの既定値）。
 * - 利用者側で直せない原因（キー・権限・モデル・残高）は、管理者（社長）に伝えるための詳細を前面に出す。
 *   「詳細をコピー」でコピーするのは種別・モデル・発生時刻・経過秒だけ。会話の本文や個人情報は入れない。
 * - 色だけに頼らず、記号（✕ / ⚠）と見出しで伝える。
 */
import { useEffect, useState } from "react";
import { copyText } from "@/lib/ui/clipboard";
import { Button } from "./ui";

/** 画面が持つ下書きエラー。fetch 失敗・時間切れ・JSON 不正も同じ形で持つ */
export type DraftErrorInfo = {
  /** 画面に出す日本語の説明（サーバー、または画面側で作ったもの） */
  message: string;
  /** 原因の細分類（auth / credit_balance / rate_limited / timeout など） */
  code?: string;
  /** そのまま再試行して直る見込みがあるか */
  retryable?: boolean;
  /** 大分類（DraftResponse の error） */
  error: string;
  /** 送信してから失敗するまでの秒数 */
  elapsedSec: number;
  /** 使っているモデル名（わかるときだけ） */
  model?: string;
  /** 発生時刻（ISO 8601） */
  occurredAt: string;
  /**
   * 失敗の出どころ。device: この端末からサーバーに届かない・時間切れなど画面側で作ったもの /
   * server: サーバーが応答して返したもの。code=network はどちらにもあり、直す場所が逆になるため区別する
   */
  from?: "device" | "server";
};

export function makeDraftError(e: Omit<DraftErrorInfo, "occurredAt"> & { occurredAt?: string }): DraftErrorInfo {
  return { ...e, occurredAt: e.occurredAt ?? new Date().toISOString() };
}

type Guide = {
  icon: "✕" | "⚠";
  heading: string;
  description: string;
  steps: string[];
  /** 利用者側では直せない（管理者に連絡）。詳細の表示を前面に出す */
  admin?: boolean;
  /** 再試行ボタンを押せるまでの秒数 */
  waitSec?: number;
  /** retryable が応答に無いときの既定値 */
  retryDefault: boolean;
};

const ADMIN_STEPS = [
  "利用者側では直せません。管理者（社長）に連絡してください。",
  "下の「詳細をコピー」を押して、貼り付けて伝えてください。",
];

const GUIDES: Record<string, Guide> = {
  auth: {
    icon: "✕",
    heading: "API キーが使えません",
    description: "サーバーに設定されている API キーが、未設定か無効です。",
    steps: ADMIN_STEPS,
    admin: true,
    retryDefault: false,
  },
  permission: {
    icon: "✕",
    heading: "API キーの権限が足りません",
    description: "サーバーの API キーに、このモデルを使う権限がありません。",
    steps: ADMIN_STEPS,
    admin: true,
    retryDefault: false,
  },
  model_not_found: {
    icon: "✕",
    heading: "モデルが見つかりません",
    description: "サーバーに設定されているモデル名が正しくありません。",
    steps: ADMIN_STEPS,
    admin: true,
    retryDefault: false,
  },
  credit_balance: {
    icon: "✕",
    heading: "API の残高が足りません",
    description: "残高がなくなったため、下書きを作れません。チャージされるまで使えません。",
    steps: ADMIN_STEPS,
    admin: true,
    retryDefault: false,
  },
  rate_limited: {
    icon: "⚠",
    heading: "リクエストが集中しています",
    description: "短い時間に呼び出しが重なりました。少し待てば直ります。",
    steps: ["30 秒ほど待ってから、もう一度試してください。", "入力した内容はそのまま残っています。"],
    waitSec: 30,
    retryDefault: true,
  },
  overloaded: {
    icon: "⚠",
    heading: "Claude が混み合っています",
    description: "AI 側が一時的に混んでいます。少し待てば直ることが多いです。",
    steps: ["30 秒ほど待ってから、もう一度試してください。", "何度か続くときは、時間をあけてください。"],
    waitSec: 30,
    retryDefault: true,
  },
  server_error: {
    icon: "⚠",
    heading: "AI 側で一時的な問題が起きています",
    description: "こちらの操作が原因ではありません。",
    steps: ["少し待ってから、もう一度試してください。", "続けて失敗するときは、管理者（社長）に連絡してください。"],
    waitSec: 10,
    retryDefault: true,
  },
  network: {
    icon: "✕",
    heading: "サーバーに接続できませんでした",
    description: "このスマホ（端末）から、サーバーとの通信が途中で切れたか、つながりませんでした。",
    steps: [
      "スマホの Wi-Fi（または電波）がつながっているか確認してください。",
      "パソコン側のサーバーが動いているか確認してください（止まっていると、つながりません）。",
      "確認できたら、もう一度試してください。",
    ],
    retryDefault: true,
  },
  // サーバーは応答できている。サーバー（パソコン）から AI への通信が失敗した場合
  upstream_network: {
    icon: "✕",
    heading: "サーバーから AI につながりません",
    description:
      "スマホとサーバーの通信はできています。サーバー（パソコン）が AI（インターネット）に接続できませんでした。",
    steps: [
      "パソコン側のインターネット接続（Wi-Fi・有線・VPN）を確認してください。",
      "つながっていれば、少し待ってから、もう一度試してください。",
      "続けて失敗するときは、管理者（社長）に「詳細をコピー」を貼って連絡してください。",
    ],
    waitSec: 10,
    retryDefault: true,
  },
  timeout: {
    icon: "⚠",
    heading: "時間がかかりすぎて中止しました",
    description: "決まった時間（3 分）以内に結果が戻りませんでした。サーバー側では、まだ処理が続いている場合があります。",
    steps: [
      "30 秒ほど待ってから、もう一度試してください（すぐ押すと、前の処理と重なります）。",
      "続くときは、会話を短く分けてみてください。",
    ],
    waitSec: 30,
    retryDefault: true,
  },
  max_tokens: {
    icon: "⚠",
    heading: "下書きが途中で切れました",
    description: "出力が長くなりすぎて、最後まで書けませんでした。",
    steps: ["そのままもう一度試してください。", "続くときは、会話を短く分けてみてください。"],
    retryDefault: true,
  },
  refusal: {
    icon: "✕",
    heading: "AI が下書きを作れませんでした",
    description: "AI が安全上の理由で、この内容の下書きを断りました。同じ内容で再試行しても変わりません。",
    steps: [
      "会話の内容を確認してください（関係のない文章が混ざっていないか）。",
      "内容を直してから、もう一度「個人名を見えないようマスク処理する」に進んでください。",
    ],
    retryDefault: false,
  },
  bad_request: {
    icon: "✕",
    heading: "送った内容に問題がありました",
    description: "会話が長すぎるなど、AI が受け取れない内容でした。同じ内容で再試行しても変わりません。",
    steps: [
      "会話を短くして（長いときは前半と後半に分けて）ください。",
      "基本情報の家族構成・処方内容が極端に長くないかも確認してください。",
    ],
    retryDefault: false,
  },
  unknown: {
    icon: "⚠",
    heading: "原因がはっきりしません",
    description: "予期しない問題が起きました。",
    steps: ["もう一度試してください。", "続けて失敗するときは、管理者（社長）に「詳細をコピー」を貼って連絡してください。"],
    retryDefault: true,
  },
};

/** code（無ければ error）から案内の種類を決める */
export function guideKey(info: Pick<DraftErrorInfo, "code" | "error" | "from">): string {
  const alias: Record<string, string> = { invalid_request: "bad_request" };
  for (const raw of [info.code, info.error]) {
    if (!raw) continue;
    const k = alias[raw] ?? raw;
    if (!Object.hasOwn(GUIDES, k)) continue;
    // サーバーが返した接続エラーは「サーバー → AI」の問題。端末 → サーバーの network と案内を分ける
    return k === "network" && info.from === "server" ? "upstream_network" : k;
  }
  return "unknown";
}

/** この失敗で「もう一度試す」を出すか */
export function canRetry(info: Pick<DraftErrorInfo, "code" | "error" | "retryable" | "from">): boolean {
  return info.retryable ?? GUIDES[guideKey(info)].retryDefault;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** 管理者に伝えるための 1 行。会話本文・個人情報は入れない */
export function buildErrorDetail(info: DraftErrorInfo): string {
  const d = new Date(info.occurredAt);
  const when = Number.isNaN(d.getTime())
    ? info.occurredAt
    : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  return `在宅レポAI 下書きエラー: code=${info.code ?? "なし"} / error=${info.error} / 出どころ=${info.from ?? "不明"} / モデル=${info.model ?? "不明"} / 発生=${when} / 経過=${info.elapsedSec}秒`;
}

/**
 * 親側で key={occurredAt} を付けること（新しい失敗ごとにカウントダウンと「コピーしました」を初期化するため）。
 * retryDisabled: 入力の変更・オフライン・送信中など、いま送れない理由があるとき true。
 */
export function DraftErrorPanel({
  info,
  onRetry,
  retryDisabled = false,
}: {
  info: DraftErrorInfo;
  onRetry: () => void;
  retryDisabled?: boolean;
}) {
  const key = guideKey(info);
  const guide = GUIDES[key];
  const retry = canRetry(info);
  const initialWait = retry ? (guide.waitSec ?? 0) : 0;
  const [remaining, setRemaining] = useState(initialWait);
  const [copyState, setCopyState] = useState<"idle" | "ok" | "failed">("idle");

  // 混雑系の失敗は、待ってから押せるようにする（すぐ押しても同じ失敗になりやすいため）
  useEffect(() => {
    if (initialWait <= 0) return;
    const id = window.setInterval(() => {
      setRemaining((r) => (r > 0 ? r - 1 : 0));
    }, 1000);
    return () => window.clearInterval(id);
  }, [initialWait]);

  const detail = buildErrorDetail(info);
  const showDetail = guide.admin === true || copyState === "failed";
  const tone =
    guide.icon === "⚠" ? "border-akane bg-raised text-ink" : "border-akane bg-raised text-ink";

  async function handleCopy(): Promise<void> {
    const method = await copyText(detail);
    setCopyState(method === "failed" ? "failed" : "ok");
  }

  return (
    <div role="alert" className={`mt-3 rounded-xl border-2 p-4 ${tone}`}>
      <p className="break-words text-xl font-bold">
        <span aria-hidden="true" className="text-akane">
          {guide.icon}{" "}
        </span>
        下書きを作れませんでした：{guide.heading}
      </p>
      <p className="mt-2 break-words text-lg">{key === "unknown" && info.message !== "" ? info.message : guide.description}</p>

      <h3 className="mt-3 text-lg font-bold">次にすること</h3>
      <ol className="mt-1 list-decimal space-y-1 pl-6 text-lg">
        {guide.steps.map((s) => (
          <li key={s} className="break-words">
            {s}
          </li>
        ))}
      </ol>

      {showDetail ? (
        <p className="mt-3 select-all break-all rounded-md border-2 border-current bg-raised p-2 text-lg text-ink">
          {detail}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        {retry ? (
          <Button variant="primary" onClick={onRetry} disabled={retryDisabled || remaining > 0}>
            {remaining > 0 ? `あと${remaining}秒で押せます` : "もう一度試す"}
          </Button>
        ) : null}
        <Button onClick={() => void handleCopy()}>詳細をコピー</Button>
      </div>
      {copyState === "ok" ? (
        <p role="status" className="mt-2 text-lg font-bold">
          <span aria-hidden="true">✓ </span>
          コピーしました。管理者に貼り付けて送ってください。
        </p>
      ) : null}
      {copyState === "failed" ? (
        <p role="status" className="mt-2 text-lg font-bold">
          <span aria-hidden="true">⚠ </span>
          コピーできませんでした。上の文を長押しして選び、コピーしてください。
        </p>
      ) : null}
    </div>
  );
}

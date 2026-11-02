/** ④ 確定・出力。要確認が残っていれば一覧を出し、確定後はコピー・印刷できるテキストを出す */
import { useRef, useState } from "react";
import { Button, Section, UnsureBadge, WarnText } from "./ui";

type Props = {
  /** 「要確認」のまま残っている欄 */
  unsureLabels: string[];
  confirmed: boolean;
  onConfirm: () => void;
  /** ③の下書きに戻って直す */
  onBackToEdit: () => void;
  /** 名前を戻した出力テキスト（確定後のみ） */
  reportText: string;
  /** 下書きが今の会話・宛先・基本情報から作ったものではない（確定を止める） */
  stale: boolean;
};

export function OutputSection({ unsureLabels, confirmed, onConfirm, onBackToEdit, reportText, stale }: Props) {
  const preRef = useRef<HTMLPreElement>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  /** 出力テキストを選択状態にする */
  function selectReport(): void {
    const el = preRef.current;
    if (!el) return;
    const sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    const range = document.createRange();
    range.selectNodeContents(el);
    sel.addRange(range);
  }

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(reportText);
      setMessage({ ok: true, text: "コピーしました。報告書ソフトに貼り付けてください。" });
      return;
    } catch {
      // http の LAN 接続などでは使えない。選択状態にして古い方式を試す
    }
    selectReport();
    let done = false;
    try {
      done = document.execCommand("copy");
    } catch {
      done = false;
    }
    setMessage(
      done
        ? { ok: true, text: "コピーしました。報告書ソフトに貼り付けてください。" }
        : {
            ok: false,
            text: "自動でコピーできませんでした。文章を選択状態にしたので、長押し（パソコンは Ctrl+C）でコピーしてください。",
          },
    );
  }

  // 置き換え用の記号の形だけを探す（出力の見出し【基本情報】【S】などとは区別する）
  const leftoverTokens = confirmed && /【(?:患者[A-Z]|家族\d+|その他\d+|住所|生年月日|電話|郵便番号)】/.test(reportText);

  return (
    <Section id="step-4" title="④ 出力" className="print:border-0 print:p-0">
      {!confirmed ? (
        <div className="print:hidden">
          {stale ? (
            <WarnText>
              この下書きは、今の会話・宛先・基本情報から作ったものではありません。確定できません。②で「マスクして確認」→「下書きを作り直す」を押してください。
            </WarnText>
          ) : null}
          {unsureLabels.length > 0 ? (
            <div role="alert" className="rounded-lg border-2 border-amber-700 bg-amber-50 p-4">
              <p className="mb-2 text-xl font-bold text-amber-950">
                <span aria-hidden="true">⚠ </span>
                「要確認」のままの欄が {unsureLabels.length} 件あります
              </p>
              <ul className="mb-3 space-y-2">
                {unsureLabels.map((l, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <UnsureBadge />
                    <span className="font-bold">{l}</span>
                  </li>
                ))}
              </ul>
              <p className="text-amber-950">このまま確定すると、出力にも「要確認」と入ります。</p>
            </div>
          ) : (
            <p className="rounded-lg border-2 border-green-800 bg-green-50 p-4 font-bold text-green-950">
              <span aria-hidden="true">✓ </span>
              「要確認」の欄は残っていません。
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-3">
            <Button variant="primary" onClick={onConfirm} disabled={stale}>
              {unsureLabels.length > 0 ? "このまま確定" : "確定する"}
            </Button>
            <Button onClick={onBackToEdit}>戻って直す</Button>
          </div>
        </div>
      ) : (
        <div>
          <div className="flex flex-wrap gap-3 print:hidden">
            <Button variant="primary" onClick={copy}>
              コピー
            </Button>
            <Button onClick={() => window.print()}>印刷</Button>
            <Button onClick={onBackToEdit}>下書きに戻って直す</Button>
          </div>
          <div aria-live="polite" className="print:hidden">
            {message ? (
              message.ok ? (
                <p className="mt-3 rounded-lg border-2 border-green-800 bg-green-50 p-3 font-bold text-green-950">
                  <span aria-hidden="true">✓ </span>
                  {message.text}
                </p>
              ) : (
                <WarnText>{message.text}</WarnText>
              )
            ) : null}
          </div>
          {leftoverTokens ? (
            <div className="print:hidden">
              <WarnText>名前に戻せなかった記号（【 】）が残っています。内容を確認してください。</WarnText>
            </div>
          ) : null}
          <p className="mt-3 text-slate-800 print:hidden">
            名前などは、この端末の中で元に戻しています。報告書ソフトと同じ並びです。
          </p>
          <pre
            ref={preRef}
            className="mt-3 whitespace-pre-wrap break-words rounded-lg border-2 border-slate-400 bg-white p-4 font-[inherit] leading-8 print:border-0 print:p-0"
          >
            {reportText}
          </pre>
        </div>
      )}
    </Section>
  );
}

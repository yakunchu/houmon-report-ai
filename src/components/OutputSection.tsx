/**
 * ④ 確定・出力。要確認が残っていれば一覧を出し、確定後は「送り方」を選んでコピー・印刷・メール・チャットに出せる。
 * 受け取るテキストはすべて名前を戻し済み（ReportApp で unmaskText を通したもの）。
 */
import { useRef, useState } from "react";
import { copyText } from "@/lib/ui/clipboard";
import { printModelToText, type EmailParts, type PrintModel } from "@/lib/report/formats";
import { PrintReport } from "./PrintReport";
import { Button, ChoiceButtons, Section, UnsureBadge, WarnText } from "./ui";

type Props = {
  /** 「要確認」のまま残っている欄 */
  unsureLabels: string[];
  confirmed: boolean;
  onConfirm: () => void;
  /** ③の下書きに戻って直す */
  onBackToEdit: () => void;
  /** 報告書ソフト用の出力テキスト（名前を戻し済み。確定後のみ） */
  reportText: string;
  /** メール（件名と本文。名前を戻し済み） */
  email: EmailParts;
  /** チャット用の短文（名前を戻し済み） */
  chat: string;
  /** 印刷・FAX 用の構造（名前を戻し済み） */
  printModel: PrintModel | null;
  /** メール・チャットの本文に患者名を入れる（既定オフ） */
  includePatientName: boolean;
  onIncludePatientNameChange: (value: boolean) => void;
  /** 下書きが今の会話・宛先・基本情報から作ったものではない（確定を止める） */
  stale: boolean;
};

type FormatKey = "software" | "print" | "email" | "chat";

const FORMATS: { key: FormatKey; label: string }[] = [
  { key: "software", label: "報告書ソフト用" },
  { key: "print", label: "印刷・FAX" },
  { key: "email", label: "メール" },
  { key: "chat", label: "チャット" },
];

const PASTE_HINT: Record<FormatKey, string> = {
  software: "コピーしました。報告書ソフトに貼り付けてください。",
  print: "",
  email: "コピーしました。メールアプリに貼り付けてください。",
  chat: "コピーしました。チャットに貼り付けてください。",
};

/** 名前に戻せなかった記号（置き換え用の記号の形だけを探す。出力の見出し【基本情報】【S】などとは区別する） */
const LEFTOVER_TOKEN_RE = /【(?:患者[A-Z]|家族\d+|その他\d+|住所|生年月日|電話|郵便番号)】/;

/** mailto の URL がこれより長いと、メールアプリによっては途中で切れる（目安） */
const MAILTO_LONG = 1800;

const preClass =
  "mt-3 whitespace-pre-wrap break-words rounded-xl border-2 border-line bg-raised p-4 font-[inherit] leading-8 print:border-0 print:p-0";

/** 画面用の表（項目／結果／備考）。「要確認」は印を付けて太字 */
function PreviewTable({ head, table }: { head: readonly string[]; table: PrintModel["life"] }) {
  return (
    <>
      <h3 className="mt-4 border-b-2 border-ink-muted font-bold">{table.title}</h3>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {head.map((h) => (
                <th key={h} className="border border-ink-muted bg-surface px-2 py-1 text-left">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r, i) => (
              <tr key={i}>
                <td className="border border-ink-muted px-2 py-1">{r.item}</td>
                <td className="border border-ink-muted px-2 py-1">
                  {r.result.includes("要確認") ? (
                    <>
                      <span aria-hidden="true">⚠ </span>
                      <strong>{r.result}</strong>
                    </>
                  ) : (
                    r.result
                  )}
                </td>
                <td className="border border-ink-muted px-2 py-1">{r.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** 画面用の A4 プレビュー（簡略表示）。印刷時は PrintReport が出るのでこちらは隠す */
function PrintPreview({ model }: { model: PrintModel }) {
  const pairClass = "grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 sm:grid-cols-[7rem_1fr_7rem_1fr]";
  const dt = "font-bold text-ink";
  const dd = "break-words";
  return (
    <div className="mt-3 rounded-xl border-2 border-line bg-raised p-4 print:hidden">
      <p className="mb-3 text-center text-xl font-bold">{model.title}</p>
      <dl className={pairClass}>
        {model.meta.map((p, i) => (
          <div key={i} className="contents">
            <dt className={dt}>{p.label}</dt>
            <dd className={dd}>{p.value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 rounded-md border-2 border-ink-muted p-2 font-bold">
        <span aria-hidden="true">⚠ </span>
        {model.notice}
      </p>

      <h3 className="mt-4 border-b-2 border-ink-muted font-bold">{model.basicTitle}</h3>
      <dl className={`${pairClass} mt-2`}>
        {model.basic.map((p, i) => (
          <div key={i} className="contents">
            <dt className={dt}>{p.label}</dt>
            <dd className={dd}>{p.value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-4 rounded-md border-2 border-ink-muted p-3">
        <h3 className="font-bold">{model.contactTitle}</h3>
        <ul className="mt-1">
          {(model.contact.length > 0 ? model.contact : ["—"]).map((c, i) => (
            <li key={i} className="font-bold">
              ・{c}
            </li>
          ))}
        </ul>
      </div>

      <PreviewTable head={model.tableHead} table={model.medication} />
      <PreviewTable head={model.tableHead} table={model.life} />

      <h3 className="mt-4 border-b-2 border-ink-muted font-bold">{model.soapTitle}</h3>
      <dl className="mt-2 space-y-1">
        {model.soap.map((p, i) => (
          <div key={i} className="grid grid-cols-[2rem_1fr] gap-x-2">
            <dt className={dt}>{p.label}</dt>
            <dd className="whitespace-pre-wrap break-words">{p.value}</dd>
          </div>
        ))}
      </dl>

      <h3 className="mt-4 border-b-2 border-ink-muted font-bold">{model.fixedTitle}</h3>
      <dl className="mt-2 space-y-1">
        {model.fixed.map((p, i) => (
          <div key={i} className="grid grid-cols-[7rem_1fr] gap-x-3">
            <dt className={dt}>{p.label}</dt>
            <dd className={dd}>{p.value}</dd>
          </div>
        ))}
      </dl>

      <h3 className="mt-4 border-b-2 border-ink-muted font-bold">{model.prescriptionTitle}</h3>
      {model.prescriptionHeader !== "" ? <p className="mt-2">{model.prescriptionHeader}</p> : null}
      <ul className="mt-1">
        {model.prescriptionItems.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
      <p>併用薬：{model.concomitant}</p>
    </div>
  );
}

export function OutputSection({
  unsureLabels,
  confirmed,
  onConfirm,
  onBackToEdit,
  reportText,
  email,
  chat,
  printModel,
  includePatientName,
  onIncludePatientNameChange,
  stale,
}: Props) {
  const preRef = useRef<HTMLPreElement>(null);
  const [format, setFormat] = useState<FormatKey>("software");
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

  async function copy(text: string, okText: string): Promise<void> {
    // secure context では navigator.clipboard、http の LAN 接続などでは textarea + execCommand の予備手段
    const method = await copyText(text);
    if (method !== "failed") {
      setMessage({ ok: true, text: okText });
      return;
    }
    // どちらも使えなければ、本文を選択状態にして手動コピーを案内する
    selectReport();
    setMessage({
      ok: false,
      text: "自動でコピーできませんでした。文章を選択状態にしたので、長押し（パソコンは Ctrl+C）でコピーしてください。",
    });
  }

  function changeFormat(label: string): void {
    const f = FORMATS.find((x) => x.label === label);
    if (!f) return;
    setFormat(f.key);
    setMessage(null);
  }

  const mailtoUrl = `mailto:?subject=${encodeURIComponent(email.subject)}&body=${encodeURIComponent(email.body)}`;

  function openMailer(): void {
    // 名前に戻せなかった記号が残っていれば開かない（記号のまま相手に届くのを防ぐ）
    if (LEFTOVER_TOKEN_RE.test(`${email.subject}\n${email.body}`)) {
      setMessage({ ok: false, text: "名前に戻せなかった記号（【 】）が残っているため、メールアプリは開きません。内容を確認してください。" });
      return;
    }
    window.location.href = mailtoUrl;
  }

  // 選んでいる送り方の本文に、名前に戻せなかった記号が残っていないか
  const shownText =
    format === "software"
      ? reportText
      : format === "email"
        ? `${email.subject}\n${email.body}`
        : format === "chat"
          ? chat
          : printModel
            ? printModelToText(printModel)
            : "";
  const leftoverTokens = confirmed && LEFTOVER_TOKEN_RE.test(shownText);

  const nameCheck = (
    <label className="mt-3 flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border-2 border-ink-muted bg-raised px-3 py-2 text-lg font-bold has-[:focus-visible]:outline-4 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-hanada print:hidden">
      <input
        type="checkbox"
        checked={includePatientName}
        onChange={(e) => {
          // 本文が変わるので、前の「コピーしました」は消す（患者名の有無が違う本文を貼らないように）
          setMessage(null);
          onIncludePatientNameChange(e.target.checked);
        }}
        className="h-6 w-6 shrink-0 cursor-pointer"
      />
      <span>
        本文に患者名を入れる
        <span className="block text-base font-normal text-ink">
          {includePatientName
            ? "✓ 入れています。送る前に宛先をもう一度確認してください。"
            : "入れていません（患者名は別送の報告書で伝える）。"}
        </span>
      </span>
    </label>
  );

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
            <div role="alert" className="rounded-xl border-2 border-akane bg-raised p-4">
              <p className="mb-2 text-xl font-bold text-akane">
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
              <p className="text-ink">このまま確定すると、出力にも「要確認」と入ります。</p>
            </div>
          ) : (
            <p className="rounded-xl border-2 border-ai bg-shiroai p-4 font-bold text-ink">
              <span aria-hidden="true" className="text-ai">
                ✓{" "}
              </span>
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
          <div className="print:hidden">
            <p className="mb-2 text-xl font-bold text-ink">送り方を選ぶ</p>
            <ChoiceButtons
              name="output-format"
              label="送り方"
              options={FORMATS.map((f) => f.label)}
              value={FORMATS.find((f) => f.key === format)?.label ?? ""}
              onChange={changeFormat}
            />
          </div>

          <div className="mt-4 flex flex-wrap gap-3 print:hidden">
            {format === "software" ? (
              <>
                <Button variant="primary" onClick={() => copy(reportText, PASTE_HINT.software)} disabled={leftoverTokens}>
                  コピー
                </Button>
                <Button onClick={() => window.print()}>印刷</Button>
              </>
            ) : null}
            {format === "print" ? (
              <Button variant="primary" onClick={() => window.print()}>
                PDF・印刷
              </Button>
            ) : null}
            {format === "email" ? (
              <>
                <Button
                  variant="primary"
                  onClick={() => copy(`${email.subject}\n\n${email.body}`, PASTE_HINT.email)}
                  disabled={leftoverTokens}
                >
                  件名と本文をコピー
                </Button>
                <Button onClick={openMailer} disabled={leftoverTokens}>
                  メールアプリで開く
                </Button>
              </>
            ) : null}
            {format === "chat" ? (
              <Button variant="primary" onClick={() => copy(chat, PASTE_HINT.chat)} disabled={leftoverTokens}>
                コピー
              </Button>
            ) : null}
            <Button onClick={onBackToEdit}>下書きに戻って直す</Button>
          </div>

          {format === "email" ? (
            <p className="mt-2 text-ink print:hidden">
              {mailtoUrl.length > MAILTO_LONG ? (
                <>
                  <span aria-hidden="true">⚠ </span>
                  <strong>本文が長いため、「メールアプリで開く」では途中で切れるおそれがあります。</strong>
                </>
              ) : null}
              長いときや、メールアプリが開かないときは「件名と本文をコピー」を使ってください（メールアプリが入っていないパソコンでは、「メールアプリで開く」を押しても何も起きません）。
            </p>
          ) : null}

          <div aria-live="polite" className="print:hidden">
            {message ? (
              message.ok ? (
                <p className="mt-3 rounded-xl border-2 border-ai bg-shiroai p-3 font-bold text-ink">
                  <span aria-hidden="true" className="text-ai">
                    ✓{" "}
                  </span>
                  {message.text}
                </p>
              ) : (
                <WarnText>{message.text}</WarnText>
              )
            ) : null}
          </div>
          {leftoverTokens ? (
            <div className="print:hidden">
              <WarnText>
                名前に戻せなかった記号（【 】）が残っています。内容を確認してください。直るまで、コピーとメールアプリで開くは押せません。
              </WarnText>
            </div>
          ) : null}

          {format === "software" ? (
            <>
              <p className="mt-3 text-ink print:hidden">
                名前などは、この端末の中で元に戻しています。報告書ソフトと同じ並びです。
              </p>
              <pre ref={preRef} className={preClass}>
                {reportText}
              </pre>
            </>
          ) : null}

          {format === "print" ? (
            <>
              <p className="mt-3 text-ink print:hidden">
                A4 1 枚の送信票つき報告書です。「PDF・印刷」で、印刷または PDF 保存（FAX 送信用）ができます。患者名は入ります。
              </p>
              {printModel ? (
                <>
                  <PrintPreview model={printModel} />
                  <PrintReport model={printModel} />
                </>
              ) : null}
            </>
          ) : null}

          {format === "email" ? (
            <>
              <p className="mt-3 text-ink print:hidden">
                {includePatientName
                  ? "患者名を本文に入れています。送る前に宛先をもう一度確認してください。"
                  : "件名と本文に患者名は入れていません（別送の報告書で伝えます）。"}
              </p>
              {nameCheck}
              <div className="mt-3 print:hidden">
                <p className="font-bold text-ink">件名</p>
                <p className="rounded-xl border-2 border-line bg-raised p-3">{email.subject}</p>
              </div>
              <p className="mt-3 font-bold text-ink print:hidden">本文</p>
              <pre ref={preRef} className={`${preClass} !mt-1`}>
                {email.body}
              </pre>
            </>
          ) : null}

          {format === "chat" ? (
            <>
              <p className="mt-3 text-ink print:hidden">
                短い連絡用です（{Array.from(chat.replace(/\n/g, "")).length} 字）。患者名は、既定では入れていません。
              </p>
              <p className="mt-1 font-bold text-ink print:hidden">
                急ぎ・急変は電話で。チャットは利用者ごとのグループに書く前提です。
              </p>
              {nameCheck}
              <pre ref={preRef} className={preClass}>
                {chat}
              </pre>
            </>
          ) : null}
        </div>
      )}
    </Section>
  );
}

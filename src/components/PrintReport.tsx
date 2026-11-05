"use client";

/**
 * 印刷・FAX 用の A4（本紙 1 枚＋別紙：処方内容 1 枚）。
 * 既定では画面に出ず、印刷のときだけ出る（hidden print:block）。screen を付けると画面でも A4 の見た目で出す（見本ページ用）。
 * 並び: 宛名・報告日 → 表題・発信元・送信票 → 患者・訪問 → 連絡事項 → 服薬管理｜生活状況（左右） → 指導内容（SOAP） → 定型欄 → 別紙：処方内容（改ページ）。
 * 体裁: 余白 15mm、本文 14px（10.5pt）、表の中 13.3px（10pt）、罫線 1px、色に頼らない（要確認は文字と太字）。
 * 内容は buildPrintModel の結果（名前は戻し済み）。フォントは周りから引き継ぐ。
 */
import type { PrintModel, PrintPair, PrintTable } from "@/lib/report/formats";

const PRINT_CSS = `
@page { size: A4; margin: 15mm }
.print-report { font-size: 14px; line-height: 1.38; color: #000; background: #fff; }
.print-report * { box-sizing: border-box; }
.print-report h1 { font-size: 20px; font-weight: 700; margin: 4px 0 0; text-align: center; letter-spacing: 0.1em; }
.print-report h2 { font-size: 14px; font-weight: 700; margin: 6px 0 2px; border-bottom: 1px solid #000; }
.print-report table { width: 100%; border-collapse: collapse; font-size: 13.3px; line-height: 1.28; }
.print-report th, .print-report td { border: 1px solid #000; padding: 0 4px; text-align: left; vertical-align: top; }
.print-report th { font-weight: 700; }
.print-report tr { break-inside: avoid; }
.print-report .head-row { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; font-weight: 700; }
.print-report .sender { margin: 0; text-align: right; font-size: 13.3px; }
.print-report .send-note { margin: 3px 0 0; font-size: 11px; line-height: 1.35; }
.print-report .send-note p { margin: 0; }
.print-report .label { width: 5.5em; }
.print-report .item { width: 6.2em; }
.print-report .soap-text { white-space: pre-wrap; word-break: break-word; }
.print-report ul { margin: 0; padding: 0; list-style: none; }
.print-report .contact { border: 1px solid #000; padding: 2px 6px; margin: 6px 0 0; }
.print-report .contact h2 { margin: 0 0 2px; }
.print-report .contact li { font-weight: 700; }
.print-report .pair-2col { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; align-items: start; margin-top: 6px; }
.print-report .pair-2col h2 { margin-top: 0; }
.print-report .appendix { break-before: page; page-break-before: always; }
.print-report .appendix li { font-size: 14px; }
.print-report.on-screen { width: 210mm; max-width: 100%; margin: 0 auto; padding: 15mm; border: 1px solid #000; }
.print-report.on-screen .appendix { margin-top: 10mm; padding-top: 6mm; border-top: 2px dashed #000; }
@media print {
  .print-report.on-screen { width: auto; max-width: none; margin: 0; padding: 0; border: 0; }
  .print-report.on-screen .appendix { margin-top: 0; padding-top: 0; border-top: 0; }
}
`;

/** 「要確認」の文字だけ太字にする（色には頼らない） */
function Emphasize({ text }: { text: string }) {
  const parts = text.split("要確認");
  return (
    <>
      {parts.map((part, i) => (
        <span key={i}>
          {part}
          {i < parts.length - 1 ? <strong>要確認</strong> : null}
        </span>
      ))}
    </>
  );
}

/** ラベル｜値 の表。columns=2 のときは左右 2 組を 1 行に並べる */
function PairTable({ pairs, columns = 1 }: { pairs: PrintPair[]; columns?: 1 | 2 }) {
  if (columns === 1) {
    return (
      <table>
        <tbody>
          {pairs.map((p, i) => (
            <tr key={i}>
              <th className="label" scope="row">
                {p.label}
              </th>
              <td>{p.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  const rows: [PrintPair, PrintPair | undefined][] = [];
  for (let i = 0; i < pairs.length; i += 2) rows.push([pairs[i], pairs[i + 1]]);
  return (
    <table>
      <tbody>
        {rows.map(([a, b], i) => (
          <tr key={i}>
            <th className="label" scope="row">
              {a.label}
            </th>
            <td>{a.value}</td>
            {b ? (
              <>
                <th className="label" scope="row">
                  {b.label}
                </th>
                <td>{b.value}</td>
              </>
            ) : (
              <td colSpan={2} />
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** 項目｜内容 の 2 列表 */
function RowTable({ head, table }: { head: readonly string[]; table: PrintTable }) {
  return (
    <div>
      <h2>{table.title}</h2>
      <table>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((r, i) => (
            <tr key={i}>
              <th className="item" scope="row">
                {r.item}
              </th>
              <td>
                <Emphasize text={r.content} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PrintReport({ model, screen = false }: { model: PrintModel; screen?: boolean }) {
  return (
    <div className={`print-report ${screen ? "on-screen" : "hidden print:block"}`}>
      <style>{PRINT_CSS}</style>

      <div className="head-row">
        <span>{model.addressee}</span>
        <span>報告日　{model.reportDate}</span>
      </div>

      <h1>{model.title}</h1>
      <p className="sender">
        {model.sender.map((s, i) => (
          <span key={i}>
            {i > 0 ? "　" : ""}
            {s.label} {s.value}
          </span>
        ))}
      </p>
      <div className="send-note">
        {model.sendNote.map((n, i) => (
          <p key={i}>{n}</p>
        ))}
      </div>

      <h2>{model.patientTitle}</h2>
      <PairTable pairs={model.patient} columns={2} />

      <div className="contact">
        <h2>{model.contactTitle}</h2>
        <ul>
          {(model.contact.length > 0 ? model.contact : ["—"]).map((c, i) => (
            <li key={i}>・{c}</li>
          ))}
        </ul>
      </div>

      <div className="pair-2col">
        <RowTable head={model.tableHead} table={model.medication} />
        <RowTable head={model.tableHead} table={model.life} />
      </div>

      <h2>{model.soapTitle}</h2>
      <table>
        <tbody>
          {model.soap.map((p, i) => (
            <tr key={i}>
              <th className="label" scope="row">
                {p.label}
              </th>
              <td className="soap-text">{p.value}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>{model.fixedTitle}</h2>
      <PairTable pairs={model.fixed} />

      <div className="appendix">
        <h2>{model.appendixTitle}</h2>
        {model.prescriptionHeader !== "" ? <p>{model.prescriptionHeader}</p> : null}
        <ul>
          {model.prescriptionItems.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
        <p>併用薬：{model.concomitant}</p>
      </div>
    </div>
  );
}

"use client";

/**
 * 印刷・FAX 用の A4 1 枚。画面では見えず、印刷のときだけ出る（hidden print:block）。
 * 内容は buildPrintModel の結果（名前は戻し済み）。フォントは周りから引き継ぐ。
 */
import type { PrintModel } from "@/lib/report/formats";

const PRINT_CSS = `
@page { size: A4; margin: 12mm }
@media print {
  .print-report { font-size: 12.5px; line-height: 1.45; color: #000; background: #fff; }
  .print-report h1 { font-size: 17px; font-weight: 700; margin: 0 0 4px; text-align: center; }
  .print-report h2 { font-size: 13px; font-weight: 700; margin: 8px 0 3px; border-bottom: 1px solid #000; }
  .print-report table { width: 100%; border-collapse: collapse; }
  .print-report th, .print-report td { border: 1px solid #000; padding: 2px 5px; text-align: left; vertical-align: top; }
  .print-report th { font-weight: 700; background: #eee; }
  .print-report tr { break-inside: avoid; }
  .print-report .notice { border: 1px solid #000; padding: 3px 6px; margin: 4px 0; font-weight: 700; }
  .print-report .label { width: 6.5em; font-weight: 700; background: #eee; white-space: nowrap; }
  .print-report .soap-text { white-space: pre-wrap; word-break: break-word; }
  .print-report ul { margin: 0; padding: 0; list-style: none; }
  .print-report .contact { border: 1px solid #000; padding: 3px 6px; margin: 6px 0 0; }
  .print-report .contact h2 { margin: 0 0 2px; }
  .print-report .contact li { font-weight: 700; }
}
`;

function PairTable({ pairs, columns = 1 }: { pairs: { label: string; value: string }[]; columns?: 1 | 2 }) {
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
  // 2 列組（左右に並べて縦を節約する）
  const rows: [typeof pairs[number], typeof pairs[number] | undefined][] = [];
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

/** 「要確認」を含むセルは太字（色には頼らない） */
function Cell({ text }: { text: string }) {
  return <td>{text.includes("要確認") ? <strong>{text}</strong> : text}</td>;
}

function RowTable({ head, table }: { head: readonly string[]; table: PrintModel["life"] }) {
  return (
    <>
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
              <td>{r.item}</td>
              <Cell text={r.result} />
              <td>{r.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export function PrintReport({ model }: { model: PrintModel }) {
  return (
    <div className="print-report hidden print:block">
      <style>{PRINT_CSS}</style>
      <h1>{model.title}</h1>
      <PairTable pairs={model.meta} columns={2} />
      <p className="notice">{model.notice}</p>

      <h2>{model.basicTitle}</h2>
      <PairTable pairs={model.basic} columns={2} />

      <div className="contact">
        <h2>{model.contactTitle}</h2>
        <ul>
          {(model.contact.length > 0 ? model.contact : ["—"]).map((c, i) => (
            <li key={i}>・{c}</li>
          ))}
        </ul>
      </div>

      <RowTable head={model.tableHead} table={model.medication} />
      <RowTable head={model.tableHead} table={model.life} />

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

      <h2>{model.prescriptionTitle}</h2>
      {model.prescriptionHeader !== "" ? <p>{model.prescriptionHeader}</p> : null}
      <ul>
        {model.prescriptionItems.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
      <p>併用薬：{model.concomitant}</p>
    </div>
  );
}

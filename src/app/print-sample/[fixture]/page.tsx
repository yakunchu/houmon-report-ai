import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintReport } from "@/components/PrintReport";
import { buildPrintModel } from "@/lib/report/formats";
import { SAMPLE_FIXTURES, sampleFormatArgs, type SampleFixture } from "@/lib/report/sample-args";

export const metadata: Metadata = {
  title: "印刷見本 | 在宅レポAI（仮）",
  description: "印刷・FAX 用 A4 のレイアウト確認用ページ。架空データだけを使う。",
  robots: { index: false, follow: false },
};

export function generateStaticParams(): { fixture: SampleFixture }[] {
  return SAMPLE_FIXTURES.map((fixture) => ({ fixture }));
}

function isSampleFixture(s: string): s is SampleFixture {
  return (SAMPLE_FIXTURES as readonly string[]).includes(s);
}

const LABELS: Record<SampleFixture, string> = {
  "yamamoto-hanako": "ケアマネ宛て（山本さん）",
  "sasaki-kiyoshi": "医師宛て（佐々木さん）",
};

export default async function PrintSamplePage({ params }: { params: Promise<{ fixture: string }> }) {
  const { fixture } = await params;
  if (!isSampleFixture(fixture)) notFound();
  const model = buildPrintModel(sampleFormatArgs(fixture));

  return (
    <main className="px-4 py-6">
      <div className="mx-auto mb-4 max-w-[210mm] print:hidden">
        <p className="rounded-xl border-2 border-akane bg-raised p-3 font-bold text-ink">
          <span aria-hidden="true">⚠ </span>
          架空データの印刷見本。本番の患者データではありません。
        </p>
        <ul className="mt-3 flex flex-wrap gap-3">
          {SAMPLE_FIXTURES.map((f) => (
            <li key={f}>
              <Link
                href={`/print-sample/${f}`}
                aria-current={f === fixture ? "page" : undefined}
                className="inline-flex min-h-12 items-center rounded-xl border-2 border-ink-muted bg-raised px-5 py-2 text-lg font-bold text-ink hover:bg-surface aria-[current=page]:border-ai aria-[current=page]:text-ai"
              >
                {f === fixture ? "✓ " : ""}
                {LABELS[f]}
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-ink">印刷の確認は Ctrl+P で行います（用紙は A4、余白は既定のまま）。</p>
      </div>
      <div className="overflow-x-auto">
        <PrintReport model={model} screen />
      </div>
    </main>
  );
}

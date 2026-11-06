import type { Metadata } from "next";
import { TranscriptCheck } from "@/components/transcript-check/TranscriptCheck";

export const metadata: Metadata = {
  title: "文字起こしの精度を確かめる | 在宅レポAI（仮）",
  description: "架空台本を読み上げて録音し、ボイスメモとショートカットの文字起こしを台本と比べる画面。入力は端末の外に送らない。患者データは扱わない。",
  robots: { index: false, follow: false },
};

export default function TranscriptCheckPage() {
  return <TranscriptCheck />;
}

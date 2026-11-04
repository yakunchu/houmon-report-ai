import type { Metadata } from "next";
import { DeviceDiag } from "@/components/diag/DeviceDiag";

export const metadata: Metadata = {
  title: "端末診断 | 在宅レポAI（仮）",
  description: "この端末で録音と端末内の音声認識が使えるかを確かめる診断画面。患者データは扱わない。",
  robots: { index: false, follow: false },
};

export default function DiagPage() {
  return <DeviceDiag />;
}

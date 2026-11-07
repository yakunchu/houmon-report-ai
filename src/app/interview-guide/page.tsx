import type { Metadata } from "next";
import { InterviewGuide } from "@/components/interview/InterviewGuide";

export const metadata: Metadata = {
  title: "想定問答集 | 在宅レポAI（仮）",
  description: "訪問時に決まった順番で質問し、答えを自分の声で言い直す（オウム返し）ための読み上げ用の台本。すべて架空の例文。",
  robots: { index: false, follow: false },
};

export default function InterviewGuidePage() {
  return <InterviewGuide />;
}

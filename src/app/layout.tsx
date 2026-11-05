import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { BIZ_UDPGothic, Zen_Maru_Gothic } from "next/font/google";
import "./globals.css";

export const metadata: Metadata = {
  title: "在宅レポAI（仮）",
  description: "在宅訪問の会話から、居宅療養管理指導報告書の下書きを作ります。AIは下書きまで、判断は薬剤師が行います。",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

const bizUdp = BIZ_UDPGothic({
  weight: ["400", "700"],
  subsets: ["latin"],
  variable: "--font-biz-udp",
  display: "swap",
  preload: false,
});

const zenMaru = Zen_Maru_Gothic({
  weight: ["700"],
  subsets: ["latin"],
  variable: "--font-zen-maru",
  display: "swap",
  preload: false,
});

// LayoutProps<"/"> は next build が生成する型なので使わず、明示的に書く
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja" className={`${bizUdp.variable} ${zenMaru.variable}`}>
      <body>{children}</body>
    </html>
  );
}

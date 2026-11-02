import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "在宅レポAI（仮）",
  description: "在宅訪問の会話から、居宅療養管理指導報告書の下書きを作ります。AIは下書きまで、判断は薬剤師が行います。",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

// LayoutProps<"/"> は next build が生成する型なので使わず、明示的に書く
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}

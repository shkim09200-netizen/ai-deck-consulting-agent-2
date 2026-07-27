import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Deck Consulting Agent",
  description: "SparkLabs 피칭덱 컨설팅 — Script & Skeleton 생성",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "poe2-filter · 安全优先过滤器生成器",
  description: "基于 NeverSink 和每日物价的 Path of Exile 2 掉落过滤器生成器。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

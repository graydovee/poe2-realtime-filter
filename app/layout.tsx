import type { Metadata } from "next";

import "@fontsource/cinzel/400.css";
import "@fontsource/cinzel/600.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";

import "./globals.css";

export const metadata: Metadata = {
  title: "poe2-filter · PoE2 过滤器编辑器",
  description: "支持自选基础过滤器和实时物价的 Path of Exile 2 掉落过滤器编辑器。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <a href="#main" className="sr-only-focusable fixed left-4 top-3 z-50 rounded-sm border border-gold/50 bg-surface-2 px-3 py-2 text-xs text-ink">
          跳到主要内容
        </a>
        {children}
      </body>
    </html>
  );
}

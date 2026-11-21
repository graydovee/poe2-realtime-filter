import Image from "next/image";
import type { ReactNode } from "react";
import { DesktopUpdate } from "./desktop-update";

export function AppShell({ title, navigation, children }: { title: string; navigation: ReactNode; children: ReactNode }) {
  return (
    <div className="app-vignette min-h-screen">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex min-h-16 max-w-[1440px] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2 sm:px-8 lg:px-10">
          <div className="flex items-center gap-3">
            <Image src="/brand/poe2-filter.png" alt="" width={36} height={36} className="shrink-0" unoptimized />
            <strong className="font-display text-[15px] font-semibold tracking-wide text-ink">PoE2 Realtime Filter</strong>
          </div>
          {navigation}
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-xs font-medium text-ink-muted">{"v" + process.env.NEXT_PUBLIC_APP_VERSION}</span>
            <DesktopUpdate />
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[1440px] px-4 pb-8 sm:px-8 lg:px-10">
        <section className="pb-5 pt-6 sm:pb-6 sm:pt-8">
          <h1 className="text-[clamp(1.5rem,3vw,2rem)] font-semibold leading-tight text-ink">{title}</h1>
        </section>

        <main id="main">{children}</main>

        <footer className="mt-8 border-t border-line pt-4 text-xs text-ink-muted">
          模板 NeverSink · 行情 poe.ninja
        </footer>
      </div>
    </div>
  );
}

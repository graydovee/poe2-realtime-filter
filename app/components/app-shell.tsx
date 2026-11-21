import Image from "next/image";
import type { ReactNode } from "react";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-vignette min-h-screen">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex min-h-16 max-w-[1440px] items-center justify-between gap-4 px-4 sm:px-8 lg:px-10">
          <div className="flex items-center gap-3">
            <Image src="/brand/poe2-filter.png" alt="" width={36} height={36} className="shrink-0" unoptimized />
            <strong className="font-display text-[15px] font-semibold tracking-wide text-ink">poe2-filter</strong>
          </div>
          <span className="text-xs font-medium text-ink-muted">Path of Exile 2</span>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[1440px] px-4 pb-8 sm:px-8 lg:px-10">
        <section className="pb-5 pt-6 sm:pb-6 sm:pt-8">
          <h1 className="text-[clamp(1.5rem,3vw,2rem)] font-semibold leading-tight text-ink">PoE2 过滤器编辑器</h1>
        </section>

        <main id="main">{children}</main>

        <footer className="mt-8 border-t border-line pt-4 text-xs text-ink-muted">
          模板 NeverSink · 行情 poe.ninja
        </footer>
      </div>
    </div>
  );
}

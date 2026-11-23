import Image from "next/image";
import type { ReactNode } from "react";
import { DesktopUpdate } from "./desktop-update";

export function AppShell({
  title,
  eyebrow = "LOOT FILTER STUDIO",
  toolbar,
  children,
}: {
  title: string;
  eyebrow?: string;
  toolbar?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="app-vignette min-h-screen">
      <header className="app-topbar sticky top-0 z-30 border-b border-line/80 bg-bg/88 backdrop-blur-xl">
        <div className="mx-auto flex min-h-14 max-w-[1240px] items-center justify-between gap-4 px-4 py-2 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Image src="/brand/poe2-filter.png" alt="" width={34} height={34} className="shrink-0" unoptimized />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <strong className="truncate font-display text-[14px] font-semibold tracking-wide text-ink">PoE2 Filter</strong>
                <span className="hidden rounded-full border border-line px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em] text-ink-muted sm:inline-flex">Desktop</span>
              </div>
              <p className="truncate text-[11px] text-ink-muted">实时掉落过滤器工作台</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
            <span className="hidden font-mono text-[11px] text-ink-muted md:inline">{"v" + process.env.NEXT_PUBLIC_APP_VERSION}</span>
            <DesktopUpdate />
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[1240px] px-4 pb-8 sm:px-6">
        <section className="page-heading flex flex-wrap items-end justify-between gap-4 border-b border-line/70 py-5 sm:py-6">
          <div className="min-w-0">
            <p className="eyebrow font-mono text-[10px] font-medium uppercase tracking-[0.22em] text-gold/75">{eyebrow}</p>
            <h1 className="mt-1.5 truncate text-[clamp(1.55rem,3vw,2rem)] font-semibold leading-tight tracking-tight text-ink">{title}</h1>
          </div>
          {toolbar && <div className="flex shrink-0 items-center gap-2">{toolbar}</div>}
        </section>

        <main id="main" className="py-5 sm:py-7">{children}</main>

        <footer className="border-t border-line/70 pt-4 text-[11px] text-ink-muted">
          行情来源 · poe.ninja / poecurrency.top
        </footer>
      </div>
    </div>
  );
}

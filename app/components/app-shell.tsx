import type { ReactNode } from "react";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-vignette min-h-screen overflow-x-clip">
      <div className="mx-auto w-full max-w-[1440px] px-5 pb-8 sm:px-8 lg:px-10">
        <header className="hairline-top flex h-[82px] items-center justify-between border-b border-line/70">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="grid size-9 place-items-center rounded-lg bg-gold font-display text-lg text-[#0b0805] shadow-[0_0_26px_rgba(200,164,92,0.22)]"
            >
              ◈
            </span>
            <div className="flex flex-col gap-0.5">
              <strong className="font-display text-[15px] tracking-[0.05em] text-ink">poe2-filter</strong>
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-muted">Path of Exile 2</span>
            </div>
          </div>
          <div className="hidden items-center gap-3 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted sm:flex">
            <span>NeverSink</span>
            <span aria-hidden="true" className="size-0.5 rounded-full bg-line-strong" />
            <span>poe.ninja</span>
          </div>
        </header>

        <section className="pb-6 pt-8">
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-gold">Loot Filter Studio</p>
          <h1 className="mt-2 font-display text-[clamp(1.5rem,3vw,2rem)] leading-tight tracking-[0.01em] text-ink">
            PoE2 过滤器编辑器
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
            选择赛季与基础档位，设置白名单、价格光效和音效，然后下载过滤器或保存为云方案。
          </p>
        </section>

        <main id="main">{children}</main>

        <footer className="mt-8 flex flex-col items-start justify-between gap-2 border-t border-line/60 pt-5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted/70 sm:flex-row sm:items-center">
          <span>poe2-filter</span>
          <span>模板 NeverSink · 行情 poe.ninja</span>
        </footer>
      </div>
    </div>
  );
}

import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "../../../lib/cn";

/** 标题前的小菱形，是界面里唯一的装饰图形。 */
export function Ornament({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 8 8" aria-hidden="true" className={cn("size-2 shrink-0 text-gold/70", className)}>
      <path d="M4 0 8 4 4 8 0 4Z" fill="currentColor" />
    </svg>
  );
}

type PanelProps = Omit<ComponentPropsWithoutRef<"section">, "title"> & {
  title?: ReactNode;
  description?: ReactNode;
  /** 标题栏右侧的操作区。 */
  actions?: ReactNode;
  className?: string;
  bodyClassName?: string;
};

export function Panel({ title, description, actions, children, className, bodyClassName, ...rest }: PanelProps) {
  return (
    <section
      className={cn("min-w-0 rounded-lg border border-line bg-surface shadow-panel", className)}
      {...rest}
    >
      {(title || actions) && (
        <header className="flex min-h-11 items-center justify-between gap-3 border-b border-line px-4 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <Ornament />
            <div className="min-w-0">
              {title && <h2 className="truncate text-sm leading-snug font-semibold text-ink">{title}</h2>}
              {description && <p className="truncate text-xs text-ink-muted">{description}</p>}
            </div>
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
        </header>
      )}
      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

/** 可折叠面板：整条标题栏是开关。`summary` 显示在标题旁，收起时也能看到关键状态。 */
export function CollapsiblePanel({
  open,
  onOpenChange,
  title,
  summary,
  actions,
  children,
  className,
  bodyClassName,
  ...rest
}: Omit<ComponentPropsWithoutRef<"section">, "title"> & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  summary?: ReactNode;
  /** 标题栏右侧的非交互信息（不要放按钮）。 */
  actions?: ReactNode;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={cn("min-w-0 rounded-lg border bg-surface shadow-panel", open ? "border-line" : "border-line/80", className)}
      {...rest}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
        className="group flex min-h-11 w-full cursor-pointer items-center justify-between gap-3 rounded-lg px-4 py-2 text-left transition-colors duration-150 hover:bg-surface-2/60"
      >
        <span className="flex min-w-0 items-center gap-2">
          <Ornament />
          <span className="truncate text-sm leading-snug font-semibold text-ink">{title}</span>
          {summary && <span className="min-w-0 truncate text-sm text-ink-muted">{summary}</span>}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {actions}
          <ChevronDown
            aria-hidden="true"
            className="size-4 text-ink-muted transition-transform duration-200 ease-out group-hover:text-ink group-aria-expanded:rotate-180"
          />
        </span>
      </button>
      {open && <div className={cn("border-t border-line p-4", bodyClassName)}>{children}</div>}
    </section>
  );
}

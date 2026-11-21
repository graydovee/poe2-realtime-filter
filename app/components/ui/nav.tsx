"use client";

import type { ReactNode } from "react";
import * as CollapsiblePrimitive from "@radix-ui/react-collapsible";
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { ChevronDown } from "lucide-react";

import { cn } from "../../../lib/cn";

export function TabBar<T extends string>({
  value,
  onChange,
  items,
  trailing,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  items: Array<{ value: T; label: string }>;
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <div role="tablist" aria-label="视图切换" className={cn("flex min-w-0 flex-wrap items-center gap-1 rounded border border-line bg-surface p-1.5", className)}>
      {items.map((item) => {
        const active = value === item.value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.value)}
            className={cn(
              "min-h-10 rounded-sm px-3 text-sm transition-colors duration-150 sm:px-4",
              active ? "bg-gold/15 font-semibold text-gold-bright" : "text-ink-muted hover:bg-surface-3 hover:text-ink",
            )}
          >
            {item.label}
          </button>
        );
      })}
      {trailing && <div className="ml-auto hidden shrink-0 items-center gap-2 pl-4 pr-2 text-xs text-ink-muted sm:flex">{trailing}</div>}
    </div>
  );
}

export function Disclosure({
  summary,
  children,
  defaultOpen,
  className,
  contentClassName,
}: {
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <CollapsiblePrimitive.Root defaultOpen={defaultOpen} className={className}>
      <CollapsiblePrimitive.Trigger className="group flex w-full items-center justify-between gap-3 min-h-9 py-2 text-left text-[13px] font-medium text-ink transition hover:text-gold-bright">
        <span>{summary}</span>
        <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180" />
      </CollapsiblePrimitive.Trigger>
      <CollapsiblePrimitive.Content className={cn("overflow-hidden", contentClassName)}>{children}</CollapsiblePrimitive.Content>
    </CollapsiblePrimitive.Root>
  );
}

export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={250}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            sideOffset={6}
            className="z-50 max-w-[16rem] rounded-sm border border-line bg-surface-2 px-2.5 py-1.5 text-[11px] leading-relaxed text-ink shadow-panel"
          >
            {label}
            <TooltipPrimitive.Arrow className="fill-surface-2" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}

export function ScrollArea({
  children,
  className,
  viewportClassName,
}: {
  children: ReactNode;
  className?: string;
  viewportClassName?: string;
}) {
  return (
    <ScrollAreaPrimitive.Root className={cn("relative overflow-hidden", className)} type="auto">
      <ScrollAreaPrimitive.Viewport className={cn("size-full", viewportClassName)}>{children}</ScrollAreaPrimitive.Viewport>
      <ScrollAreaPrimitive.Scrollbar
        orientation="vertical"
        className="flex w-2 touch-none select-none p-0.5 transition-colors duration-150 hover:bg-surface-3"
      >
        <ScrollAreaPrimitive.Thumb className="relative flex-1 rounded-full bg-line-strong" />
      </ScrollAreaPrimitive.Scrollbar>
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}

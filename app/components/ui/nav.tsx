"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import * as CollapsiblePrimitive from "@radix-ui/react-collapsible";
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { ChevronDown } from "lucide-react";

import { cn } from "../../../lib/cn";

export function Disclosure({
  summary,
  children,
  defaultOpen,
  className,
  contentClassName,
  storageKey,
}: {
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  contentClassName?: string;
  storageKey?: string;
}) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  useEffect(() => {
    if (!storageKey) return;
    const saved = window.localStorage.getItem(storageKey);
    if (saved !== null) setOpen(saved === "1");
  }, [storageKey]);
  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (storageKey) window.localStorage.setItem(storageKey, next ? "1" : "0");
  }
  return (
    <CollapsiblePrimitive.Root open={open} onOpenChange={handleOpenChange} className={className}>
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

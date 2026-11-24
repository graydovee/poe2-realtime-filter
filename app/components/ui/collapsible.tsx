"use client";

import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from "react";
import * as CollapsiblePrimitive from "@radix-ui/react-collapsible";
import { ChevronDown } from "lucide-react";

import { cn } from "../../../lib/cn";

export const Collapsible = CollapsiblePrimitive.Root;

export const DisclosureTrigger = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<typeof CollapsiblePrimitive.Trigger>>(
  function DisclosureTrigger({ className, ...props }, ref) {
    return (
      <CollapsiblePrimitive.Trigger
        ref={ref}
        className={cn(
          "group flex w-full cursor-pointer items-center justify-between gap-3 rounded-sm py-2 text-left text-sm font-medium text-ink transition-colors duration-150 hover:text-gold-bright",
          className,
        )}
        {...props}
      />
    );
  },
);

export const DisclosureContent = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<typeof CollapsiblePrimitive.Content>>(
  function DisclosureContent({ className, ...props }, ref) {
    return (
      <CollapsiblePrimitive.Content
        ref={ref}
        className={cn("overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down", className)}
        {...props}
      />
    );
  },
);

/** 默认折叠的分区：标题栏带箭头。 */
export function Disclosure({
  summary,
  children,
  defaultOpen,
  open,
  onOpenChange,
  className,
  contentClassName,
}: {
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <CollapsiblePrimitive.Root open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange} className={className}>
      <DisclosureTrigger>
        <span className="min-w-0">{summary}</span>
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-ink-muted transition-transform duration-200 ease-out group-data-[state=open]:rotate-180" />
      </DisclosureTrigger>
      <DisclosureContent className={contentClassName}>{children}</DisclosureContent>
    </CollapsiblePrimitive.Root>
  );
}

"use client";

import type { ComponentPropsWithoutRef } from "react";
import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";

import { cn } from "../../../lib/cn";

export type SegmentedOption<T extends string> = { value: T; label: string; disabled?: boolean };

/** 单选分段控件，用于少量互斥选项（如服务器）。 */
export function SegmentedControl<T extends string>({
  value,
  onValueChange,
  options,
  ariaLabel,
  disabled,
  className,
}: {
  value: T;
  onValueChange: (value: T) => void;
  options: SegmentedOption<T>[];
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <ToggleGroupPrimitive.Root
      type="single"
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      onValueChange={(next) => {
        if (next) onValueChange(next as T);
      }}
      className={cn("inline-flex h-8 items-center rounded-md border border-line bg-surface-2 p-0.5", className)}
    >
      {options.map((option) => (
        <ToggleGroupPrimitive.Item
          key={option.value}
          value={option.value}
          disabled={option.disabled}
          className={cn(
            "inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-sm px-3 text-xs font-medium whitespace-nowrap text-ink-muted transition-colors duration-150 hover:text-ink data-[state=on]:cursor-default data-[state=on]:bg-surface-3 data-[state=on]:text-gold-bright data-[state=on]:shadow-panel disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          {option.label}
        </ToggleGroupPrimitive.Item>
      ))}
    </ToggleGroupPrimitive.Root>
  );
}

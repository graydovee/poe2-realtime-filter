"use client";

import { useId } from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";

import { cn } from "../../../lib/cn";

/** 开关 + 文字标签。禁用时轨道改为虚线描边，状态说明保持正常对比度。 */
export function Switch({
  checked,
  onCheckedChange,
  label,
  className,
  disabled,
  describedBy,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  className?: string;
  disabled?: boolean;
  describedBy?: string;
}) {
  const id = useId();
  return (
    <div className={cn("inline-flex min-h-8 items-center gap-2", className)}>
      <SwitchPrimitive.Root
        id={id}
        aria-describedby={describedBy}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
        className={cn(
          "inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-line-strong bg-surface-3 p-0.5 transition-colors duration-150",
          "data-[state=checked]:border-gold data-[state=checked]:bg-gold",
          "disabled:cursor-not-allowed disabled:border-dashed disabled:data-[state=checked]:border-gold disabled:data-[state=checked]:bg-surface-3",
        )}
      >
        <SwitchPrimitive.Thumb
          className={cn(
            "block size-3.5 rounded-full bg-ink-muted transition-transform duration-150 ease-out",
            "data-[state=checked]:translate-x-4 data-[state=checked]:bg-bg disabled:data-[state=checked]:bg-gold",
          )}
        />
      </SwitchPrimitive.Root>
      <label
        htmlFor={id}
        className={cn("cursor-pointer text-sm select-none", disabled ? "cursor-not-allowed text-ink-muted" : "text-ink")}
      >
        {label}
      </label>
    </div>
  );
}

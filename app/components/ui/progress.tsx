"use client";

import { cn } from "../../../lib/cn";

/** 进度条。知道比例时填满对应的宽度，否则显示一段来回移动的指示条。 */
export function ProgressBar({ value, label, className }: { value?: number; label: string; className?: string }) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value === undefined ? undefined : Math.round(value)}
      className={cn("overflow-hidden rounded-full bg-surface-3", className)}
    >
      <div
        className={cn("h-full rounded-full bg-gold", value === undefined && "w-1/3 animate-progress motion-reduce:animate-none")}
        style={value === undefined ? undefined : { width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

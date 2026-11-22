"use client";

import type { ComponentPropsWithoutRef } from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import * as SliderPrimitive from "@radix-ui/react-slider";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { Check, ChevronDown, Search } from "lucide-react";

import { cn } from "../../../lib/cn";

export type SelectOption = { value: string; label: string; disabled?: boolean };
export type SelectGroup = { label: string; options: SelectOption[] };

function SelectItem({ option }: { option: SelectOption }) {
  return (
    <SelectPrimitive.Item
      value={option.value}
      disabled={option.disabled}
      className="relative flex cursor-default select-none items-center gap-2 rounded-sm py-2 pl-2.5 pr-8 text-sm text-ink outline-none data-[disabled]:text-ink-muted data-[disabled]:line-through data-[highlighted]:bg-surface-3 data-[state=checked]:text-gold"
    >
      <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="absolute right-2 top-1/2 -translate-y-1/2">
        <Check aria-hidden="true" className="size-3.5" strokeWidth={2.5} />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}

export function Select({
  value,
  onValueChange,
  options,
  groups,
  ariaLabel,
  placeholder,
  disabled,
  className,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options?: SelectOption[];
  groups?: SelectGroup[];
  ariaLabel: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <SelectPrimitive.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectPrimitive.Trigger
        aria-label={ariaLabel}
        className={cn(
          "flex h-10 w-full items-center justify-between gap-2 rounded-sm border border-line-strong bg-surface-3 px-3 text-left text-sm text-ink transition enabled:hover:border-gold/60 disabled:border-dashed disabled:border-line disabled:text-ink-muted data-[placeholder]:text-ink-muted",
          className,
        )}
      >
        <span className="min-w-0 truncate">
          <SelectPrimitive.Value placeholder={placeholder} />
        </span>
        <SelectPrimitive.Icon asChild>
          <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={6}
          className="z-50 max-h-[min(22rem,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded border border-line bg-surface-2 shadow-panel"
        >
          <SelectPrimitive.Viewport className="p-1">
            {groups
              ? groups.map((group) => (
                  <SelectPrimitive.Group key={group.label}>
                    <SelectPrimitive.Label className="px-2 pb-1 pt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted">
                      {group.label}
                    </SelectPrimitive.Label>
                    {group.options.map((option) => (
                      <SelectItem key={option.value} option={option} />
                    ))}
                  </SelectPrimitive.Group>
                ))
              : (options ?? []).map((option) => <SelectItem key={option.value} option={option} />)}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

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
  return (
    <label
      className={cn(
        "inline-flex min-h-8 items-center gap-2.5 text-[13px] font-medium",
        disabled ? "cursor-not-allowed text-ink-muted" : "cursor-pointer text-ink",
        className,
      )}
    >
      <SwitchPrimitive.Root
        aria-describedby={describedBy}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
        className="ui-switch"
      >
        <SwitchPrimitive.Thumb className="ui-switch-thumb" />
      </SwitchPrimitive.Root>
      <span>{label}</span>
    </label>
  );
}

export function Slider({
  value,
  onValueChange,
  min,
  max,
  step = 1,
  label,
  display,
  ariaLabel,
  className,
}: {
  value: number;
  onValueChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  label: string;
  display?: string | number;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="text-xs font-medium text-ink-muted">{label}</span>
        <span className="font-mono text-sm text-gold">{display ?? value}</span>
      </div>
      <SliderPrimitive.Root
        className="relative flex h-5 w-full touch-none select-none items-center"
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={(next) => onValueChange(next[0])}
        aria-label={ariaLabel ?? label}
      >
        <SliderPrimitive.Track className="relative h-1 w-full grow rounded-full bg-line-strong">
          <SliderPrimitive.Range className="absolute h-full rounded-full bg-gold/70" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb className="block size-4 rounded-full border-2 border-bg bg-gold transition hover:bg-gold-bright" />
      </SliderPrimitive.Root>
    </div>
  );
}

export function TextInput({ className, ...rest }: ComponentPropsWithoutRef<"input">) {
  return (
    <input
      className={cn(
        "h-10 w-full min-w-0 rounded-sm border border-line-strong bg-surface-3 px-3 text-sm text-ink transition placeholder:text-ink-muted enabled:hover:border-gold/60 disabled:border-dashed disabled:border-line disabled:text-ink-muted",
        className,
      )}
      {...rest}
    />
  );
}

export function SearchInput({ className, ...rest }: ComponentPropsWithoutRef<"input">) {
  return (
    <div className={cn("relative", className)}>
      <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
      <TextInput type="search" className="pl-9 [&::-webkit-search-cancel-button]:hidden" {...rest} />
    </div>
  );
}

export function FileInput({
  label,
  fileName,
  accept,
  onFile,
  className,
}: {
  label: string;
  fileName?: string;
  accept?: string;
  onFile: (file: File | undefined) => void;
  className?: string;
}) {
  return (
    <label className={cn("flex cursor-pointer flex-wrap items-center gap-2 rounded-sm text-xs text-ink-muted transition hover:text-ink focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-gold", className)}>
      <span className="rounded-sm border border-line-strong bg-surface-3 px-2.5 py-1.5 text-ink">上传音效</span>
      <span className="max-w-[10rem] truncate font-mono text-[10px]">{fileName ?? "未选择文件"}</span>
      <input
        type="file"
        className="sr-only"
        accept={accept}
        aria-label={label}
        onChange={(event) => onFile(event.target.files?.[0])}
      />
    </label>
  );
}

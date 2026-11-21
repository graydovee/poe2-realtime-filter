"use client";

import type { ComponentPropsWithoutRef } from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
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
      className="relative flex cursor-default select-none items-center gap-2 rounded-sm py-2 pl-2.5 pr-8 text-sm text-ink outline-none data-[disabled]:opacity-40 data-[highlighted]:bg-surface-3 data-[state=checked]:text-gold"
    >
      <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="absolute right-2 grid place-items-center">
        <Check className="size-3.5" strokeWidth={2.5} />
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
          "flex h-10 w-full items-center justify-between gap-2 rounded-sm border border-line bg-surface-3 px-3 text-left text-sm text-ink transition hover:border-line-strong focus-visible:border-gold/60 focus-visible:outline-none disabled:opacity-45 data-[placeholder]:text-ink-muted",
          className,
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder} className="truncate" />
        <SelectPrimitive.Icon asChild>
          <ChevronDown className="size-4 shrink-0 text-ink-muted" />
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

export function Checkbox({
  checked,
  onCheckedChange,
  label,
  className,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  className?: string;
}) {
  return (
    <label className={cn("flex cursor-pointer items-center gap-2.5 text-xs text-ink-muted transition hover:text-ink", className)}>
      <CheckboxPrimitive.Root
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(value === true)}
        className="grid size-4 shrink-0 place-items-center rounded-sm border border-line-strong bg-surface-3 text-transparent transition focus-visible:outline-none data-[state=checked]:border-gold data-[state=checked]:bg-gold data-[state=checked]:text-[#0b0805]"
      >
        <CheckboxPrimitive.Indicator>
          <Check className="size-3" strokeWidth={3} />
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      <span>{label}</span>
    </label>
  );
}

export function Switch({
  checked,
  onCheckedChange,
  label,
  className,
  disabled,
  title,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  className?: string;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <label
      title={title}
      className={cn(
        "flex items-center gap-2.5 text-xs text-ink-muted transition hover:text-ink",
        disabled ? "cursor-not-allowed opacity-45 hover:text-ink-muted" : "cursor-pointer",
        className,
      )}
    >
      <SwitchPrimitive.Root
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
        className="relative h-5 w-9 shrink-0 rounded-full border border-line bg-surface-3 transition focus-visible:outline-none data-[state=checked]:border-gold data-[state=checked]:bg-gold disabled:cursor-not-allowed"
      >
        <SwitchPrimitive.Thumb className="block size-3.5 translate-x-[3px] rounded-full bg-ink-muted transition-transform duration-150 data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-[#0b0805]" />
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
        <SliderPrimitive.Track className="relative h-1 w-full grow rounded-full bg-surface-3">
          <SliderPrimitive.Range className="absolute h-full rounded-full bg-gold/70" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb className="block size-4 rounded-full border border-gold bg-bg shadow-[0_0_0_2px_rgba(200,164,92,0.16)] transition hover:bg-surface-3 focus-visible:outline-none" />
      </SliderPrimitive.Root>
    </div>
  );
}

export function TextInput({ className, ...rest }: ComponentPropsWithoutRef<"input">) {
  return (
    <input
      className={cn(
        "h-10 w-full min-w-0 rounded-sm border border-line bg-surface-3 px-3 text-sm text-ink transition placeholder:text-ink-muted/60 hover:border-line-strong focus-visible:border-gold/60 focus-visible:outline-none disabled:opacity-45",
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
    <label className={cn("flex cursor-pointer items-center gap-2 text-[11px] text-ink-muted transition hover:text-ink", className)}>
      <span className="rounded-sm border border-line bg-surface-3 px-2.5 py-1.5 text-ink">上传音效</span>
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

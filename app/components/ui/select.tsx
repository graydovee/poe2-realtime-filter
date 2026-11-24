"use client";

import { forwardRef, type ComponentPropsWithoutRef } from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";

import { cn } from "../../../lib/cn";
import { useFieldControl } from "./field";

export type SelectOption = { value: string; label: string; disabled?: boolean };
export type SelectGroup = { label: string; options: SelectOption[] };

const SelectItem = forwardRef<HTMLDivElement, { option: SelectOption }>(function SelectItem({ option }, ref) {
  return (
    <SelectPrimitive.Item
      ref={ref}
      value={option.value}
      disabled={option.disabled}
      className="relative flex h-8 cursor-default select-none items-center rounded-sm pl-8 pr-2 text-sm text-ink outline-none data-[disabled]:text-ink-faint data-[highlighted]:bg-surface-3 data-[state=checked]:font-medium data-[state=checked]:text-gold-bright"
    >
      <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="absolute left-2.5 flex size-4 items-center justify-center">
        <Check aria-hidden="true" className="size-3.5" strokeWidth={2.5} />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
});

export function Select({
  value,
  onValueChange,
  options,
  groups,
  ariaLabel,
  placeholder,
  disabled,
  className,
  id,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options?: SelectOption[];
  groups?: SelectGroup[];
  ariaLabel: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
}) {
  const control = useFieldControl(ariaLabel);
  return (
    <SelectPrimitive.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectPrimitive.Trigger
        id={id ?? control.id}
        aria-label={ariaLabel}
        aria-labelledby={control["aria-labelledby"]}
        aria-describedby={control["aria-describedby"]}
        className={cn(
          "flex h-8 w-full min-w-0 cursor-pointer items-center justify-between gap-2 rounded-md border border-line-strong bg-surface-2 px-2.5 text-left text-sm text-ink transition-colors duration-150 data-[placeholder]:text-ink-faint hover:border-line-strong focus:border-gold focus-visible:outline-offset-0 disabled:cursor-not-allowed disabled:border-dashed disabled:border-line disabled:text-ink-muted aria-[invalid=true]:border-ember",
          className,
        )}
      >
        <span className="min-w-0 flex-1 truncate">
          <SelectPrimitive.Value placeholder={placeholder} />
        </span>
        <SelectPrimitive.Icon asChild>
          <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          className="z-dropdown max-h-[min(20rem,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-line-strong/60 bg-surface-2 shadow-overlay"
        >
          <SelectPrimitive.Viewport className="p-1">
            {groups
              ? groups.map((group) => (
                  <SelectPrimitive.Group key={group.label}>
                    <SelectPrimitive.Label className="px-2 pb-1 pt-2 text-xs text-ink-faint">
                      {group.label}
                    </SelectPrimitive.Label>
                    <div className="space-y-px">
                      {group.options.map((option) => (
                        <SelectItem key={option.value} option={option} />
                      ))}
                    </div>
                  </SelectPrimitive.Group>
                ))
              : (options ?? []).map((option) => <SelectItem key={option.value} option={option} />)}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

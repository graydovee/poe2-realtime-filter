"use client";

import { forwardRef, type ComponentPropsWithRef } from "react";
import { Search } from "lucide-react";

import { cn } from "../../../lib/cn";
import { useFieldControl } from "./field";

const inputStyles =
  "h-8 w-full min-w-0 rounded-md border border-line-strong bg-surface-2 px-2.5 text-sm text-ink transition-colors duration-150 placeholder:text-ink-faint hover:border-line-strong focus:border-gold focus-visible:outline-offset-0 disabled:cursor-not-allowed disabled:border-dashed disabled:border-line disabled:text-ink-muted aria-[invalid=true]:border-ember";

export const Input = forwardRef<HTMLInputElement, ComponentPropsWithRef<"input">>(function Input(
  { className, type = "text", "aria-label": ariaLabel, ...props },
  ref,
) {
  const control = useFieldControl(ariaLabel);
  return <input ref={ref} type={type} className={cn(inputStyles, className)} aria-label={ariaLabel} {...control} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, ComponentPropsWithRef<"textarea">>(function Textarea(
  { className, rows = 4, "aria-label": ariaLabel, ...props },
  ref,
) {
  const control = useFieldControl(ariaLabel);
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(inputStyles, "h-auto min-h-20 resize-y py-2 leading-relaxed", className)}
      aria-label={ariaLabel}
      {...control}
      {...props}
    />
  );
});

export function SearchInput({ className, ...props }: ComponentPropsWithRef<"input">) {
  return (
    <div className={cn("relative", className)}>
      <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-faint" />
      <Input type="search" className="pl-8" {...props} />
    </div>
  );
}

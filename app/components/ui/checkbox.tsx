"use client";

import { forwardRef, type ComponentPropsWithRef } from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check, Minus } from "lucide-react";

import { cn } from "../../../lib/cn";

/** 复选框。`checked` 传 `"indeterminate"` 显示半选态。 */
export const Checkbox = forwardRef<HTMLButtonElement, ComponentPropsWithRef<typeof CheckboxPrimitive.Root>>(
  function Checkbox({ className, ...props }, ref) {
    return (
      <CheckboxPrimitive.Root
        ref={ref}
        className={cn(
          "grid size-4 shrink-0 cursor-pointer place-items-center rounded-sm border border-line-strong bg-surface-2 transition-colors duration-150",
          "data-[state=checked]:border-gold data-[state=checked]:bg-gold data-[state=checked]:text-on-gold",
          "data-[state=indeterminate]:border-gold data-[state=indeterminate]:text-gold-bright",
          "hover:border-gold/60 disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      >
        <CheckboxPrimitive.Indicator>
          {props.checked === "indeterminate" ? (
            <Minus aria-hidden="true" className="size-3" strokeWidth={3} />
          ) : (
            <Check aria-hidden="true" className="size-3" strokeWidth={3} />
          )}
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
    );
  },
);

"use client";

import { forwardRef, type ComponentPropsWithRef } from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../../../lib/cn";
import { Tooltip } from "./tooltip";

export const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out disabled:pointer-events-none disabled:opacity-50 enabled:active:scale-[0.98] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        primary:
          "bg-gold text-on-gold shadow-gold hover:bg-gold-bright enabled:active:bg-gold-press disabled:bg-surface-3 disabled:text-ink-faint disabled:shadow-none disabled:opacity-100",
        secondary:
          "border border-line-strong/70 bg-surface-2 text-ink hover:border-gold/50 hover:bg-surface-3 hover:text-gold-bright",
        ghost: "text-ink-muted hover:bg-surface-3 hover:text-ink",
        danger: "border border-ember/40 text-ember hover:border-ember/70 hover:bg-ember/10",
      },
      size: {
        sm: "h-7 px-2.5 text-xs",
        md: "h-8 px-3 text-sm",
        lg: "h-10 px-4 text-sm",
        icon: "size-8",
        "icon-sm": "size-7",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export type ButtonProps = ComponentPropsWithRef<"button"> & VariantProps<typeof buttonVariants>;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, type = "button", ...props },
  ref,
) {
  return <button ref={ref} type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
});

/** 只有图标的按钮：必须提供可读的 `label`，同时用作提示文字。 */
export const IconButton = forwardRef<HTMLButtonElement, ButtonProps & { label: string }>(function IconButton(
  { label, className, size = "icon", variant = "ghost", children, ...props },
  ref,
) {
  return (
    <Tooltip label={label}>
      <Button
        ref={ref}
        aria-label={label}
        size={size}
        variant={variant}
        className={cn("text-ink-muted", className)}
        {...props}
      >
        {children}
      </Button>
    </Tooltip>
  );
});

"use client";

import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";

import { cn } from "../../../lib/cn";
import { Button, type ButtonProps } from "./primitives";
import { Tooltip } from "./nav";

export function IconButton({ label, children, className, size = "icon", ...props }: ButtonProps & { label: string }) {
  return (
    <Tooltip label={label}>
      <Button aria-label={label} title={label} size={size} className={className} {...props}>
        {children}
      </Button>
    </Tooltip>
  );
}

export function TooltipButton({ label, children, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return (
    <Tooltip label={label}>
      <button type="button" aria-label={label} title={label} className={cn("inline-flex items-center justify-center", className)} {...props}>
        {children}
      </button>
    </Tooltip>
  );
}

export function MoreButton({ label = "更多操作", ...props }: Omit<ComponentProps<typeof IconButton>, "label" | "children"> & { label?: string }) {
  return <IconButton label={label} variant="ghost" {...props}><MoreHorizontal className="size-4" aria-hidden="true" /></IconButton>;
}

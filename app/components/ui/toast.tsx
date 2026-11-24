"use client";

import { Toaster as Sonner, toast as sonnerToast } from "sonner";

export const toast = sonnerToast;

export function Toaster() {
  return (
    <Sonner
      position="bottom-right"
      theme="dark"
      offset={20}
      gap={8}
      toastOptions={{
        classNames: {
          toast: "!rounded-lg !border-line-strong/60 !bg-surface-2 !text-ink !font-sans !text-sm !shadow-overlay",
          title: "!font-medium",
          description: "!text-ink-muted",
          actionButton: "!bg-gold !text-on-gold !rounded-md !text-xs",
          cancelButton: "!bg-surface-3 !text-ink-muted !rounded-md !text-xs",
          closeButton: "!bg-surface-2 !border-line-strong/60 !text-ink-muted",
          success: "[&_[data-icon]]:text-sage",
          error: "[&_[data-icon]]:text-ember",
          warning: "[&_[data-icon]]:text-gold-bright",
        },
      }}
    />
  );
}

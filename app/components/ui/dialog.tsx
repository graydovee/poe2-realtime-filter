"use client";

import { forwardRef, type ComponentPropsWithoutRef, type ComponentPropsWithRef, type ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "../../../lib/cn";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogTitle = DialogPrimitive.Title;
export const DialogDescription = DialogPrimitive.Description;

export const DialogContent = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { hideClose?: boolean }
>(function DialogContent({ className, children, hideClose, ...props }, ref) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="dialog-overlay" />
      <DialogPrimitive.Content ref={ref} className={cn("dialog-content", className)} {...props}>
        {children}
        {!hideClose && (
          <DialogPrimitive.Close
            aria-label="关闭"
            className="absolute right-3 top-3 grid size-7 cursor-pointer place-items-center rounded-md text-ink-muted transition-colors hover:bg-surface-3 hover:text-ink"
          >
            <X aria-hidden="true" className="size-4" />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});

export function DialogHeader({ title, description }: { title: ReactNode; description?: ReactNode }) {
  return (
    <div className="pr-8">
      <DialogPrimitive.Title className="text-base leading-snug font-semibold text-ink">{title}</DialogPrimitive.Title>
      <DialogPrimitive.Description
        className={cn("mt-1 text-sm leading-relaxed text-ink-muted", !description && "sr-only")}
      >
        {description ?? title}
      </DialogPrimitive.Description>
    </div>
  );
}

export function DialogFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4", className)}>
      {children}
    </div>
  );
}

/** 统一外观的对话框：标题 + 可选说明 + 内容 + 底部操作。`busy` 时禁止关闭。 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  busy,
  children,
  footer,
  size = "md",
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  busy?: boolean;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        onOpenChange(next);
      }}
    >
      <DialogContent
        aria-busy={busy || undefined}
        className={cn(
          size === "sm" && "max-w-sm",
          size === "lg" && "max-w-3xl",
          size === "xl" && "max-w-5xl",
          className,
        )}
      >
        <DialogHeader title={title} description={description} />
        {children}
        {footer && <DialogFooter>{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
  );
}

/** 从右侧滑出的面板，用于窗口较窄时展示检查器。 */
export const SheetContent = forwardRef<
  HTMLDivElement,
  ComponentPropsWithRef<typeof DialogPrimitive.Content> & { hideClose?: boolean }
>(function SheetContent({ className, children, hideClose, ...props }, ref) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="dialog-overlay" />
      <DialogPrimitive.Content ref={ref} className={cn("sheet-content", className)} {...props}>
        {children}
        {!hideClose && (
          <DialogPrimitive.Close
            aria-label="关闭"
            className="absolute right-3 top-3 grid size-7 cursor-pointer place-items-center rounded-md text-ink-muted transition-colors hover:bg-surface-3 hover:text-ink"
          >
            <X aria-hidden="true" className="size-4" />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});

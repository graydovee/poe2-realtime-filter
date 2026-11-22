"use client";

import { cn } from "../../../lib/cn";
import { useEffect, useId, useRef, type ReactNode } from "react";

export function ConfirmDialog({ title, busy, onCancel, children, className }: {
  title: string;
  className?: string;
  busy?: boolean;
  onCancel: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  return (
    <dialog ref={dialog} className={cn("modal-card m-auto max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] overflow-y-auto text-ink backdrop:bg-black/75", className)} aria-labelledby={titleId} onCancel={(event) => {
      event.preventDefault();
      if (!busy) onCancel();
    }}>
      <h3 id={titleId}>{title}</h3>
      {children}
    </dialog>
  );
}

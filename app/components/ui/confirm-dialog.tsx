"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

export function ConfirmDialog({ title, busy, onCancel, children }: {
  title: string;
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
    <dialog ref={dialog} className="modal-card m-auto max-w-[calc(100%-2rem)] text-ink backdrop:bg-black/75" aria-labelledby={titleId} onCancel={(event) => {
      event.preventDefault();
      if (!busy) onCancel();
    }}>
      <h3 id={titleId}>{title}</h3>
      {children}
    </dialog>
  );
}

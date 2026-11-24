import type { ReactNode } from "react";

import { cn } from "../../../lib/cn";

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "pointer-events-none inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-line-strong/60 bg-surface-2 px-1 font-sans text-xs font-medium text-ink-muted",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

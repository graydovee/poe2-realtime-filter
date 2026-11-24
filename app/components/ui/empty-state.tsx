import type { ReactNode } from "react";

import { cn } from "../../../lib/cn";
import { Ornament } from "./panel";

export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn("block animate-pulse rounded-sm bg-surface-3", className)} />;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  compact,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center px-6 text-center",
        compact ? "gap-1 py-8" : "gap-1.5 py-14",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "grid place-items-center rounded-md border border-line bg-surface-2 text-gold/80",
          compact ? "size-9" : "size-12",
        )}
      >
        {icon ?? <Ornament className="size-2.5" />}
      </span>
      <h3 className={cn("font-semibold text-ink", compact ? "text-sm" : "text-base")}>{title}</h3>
      {description && <p className="max-w-sm text-sm leading-relaxed text-ink-muted">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

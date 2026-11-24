import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { X } from "lucide-react";

import { cn } from "../../../lib/cn";

export type BadgeTone = "gold" | "sage" | "ember" | "muted";

const badgeTones: Record<BadgeTone, string> = {
  gold: "border-gold/35 bg-gold/10 text-gold-bright",
  sage: "border-sage/35 bg-sage/10 text-sage",
  ember: "border-ember/35 bg-ember/10 text-ember",
  muted: "border-line bg-surface-2 text-ink-muted",
};

export const Badge = forwardRef<HTMLSpanElement, ButtonHTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }>(
  function Badge({ tone = "muted", className, children, ...props }, ref) {
    return (
      <span
        ref={ref}
        className={cn(
          "inline-flex h-5 max-w-full shrink-0 items-center gap-1 rounded-sm border px-1.5 text-xs font-medium leading-none whitespace-nowrap",
          badgeTones[tone],
          className,
        )}
        {...props}
      >
        {children}
      </span>
    );
  },
);

const dotTones: Record<BadgeTone, string> = {
  gold: "bg-gold",
  sage: "bg-sage",
  ember: "bg-ember",
  muted: "bg-ink-faint",
};

export function StatusDot({ tone = "muted", className }: { tone?: BadgeTone; className?: string }) {
  return <span aria-hidden="true" className={cn("block size-1.5 shrink-0 rounded-full", dotTones[tone], className)} />;
}

/** 可移除的标签。文字保持单行并截断，移除按钮不随文字压缩。 */
export function Chip({
  children,
  onRemove,
  removeLabel,
  tone = "muted",
  className,
}: {
  children: ReactNode;
  onRemove?: () => void;
  removeLabel?: string;
  tone?: BadgeTone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-7 max-w-full items-center gap-1 rounded-sm border pr-1 pl-2 text-xs text-ink",
        badgeTones[tone],
        !onRemove && "pr-2",
        className,
      )}
    >
      <span className="min-w-0 truncate">{children}</span>
      {onRemove && (
        <button
          type="button"
          aria-label={removeLabel}
          onClick={onRemove}
          className="grid size-5 shrink-0 cursor-pointer place-items-center rounded-sm text-ink-faint transition-colors hover:bg-ember/15 hover:text-ember"
        >
          <X aria-hidden="true" className="size-3" strokeWidth={2.5} />
        </button>
      )}
    </span>
  );
}

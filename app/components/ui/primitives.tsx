import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../../../lib/cn";

type PanelProps = Omit<ComponentPropsWithoutRef<"section">, "title"> & {
  title?: string;
  description?: string;
  action?: ReactNode;
  children?: ReactNode;
};

export function Panel({ title, description, action, children, className, ...rest }: PanelProps) {
  const hasHeading = Boolean(title || description);
  return (
    <section
      className={cn("rounded border border-line bg-surface p-5 shadow-panel sm:p-6", className)}
      {...rest}
    >
      {hasHeading && (
        <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 gap-3">
            <div className="min-w-0">
              {title && <h2 className="text-base font-semibold leading-snug text-ink">{title}</h2>}
              {description && <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{description}</p>}
            </div>
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

const buttonStyles = cva(
  "inline-flex select-none items-center justify-center gap-2 rounded-sm font-semibold transition duration-150 ease-out disabled:pointer-events-none disabled:opacity-60",
  {
    variants: {
      variant: {
        primary: "bg-gold text-[#0b0805] shadow-[0_6px_20px_rgba(200,164,92,0.18)] hover:bg-gold-bright active:bg-gold-press",
        secondary: "border border-line-strong bg-surface-3 text-ink hover:border-gold hover:bg-surface-2",
        ghost: "text-ink-muted hover:bg-surface-3 hover:text-ink",
        danger: "border border-ember/45 bg-ember/5 text-ember hover:border-ember/80 hover:bg-ember/10",
      },
      size: {
        sm: "min-h-9 px-3 text-[13px]",
        md: "h-10 px-4 text-sm",
        lg: "h-12 px-5 text-sm",
        icon: "size-9 shrink-0 p-0",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export type ButtonProps = ComponentPropsWithoutRef<"button"> & VariantProps<typeof buttonStyles>;

export function Button({ className, variant, size, type = "button", ...rest }: ButtonProps) {
  return <button type={type} className={cn(buttonStyles({ variant, size }), className)} {...rest} />;
}

const badgeStyles = cva(
  "inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-medium text-xs leading-tight",
  {
    variants: {
      tone: {
        gold: "border-gold/40 text-gold",
        muted: "border-line text-ink-muted",
        sage: "border-sage/40 text-sage",
        ember: "border-ember/50 text-ember",
      },
    },
    defaultVariants: { tone: "muted" },
  },
);

export type BadgeProps = ComponentPropsWithoutRef<"span"> & VariantProps<typeof badgeStyles>;

export function Badge({ className, tone, ...rest }: BadgeProps) {
  return <span className={cn(badgeStyles({ tone }), className)} {...rest} />;
}

export function Chip({ children, onRemove, removeLabel }: { children: ReactNode; onRemove: () => void; removeLabel: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-sm border border-line bg-surface-3 py-1.5 pl-2.5 pr-1.5 text-xs text-ink">
      <span className="max-w-[16rem] truncate">{children}</span>
      <button
        type="button"
        aria-label={removeLabel}
        onClick={onRemove}
        className="grid size-5 place-items-center rounded-sm text-ink-muted transition hover:bg-ember/15 hover:text-ember"
      >
        <span aria-hidden="true" className="text-sm leading-none">×</span>
      </button>
    </span>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col", className)}>
      <span className="mb-2 block text-xs font-medium text-ink-muted">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs leading-relaxed text-ink-muted">{hint}</span>}
      {error && <span className="mt-1.5 block text-xs leading-relaxed text-ember">{error}</span>}
    </div>
  );
}

export function Divider({ className, label }: { className?: string; label?: string }) {
  return (
    <div className={cn("flex items-center gap-3", className)} aria-hidden="true">
      <span className="h-px flex-1 bg-gradient-to-r from-transparent via-line-strong to-transparent" />
      <span className="text-[9px] leading-none text-gold/70">{label ?? "◈"}</span>
      <span className="h-px flex-1 bg-gradient-to-r from-transparent via-line-strong to-transparent" />
    </div>
  );
}

const alertStyles = cva("rounded-sm border px-4 py-3 text-xs leading-relaxed", {
  variants: {
    tone: {
      ember: "border-ember/45 bg-ember/8 text-ember/95",
      gold: "border-gold/35 bg-gold/5 text-ink",
      muted: "border-line bg-surface-2 text-ink-muted",
    },
  },
  defaultVariants: { tone: "muted" },
});

export function Alert({
  tone,
  title,
  children,
  className,
  role = "alert",
}: { tone?: "ember" | "gold" | "muted"; title?: ReactNode; children?: ReactNode; className?: string; role?: "alert" | "status" }) {
  return (
    <div className={cn(alertStyles({ tone }), className)} role={role}>
      {title && <strong className="block text-[13px] font-semibold">{title}</strong>}
      {children && <div className={cn(title && "mt-1", "text-xs leading-relaxed")}>{children}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn("block animate-pulse rounded-sm bg-surface-3", className)} />;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-h-[16rem] flex-col items-center justify-center px-6 py-10 text-center", className)}>
      <div className="grid size-14 place-items-center rounded-lg border border-line-strong text-gold" aria-hidden="true">
        {icon ?? <span className="text-2xl leading-none">◈</span>}
      </div>
      <h2 className="mt-4 text-base font-semibold text-ink">{title}</h2>
      {description && <p className="mt-2 max-w-sm text-xs leading-relaxed text-ink-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("font-mono text-xs tracking-tight text-ink/90", className)}>{children}</span>;
}

export function StatusDot({ tone = "muted", className }: { tone?: "gold" | "sage" | "ember" | "muted"; className?: string }) {
  const color = { gold: "bg-gold", sage: "bg-sage", ember: "bg-ember", muted: "bg-ink-muted/60" }[tone];
  return <span aria-hidden="true" className={cn("block size-1.5 rounded-full", color, className)} />;
}

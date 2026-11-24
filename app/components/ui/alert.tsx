import type { ReactNode } from "react";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";

import { cn } from "../../../lib/cn";

const alertTones = {
  ember: { frame: "border-ember/35 bg-ember/8 text-ember", Icon: CircleAlert },
  gold: { frame: "border-gold/30 bg-gold/6 text-ink", Icon: TriangleAlert },
  sage: { frame: "border-sage/30 bg-sage/8 text-ink", Icon: CircleCheck },
  muted: { frame: "border-line bg-surface-2 text-ink-muted", Icon: Info },
} as const;

export function Alert({
  tone = "muted",
  title,
  children,
  className,
  role,
  action,
}: {
  tone?: keyof typeof alertTones;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
  role?: "alert" | "status";
  action?: ReactNode;
}) {
  const { Icon } = alertTones[tone];
  return (
    <div
      role={role ?? (tone === "ember" ? "alert" : undefined)}
      className={cn(
        "flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-sm leading-relaxed",
        alertTones[tone].frame,
        className,
      )}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className={cn("min-w-0 flex-1", !title && "text-ink-muted")}>
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn(title && "mt-0.5", "break-words")}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

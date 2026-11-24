"use client";

import { createContext, useContext, useId, type ReactNode } from "react";

import { cn } from "../../../lib/cn";

type FieldContextValue = { id: string; labelId: string; hintId?: string; errorId?: string };

const FieldContext = createContext<FieldContextValue | null>(null);

/** 表单字段：标签、说明和错误。内部控件通过 `useFieldControl` 自动关联标签与说明。 */
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
  const id = useId();
  const hasHint = Boolean(hint);
  const hasError = Boolean(error);
  const value: FieldContextValue = {
    id,
    labelId: `${id}-label`,
    hintId: hasHint ? `${id}-hint` : undefined,
    errorId: hasError ? `${id}-error` : undefined,
  };
  return (
    <FieldContext.Provider value={value}>
      <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
        <span id={value.labelId} className="text-xs font-medium text-ink-muted">
          {label}
        </span>
        {children}
        {hint && (
          <span id={value.hintId} className="text-xs leading-relaxed text-ink-faint">
            {hint}
          </span>
        )}
        {error && (
          <span id={value.errorId} role="alert" className="text-xs leading-relaxed text-ember">
            {error}
          </span>
        )}
      </div>
    </FieldContext.Provider>
  );
}

/** 返回所在字段的 id 与说明节点 id，供输入控件补全无障碍关联。 */
export function useFieldControl(ariaLabel?: string) {
  const field = useContext(FieldContext);
  const describedBy = [field?.hintId, field?.errorId].filter(Boolean).join(" ") || undefined;
  return {
    id: field?.id,
    "aria-labelledby": ariaLabel || !field ? undefined : field.labelId,
    "aria-describedby": describedBy,
  };
}

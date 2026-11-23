"use client";

import type { ComponentType, ReactNode } from "react";
import { Check, CircleAlert, CircleDot } from "lucide-react";

import { cn } from "../../lib/cn";
import { StatusBadge } from "./ui/primitives";

export type EditorStep = {
  id: string;
  label: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  status?: "ready" | "warning" | "active";
  meta?: ReactNode;
};

export function EditorNavigation({ steps, active, onChange }: { steps: EditorStep[]; active: string; onChange: (id: string) => void }) {
  return (
    <nav className="editor-stepper" aria-label="编辑步骤">
      <div className="editor-stepper-head">
        <div>
          <p className="eyebrow">BUILD FLOW</p>
          <p className="editor-stepper-title">按顺序完成过滤器</p>
        </div>
        <StatusBadge tone="muted">{steps.length} 个步骤</StatusBadge>
      </div>
      <div className="editor-stepper-grid">
        {steps.map((step, index) => {
          const Icon = step.icon;
          const selected = active === step.id;
          return (
            <button
              key={step.id}
              type="button"
              aria-current={selected ? "step" : undefined}
              onClick={() => onChange(step.id)}
              className={cn("editor-step", selected && "is-active")}
            >
              <span className="editor-step-index">{String(index + 1).padStart(2, "0")}</span>
              <span className="editor-step-icon"><Icon className="size-4" aria-hidden="true" /></span>
              <span className="editor-step-copy">
                <span className="editor-step-label">{step.label}</span>
                <span className="editor-step-description">{step.description}</span>
              </span>
              <span className="editor-step-status">
                {step.status === "warning" ? <CircleAlert className="size-4 text-ember" aria-label="有待处理问题" /> : step.status === "ready" ? <Check className="size-4 text-sage" aria-label="已完成" /> : selected ? <CircleDot className="size-4 text-gold" aria-hidden="true" /> : null}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export function EditorActionBar({ children }: { children: ReactNode }) {
  return <div className="sticky bottom-3 z-20 mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line-strong/70 bg-surface/95 p-2.5 shadow-[0_12px_36px_rgba(0,0,0,.28)] backdrop-blur-xl">{children}</div>;
}


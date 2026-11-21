"use client";

import { LOCALE_LABELS, STRICTNESS_LABELS, STYLE_LABELS } from "../../../lib/data";
import type { FilterProfile, FilterStyle, Locale, Strictness } from "../../../lib/types";
import { cn } from "../../../lib/cn";
import { Select } from "../ui/controls";
import { Field, Panel } from "../ui/primitives";

const STRICTNESS_LEVELS = Object.keys(STRICTNESS_LABELS).map(Number) as Strictness[];

function strictnessHint(level: Strictness) {
  if (level < 2) return "显示更多物品";
  if (level > 4) return "专注高价值";
  return "推荐起点";
}

export function BasicFilterSection({
  profile,
  onStrictnessChange,
  onStyleChange,
  onLocaleChange,
}: {
  profile: FilterProfile;
  onStrictnessChange: (level: Strictness) => void;
  onStyleChange: (style: FilterStyle) => void;
  onLocaleChange: (locale: Locale) => void;
}) {
  return (
    <Panel title="基础过滤器" description="选择 NeverSink 档位和视觉风格。严格度越高，显示的物品越少。">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7" role="group" aria-label="NeverSink 严格度">
        {STRICTNESS_LEVELS.map((level) => {
          const selected = profile.strictness === level;
          return (
            <button
              key={level}
              type="button"
              aria-pressed={selected}
              onClick={() => onStrictnessChange(level)}
              className={cn(
                "group relative flex min-h-[4.75rem] flex-col justify-between gap-2 overflow-hidden rounded-sm border px-3 py-2.5 text-left transition duration-150 ease-out hover:-translate-y-0.5 focus-visible:outline-none",
                selected ? "border-gold/70 bg-gold/[0.08] shadow-[0_0_0_1px_rgba(200,164,92,0.22)]" : "border-line bg-surface-2/60 hover:border-line-strong",
              )}
            >
              <span className={cn("font-mono text-base leading-none", selected ? "text-gold" : "text-ink-muted group-hover:text-ink")}>
                {level}
              </span>
              <span className="block">
                <b className="block text-xs font-semibold leading-tight text-ink">{STRICTNESS_LABELS[level]}</b>
                <small className="mt-1 block text-xs leading-tight text-ink-muted">{strictnessHint(level)}</small>
              </span>
              {selected && <span aria-hidden="true" className="absolute inset-y-0 left-0 w-0.5 bg-gold" />}
            </button>
          );
        })}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="视觉风格">
          <Select
            value={profile.style}
            onValueChange={(value) => onStyleChange(value as FilterStyle)}
            options={Object.entries(STYLE_LABELS).map(([value, label]) => ({ value, label }))}
            ariaLabel="选择视觉风格"
          />
        </Field>
        <Field label="客户端语言">
          <Select
            value={profile.locale}
            onValueChange={(value) => onLocaleChange(value as Locale)}
            options={Object.entries(LOCALE_LABELS).map(([value, label]) => ({ value, label }))}
            ariaLabel="选择客户端语言"
          />
        </Field>
      </div>
    </Panel>
  );
}

"use client";

import { useState } from "react";

import { describeEffects, pickEffects } from "../../../lib/effect-labels";
import type { EffectPreset } from "../../../lib/types";
import { cn } from "../../../lib/cn";
import { SearchInput } from "../ui/input";
import { effectSourceLabel, LootScene } from "./appearance-preview";

function PresetCard({ preset, active, onSelect }: { preset: EffectPreset; active: boolean; onSelect: () => void }) {
  const effects = pickEffects(preset);
  const sources = preset.sourceItemIds ?? [];
  const source = sources.length === 1 ? effectSourceLabel(sources[0]) : sources.length > 1 ? `选择来源物品 · ${sources.length} 项` : "固定特效";
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={cn(
        "flex min-w-0 cursor-pointer flex-col gap-1.5 rounded-md border p-1.5 text-left transition-colors duration-150",
        active ? "border-gold/70 bg-gold/8" : "border-line bg-surface hover:border-line-strong hover:bg-surface-2",
      )}
    >
      <LootScene effects={effects} label="示例" compact />
      <span className="line-clamp-2 min-h-8 px-0.5 text-xs leading-snug text-ink-muted">{describeEffects(effects)}</span>
      <span className="max-w-full truncate px-0.5 text-xs text-ink-faint" title={source}>{source}</span>
    </button>
  );
}

/** 特效预设画廊：可以按特效或来源物品筛选。 */
export function PresetGallery({
  presets,
  selectedId,
  onSelect,
}: {
  presets: EffectPreset[];
  selectedId?: string;
  onSelect: (preset: EffectPreset) => void;
}) {
  const [query, setQuery] = useState("");
  const search = query.trim().toLocaleLowerCase();
  const filtered = search
    ? presets.filter((preset) => describeEffects(pickEffects(preset)).toLocaleLowerCase().includes(search) ||
        preset.sourceItemIds?.some((id) => effectSourceLabel(id).toLocaleLowerCase().includes(search)))
    : presets;

  return (
    <div className="flex flex-col gap-2">
      <SearchInput
        value={query}
        aria-label="筛选特效预设"
        placeholder="筛选预设，例如 星形 / 40号 / 崇高石"
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="grid max-h-[22rem] grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-2 overflow-y-auto overscroll-contain pr-1">
        {filtered.map((preset) => (
          <PresetCard key={preset.id} preset={preset} active={preset.id === selectedId} onSelect={() => onSelect(preset)} />
        ))}
        {!filtered.length && (
          <p className="col-span-full py-8 text-center text-sm text-ink-muted">
            {presets.length ? "试试其他特效关键词。" : "当前基础过滤器没有可用预设。"}
          </p>
        )}
      </div>
      <p className="text-xs leading-relaxed text-ink-muted">
        带来源的预设会随基础过滤器更新，固定特效可以在「高级外观设置」里调整。
      </p>
    </div>
  );
}

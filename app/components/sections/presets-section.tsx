"use client";

import { Plus } from "lucide-react";

import { applyTemplateAppearances } from "../../../lib/neversink-appearance";
import { currencyDefaultRanges, currencyPriceTiers, formatPrice } from "../../../lib/pricing";
import type { FilterProfile, MarketSnapshot, VisualPreset } from "../../../lib/types";
import { PresetEditor } from "../preset-editor";
import { Button, Panel } from "../ui/primitives";

export function PresetsSection({
  profile,
  market,
  customSounds,
  onPresetChange,
  onRemovePreset,
  onAddPreset,
  onSound,
}: {
  profile: FilterProfile;
  market: MarketSnapshot;
  customSounds: Record<string, File>;
  onPresetChange: (id: string, patch: Partial<VisualPreset>) => void;
  onRemovePreset: (id: string) => void;
  onAddPreset: () => void;
  onSound: (id: string, file: File | undefined) => void;
}) {
  const tiers = currencyPriceTiers(market);
  const presets = currencyDefaultRanges(applyTemplateAppearances(profile.visualPresets, profile), market);

  return (
    <Panel
      step="03"
      title="价格光效规则"
      description="默认使用崇高石、混沌石、剥离石、神圣石的原始光效，先统一换算成 E，再从低到高排序划分区间。可改为固定 D / C / E 价格；重叠范围按列表顺序匹配。"
    >
      <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {tiers.map((tier) => (
          <div key={tier.itemId} className="flex flex-col gap-1.5 rounded-sm border border-line bg-surface-2 px-3 py-2.5">
            <span className="truncate text-[11px] text-ink-muted">{tier.name}</span>
            <strong className="font-mono text-[13px] font-medium text-gold">{formatPrice({ amount: tier.exaltedValue, currency: "exalted" })}</strong>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-3">
        {presets.map((preset) => (
          <PresetEditor
            key={preset.id}
            preset={preset}
            template={profile}
            market={market}
            customFile={customSounds[preset.id]}
            onChange={(patch) => onPresetChange(preset.id, patch)}
            onRemove={() => onRemovePreset(preset.id)}
            onSound={(file) => onSound(preset.id, file)}
          />
        ))}
      </div>

      <Button variant="secondary" className="mt-4 w-full border-dashed" onClick={onAddPreset}>
        <Plus aria-hidden="true" className="size-4" />
        新增光效预设
      </Button>
    </Panel>
  );
}

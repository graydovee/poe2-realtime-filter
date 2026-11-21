"use client";

import type { FilterProfile, Locale } from "../../../lib/types";
import { ItemPicker, type ItemPickerToggle } from "../item-picker";
import { Panel } from "../ui/primitives";

export function ExcludedItemsSection({
  profile,
  onToggleItems,
  onClear,
}: {
  profile: FilterProfile;
  onToggleItems: (toggle: ItemPickerToggle) => void;
  onClear: () => void;
}) {
  return (
    <Panel
      step="02"
      title="以下物品跳过自定义规则"
      description="名单里的物品不参与任何规则，一律保持基础过滤器的效果 —— 不会被强制加音效、图标或光柱，也不会被规则隐藏。"
    >
      <div className="mb-4 rounded-sm border border-line bg-surface-2/50 px-4 py-3 text-[11px] leading-relaxed text-ink-muted">
        常用于「不想被规则覆盖」的基础通货、任务物品或自己盯着用的材料。已选 <b className="font-mono font-normal text-ink">{profile.skippedItemIds.length}</b> 项。
        {profile.skippedItemIds.length > 0 && (
          <button type="button" onClick={onClear} className="ml-3 text-gold underline decoration-gold/40 underline-offset-4 transition hover:text-gold-bright">
            清空名单
          </button>
        )}
      </div>

      <ItemPicker
        locale={profile.locale as Locale}
        entries={profile.skippedItemIds.length ? [{ id: "skipped-items", label: "跳过名单", itemIds: profile.skippedItemIds }] : []}
        onToggle={onToggleItems}
        onRemoveEntry={onClear}
      />
    </Panel>
  );
}


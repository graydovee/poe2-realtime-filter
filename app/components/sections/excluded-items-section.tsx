"use client";

import type { FilterProfile } from "../../../lib/types";
import { ItemPicker, type ItemPickerToggle } from "../item-picker";
import { Button, Panel } from "../ui/primitives";
import { Disclosure } from "../ui/nav";

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
    <Panel className="p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-ink">跳过物品</h2>
          <p className="mt-1 text-xs text-ink-muted">名单中的物品沿用基础过滤器的规则和特效。</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-line bg-surface-2 px-2.5 py-1 font-mono text-[11px] text-ink-muted">{profile.skippedItemIds.length} 项</span>
          {profile.skippedItemIds.length > 0 && <Button size="sm" variant="ghost" onClick={onClear}>清空名单</Button>}
        </div>
      </div>
      <div className="mt-4 rounded-lg border border-line bg-surface-2/45 px-3.5 py-3 text-xs leading-relaxed text-ink-muted">
        常用于不想被自定义规则覆盖的基础通货、任务物品或材料。
      </div>
      <Disclosure summary="编辑跳过名单" className="mt-3 rounded-lg border border-line bg-surface-2/35 px-3" contentClassName="pb-3" defaultOpen={profile.skippedItemIds.length > 0} storageKey="ui.excluded-items.editor">
        <ItemPicker
          locale="cn"
          entries={profile.skippedItemIds.length ? [{ id: "skipped-items", label: "跳过名单", itemIds: profile.skippedItemIds }] : []}
          onToggle={onToggleItems}
          onRemoveEntry={onClear}
        />
      </Disclosure>
    </Panel>
  );
}


"use client";

import type { Currency, FilterProfile, Locale } from "../../../lib/types";
import { Select, Switch, TextInput } from "../ui/controls";
import { Field, Panel } from "../ui/primitives";
import { ItemPicker } from "../item-picker";

const currencyLabels: Record<Currency, string> = { divine: "D · 神圣石", chaos: "C · 混沌石", exalted: "E · 崇高石" };

export function WhitelistSection({
  profile,
  onHideEnabled,
  onHideAmount,
  onHideCurrency,
  onToggleItem,
}: {
  profile: FilterProfile;
  onHideEnabled: (enabled: boolean) => void;
  onHideAmount: (amount: number) => void;
  onHideCurrency: (currency: Currency) => void;
  onToggleItem: (id: string, checked: boolean) => void;
}) {
  return (
    <Panel step="02" title="白名单与低价值隐藏" description="按物品种类选择白名单，并设置可选的价格隐藏阈值。">
      <div className="mb-6 rounded-sm border border-line bg-surface-2 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-ink">可选低价值隐藏</h3>
          <Switch checked={profile.hideBelowEnabled} onCheckedChange={onHideEnabled} label="启用低价值隐藏" />
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="隐藏价格阈值">
            <TextInput
              type="number"
              min={0}
              step={0.01}
              value={profile.hideBelowAmount}
              disabled={!profile.hideBelowEnabled}
              aria-label="隐藏价格阈值"
              onChange={(event) => onHideAmount(Number(event.target.value))}
            />
          </Field>
          <Field label="计价单位">
            <Select
              value={profile.hideBelowCurrency}
              onValueChange={(value) => onHideCurrency(value as Currency)}
              options={Object.entries(currencyLabels).map(([value, label]) => ({ value, label }))}
              disabled={!profile.hideBelowEnabled}
              ariaLabel="选择隐藏价格计价单位"
            />
          </Field>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-ink-muted">
          启用后隐藏低于阈值的已定价物品；白名单优先，未定价物品沿用所选 NeverSink 规则。
        </p>
      </div>

      <ItemPicker
        locale={profile.locale as Locale}
        selectedIds={profile.whitelist.flatMap((entry) => entry.itemIds)}
        onToggle={onToggleItem}
      />
    </Panel>
  );
}

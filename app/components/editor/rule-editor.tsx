"use client";

import { useId } from "react";
import { PackageSearch, Trash2 } from "lucide-react";

import { itemLabel } from "../../../lib/catalog";
import { FILTER_ITEMS_BY_ID } from "../../../lib/data";
import { PRICE_UNITS, formatPrice, toExalted } from "../../../lib/pricing";
import type { BaseFilter, EffectPreset, FilterRule, MarketSnapshot, PriceCurrency, PricePoint } from "../../../lib/types";
import { useAppStore } from "../../state/store";
import { DropConditionsEditor } from "../drop-conditions-editor";
import { Chip } from "../ui/badge";
import { Button, IconButton } from "../ui/button";
import { Input } from "../ui/input";
import { Select } from "../ui/select";
import { Switch } from "../ui/switch";
import { EffectSection } from "./effect-section";

/** 物品条件里最多直接展示多少个已选物品，其余折叠成数量。 */
const CHIPS_LIMIT = 8;

function ItemChips({ ids, onRemove }: { ids: string[]; onRemove: (id: string) => void }) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5" aria-label="已选物品">
      {ids.slice(0, CHIPS_LIMIT).map((id) => {
        const item = FILTER_ITEMS_BY_ID.get(id);
        const label = item ? itemLabel(item, "cn") : id;
        return (
          <Chip key={id} tone="gold" className="max-w-56" onRemove={() => onRemove(id)} removeLabel={`移除 ${label}`}>
            {label}
          </Chip>
        );
      })}
      {ids.length > CHIPS_LIMIT && <Chip>另有 {ids.length - CHIPS_LIMIT} 项</Chip>}
    </div>
  );
}

/** 价格区间的一个端点：数值 + 计价单位。剥离石没有固定汇率，按它的行情报价折算。 */
function PriceBoundEditor({ label, point, market, onChange }: {
  label: string;
  point?: PricePoint;
  market: MarketSnapshot;
  onChange: (point?: PricePoint) => void;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5 rounded-md border border-line bg-surface px-2.5 py-2">
      <span className="text-xs text-ink-muted">{label}</span>
      <div className="grid grid-cols-[minmax(3.5rem,1fr)_minmax(0,1.4fr)] gap-1.5">
        <Input
          type="number"
          min={0}
          step={0.01}
          placeholder="不限"
          aria-label={`${label}数值`}
          value={point?.amount ?? ""}
          onChange={(event) =>
            onChange(event.target.value === "" ? undefined : { amount: Number(event.target.value), currency: point?.currency ?? "divine" })
          }
        />
        <Select
          value={point?.currency ?? "divine"}
          onValueChange={(currency) => onChange({ amount: point?.amount ?? 0, currency: currency as PriceCurrency })}
          ariaLabel={`${label}单位`}
          options={PRICE_UNITS.map(({ value, label: name }) => ({ value, label: name }))}
        />
      </div>
      {point?.currency === "annulment" && point.amount !== 0 && (
        <span className="truncate font-mono text-xs text-ink-faint" title="按当前行情折算">
          {formatPrice(point, market)}
        </span>
      )}
    </div>
  );
}

/** 选中规则的编辑器：匹配条件（物品 / 价格 / 掉落）与显示特效。实时光柱预览在右侧检查器里。 */
export function RuleEditor({
  rule,
  index,
  base,
  presets,
  market,
  onChange,
  onRemove,
}: {
  rule: FilterRule;
  index: number;
  base?: BaseFilter;
  presets: EffectPreset[];
  market: MarketSnapshot;
  onChange: (patch: Partial<FilterRule>) => void;
  onRemove: () => void;
}) {
  const openPicker = useAppStore((state) => state.openPicker);
  const conditionId = useId();

  const hasItems = rule.target.itemIds.length > 0;
  const hasPrice = Boolean(rule.target.range);
  const itemConditionOn = rule.target.itemEnabled !== false && hasItems;
  const priceConditionOn = rule.target.priceEnabled !== false && hasPrice;
  // 物品条件和价格条件至少要保留一个启用。
  const itemConditionLocked = itemConditionOn && !priceConditionOn;
  const priceConditionLocked = priceConditionOn && !itemConditionOn;
  // 换算成崇高石比较，两个端点单位不同（比如 1 C 对 1 枚剥离石）时也能看出区间是否反了。
  const inExalted = (point: PricePoint | undefined) => (point ? toExalted(point, market.rates, market.prices) : undefined);
  const lower = inExalted(rule.target.range?.min);
  const upper = inExalted(rule.target.range?.max);
  const inverted = priceConditionOn && lower !== undefined && upper !== undefined && lower >= upper;

  function editTarget(patch: Partial<FilterRule["target"]>) {
    onChange({ target: { ...rule.target, ...patch } });
  }

  return (
    <div className="@container min-w-0">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-1 py-2">
        <span
          aria-hidden="true"
          className="grid size-7 shrink-0 place-items-center rounded-sm border border-gold/35 bg-gold/10 font-mono text-xs text-gold-bright"
        >
          {index + 1}
        </span>
        <Input
          aria-label={`规则 ${index + 1} 名称`}
          value={rule.name}
          onChange={(event) => onChange({ name: event.target.value })}
          className="h-8 min-w-0 flex-1 basis-40 border-transparent bg-transparent px-2 font-semibold hover:border-line-strong focus:border-gold focus:bg-surface"
        />
        <Switch checked={rule.enabled} onCheckedChange={(enabled) => onChange({ enabled })} label="启用" />
        <Switch checked={rule.hidden} onCheckedChange={(hidden) => onChange({ hidden })} label="隐藏物品" />
        <IconButton label={`删除规则 ${rule.name}`} variant="danger" size="icon-sm" onClick={onRemove}>
          <Trash2 aria-hidden="true" className="size-3.5" />
        </IconButton>
      </header>

      {rule.hidden && (
        <p className="border-b border-line bg-ember/6 px-1 py-2 text-xs leading-relaxed text-ember">
          这条规则会隐藏命中的物品；隐藏物品在游戏内按住 Alt 仍可见，所以下面的特效照样会生效。
        </p>
      )}

      <section aria-labelledby={conditionId + "-title"} className="space-y-3 p-1 pt-4">
        <h3 id={conditionId + "-title"} className="text-xs font-semibold tracking-wide text-ink-muted">
          匹配条件
        </h3>
        <div className="grid gap-3 @3xl:grid-cols-2">
          <div className="min-w-0 rounded-md border border-line bg-surface-2/70 p-3">
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-sm font-semibold text-ink">物品条件</h4>
              <Switch
                checked={itemConditionOn}
                disabled={!hasItems || itemConditionLocked}
                onCheckedChange={(next) => editTarget({ itemEnabled: next })}
                label="启用"
                describedBy={conditionId + "-items"}
              />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button size="sm" variant={hasItems ? "secondary" : "primary"} onClick={() => openPicker("rule")}>
                <PackageSearch aria-hidden="true" />
                {hasItems ? `已选 ${rule.target.itemIds.length} 项 · 修改` : "选择物品"}
              </Button>
              {hasItems && (
                <Button size="sm" variant="ghost" onClick={() => editTarget({ itemIds: [] })}>
                  清空
                </Button>
              )}
            </div>
            {hasItems && (
              <ItemChips
                ids={rule.target.itemIds}
                onRemove={(id) => editTarget({ itemIds: rule.target.itemIds.filter((entry) => entry !== id) })}
              />
            )}
            <p id={conditionId + "-items"} className="mt-2 text-xs leading-relaxed text-ink-muted">
              {!hasItems
                ? "先选择物品，再启用此条件。"
                : itemConditionLocked
                  ? "当前唯一启用的条件。启用价格条件后可关闭。"
                  : itemConditionOn
                    ? "只匹配所选物品与价格区间的交集。"
                    : "已关闭。所选物品已保留。"}
            </p>
          </div>

          <div className="min-w-0 rounded-md border border-line bg-surface-2/70 p-3">
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-sm font-semibold text-ink">价格条件</h4>
              <Switch
                checked={priceConditionOn}
                disabled={!hasPrice || priceConditionLocked}
                onCheckedChange={(next) => editTarget({ priceEnabled: next })}
                label="启用"
                describedBy={conditionId + "-price"}
              />
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <PriceBoundEditor
                label="下限（含）"
                point={rule.target.range?.min}
                market={market}
                onChange={(point) => editTarget({ range: { ...rule.target.range, min: point } })}
              />
              <PriceBoundEditor
                label="上限（不含）"
                point={rule.target.range?.max}
                market={market}
                onChange={(point) => editTarget({ range: { ...rule.target.range, max: point } })}
              />
            </div>
            <p id={conditionId + "-price"} className={`mt-2 text-xs leading-relaxed ${inverted ? "text-ember" : "text-ink-muted"}`} role={inverted ? "status" : undefined}>
              {inverted
                ? "下限不低于上限，这条规则不会命中任何物品。请调整数值或单位。"
                : !hasPrice
                  ? "先填写价格区间，再启用此条件。"
                  : priceConditionLocked
                    ? "当前唯一启用的条件。启用物品条件后可关闭。"
                    : !priceConditionOn
                      ? "已关闭。填写的价格区间已保留。"
                      : "留空上限表示不封顶。"}
            </p>
          </div>
        </div>

        <div className="rounded-md border border-line bg-surface-2/70">
          <DropConditionsEditor rule={rule} onChange={editTarget} />
        </div>
      </section>

      <section aria-label="显示与特效" className="border-t border-line p-1 pt-4">
        <h3 className="mb-3 text-xs font-semibold tracking-wide text-ink-muted">显示与特效</h3>
        <EffectSection rule={rule} presets={presets} base={base} />
      </section>
    </div>
  );
}

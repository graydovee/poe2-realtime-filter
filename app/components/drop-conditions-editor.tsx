"use client";

import { FILTER_ITEMS_BY_ID } from "../../lib/data";
import { DROP_FIELDS, DROP_KEYS, DROP_OPERATORS, RARITIES, RARITY_LABELS, dropConditionsIssue, supportsDropField } from "../../lib/drop-conditions";
import type { DropConditions, DropField, DropNumber, DropOperator, FilterRule, ItemRarity } from "../../lib/types";
import { Button } from "./ui/primitives";
import { Select, Switch, TextInput } from "./ui/controls";
import { Disclosure } from "./ui/nav";

export function DropConditionsEditor({ rule, onChange }: { rule: FilterRule; onChange: (patch: Partial<FilterRule["target"]>) => void }) {
  const drop = rule.target.dropConditions ?? {};
  const issue = dropConditionsIssue(rule);
  const invalidStackIds = drop.stackSize?.enabled ? rule.target.itemIds.filter((id) => !FILTER_ITEMS_BY_ID.get(id)?.stackable) : [];

  function update(patch: DropConditions) {
    onChange({ dropConditions: { ...drop, ...patch } });
  }

  function numberControl(field: DropField) {
    const label = DROP_FIELDS[field].label;
    const setting = drop[field];
    const enabled = setting?.enabled ?? false;
    const bounds = setting?.bounds.length ? setting.bounds : [{ op: ">=" as const, value: 1 }];
    const setNumber = (next: DropNumber) => update({ [field]: next });
    const allSupported = rule.target.itemIds.length > 0 && rule.target.itemIds.every((id) => {
      const item = FILTER_ITEMS_BY_ID.get(id);
      return item && supportsDropField(item, field);
    });
    return (
      <div key={field} className="flex min-w-0 flex-col gap-2 rounded-sm border border-line bg-surface-2 p-2.5">
        <Switch label={label} checked={enabled} onCheckedChange={(checked) => setNumber({ enabled: checked, bounds })} />
        {enabled && <div className="flex flex-col gap-2">
          {bounds.map((bound, index) => (
            <div key={index} className="grid grid-cols-[minmax(4rem,0.7fr)_minmax(0,1fr)_auto] items-center gap-2">
              <Select value={bound.op} ariaLabel={`${label}比较方式 ${index + 1}`} options={DROP_OPERATORS.map((op) => ({ value: op, label: op }))} onValueChange={(op) => setNumber({ enabled, bounds: bounds.map((entry, i) => i === index ? { ...entry, op: op as DropOperator } : entry) })} />
              <TextInput aria-label={`${label}数值 ${index + 1}`} type="number" min={0} max={2147483647} step={1} value={Number.isFinite(bound.value) ? bound.value : ""} onChange={(event) => setNumber({ enabled, bounds: bounds.map((entry, i) => i === index ? { ...entry, value: event.currentTarget.valueAsNumber } : entry) })} />
              {index === 1 && <Button variant="ghost" size="sm" aria-label={`移除${label}区间边界`} onClick={() => setNumber({ enabled, bounds: bounds.slice(0, 1) })}>移除</Button>}
            </div>
          ))}
          {bounds.length === 1 && <Button variant="ghost" size="sm" className="self-start" onClick={() => setNumber({ enabled, bounds: [...bounds, { op: bounds[0].op.startsWith("<") ? ">=" : "<=", value: bounds[0].value }] })}>添加区间边界</Button>}
          {field === "stackSize" && allSupported && <span className="text-xs text-ink-muted">所选 {rule.target.itemIds.length} 项共用此数量条件</span>}
        </div>}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        {numberControl("stackSize")}
        {numberControl("gemLevel")}
      </div>
      <Disclosure summary="高级匹配条件" defaultOpen={DROP_KEYS.slice(2).some((field) => drop[field]?.enabled) || drop.rarity?.enabled} className="rounded-sm border border-line bg-surface-2 px-3 py-2">
        <div className="grid gap-2 pt-2 sm:grid-cols-2">
          <div className="space-y-2 rounded-sm border border-line p-2.5">
            <Switch label="稀有度" checked={drop.rarity?.enabled ?? false} onCheckedChange={(enabled) => update({ rarity: { enabled, value: drop.rarity?.value ?? "Rare" } })} />
            {drop.rarity?.enabled && <Select value={drop.rarity.value} ariaLabel="物品稀有度" options={RARITIES.map((value) => ({ value, label: RARITY_LABELS[value] }))} onValueChange={(value) => update({ rarity: { enabled: true, value: value as ItemRarity } })} />}
          </div>
          {DROP_KEYS.slice(2).map(numberControl)}
        </div>
      </Disclosure>
      {issue && <p className="rounded-sm border border-ember/40 px-3 py-2 text-xs text-ember" role="status">{issue}</p>}
      {invalidStackIds.length > 0 && <Button variant="secondary" size="sm" onClick={() => onChange({ itemIds: rule.target.itemIds.filter((id) => !invalidStackIds.includes(id)) })}>移除 {invalidStackIds.length} 项不可堆叠物品</Button>}
    </div>
  );
}

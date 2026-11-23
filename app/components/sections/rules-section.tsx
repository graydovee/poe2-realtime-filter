"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, GripVertical, Plus } from "lucide-react";

import { DEFAULT_EFFECT_ITEMS, type BaseInspection } from "../../../lib/baseline-effects";
import { cn } from "../../../lib/cn";
import { summarizeDrop } from "../../../lib/drop-conditions";
import { currencyPriceTiers, formatPrice } from "../../../lib/pricing";
import type { FilterProfile, FilterRule, MarketSnapshot, RuleEffects } from "../../../lib/types";
import { RuleEditor } from "../rule-editor";
import { Button, Panel } from "../ui/primitives";
import { Disclosure } from "../ui/nav";

function ruleSummary(rule: FilterRule) {
  const { itemIds, itemEnabled, priceEnabled, range } = rule.target;
  const parts = [];
  if (itemIds.length && itemEnabled !== false) parts.push(`${itemIds.length} 项物品`);
  if (range && priceEnabled !== false) {
    const min = range.min ? `≥ ${formatPrice(range.min)}` : "";
    const max = range.max ? `< ${formatPrice(range.max)}` : "";
    parts.push([rule.autoRange ? "跟随市价" : "单件价格", min, max].filter(Boolean).join(" "));
  }
  parts.push(...summarizeDrop(rule.target.dropConditions));
  return parts.join(" · ") || "选择匹配条件";
}

export function RulesSection({ profile, market, customSounds, baseInspection, onRuleChange, onRemoveRule, onAddRule, onMoveRule, onSound }: {
  profile: FilterProfile;
  market: MarketSnapshot;
  customSounds: Record<string, File>;
  baseInspection?: BaseInspection;
  onRuleChange: (id: string, patch: Partial<FilterRule>) => void;
  onRemoveRule: (id: string) => void;
  onAddRule: () => string;
  onMoveRule: (id: string, delta: number) => void;
  onSound: (id: string, file: File | undefined) => void;
}) {
  const [activeId, setActiveId] = useState<string>();
  const [dragId, setDragId] = useState<string>();
  const [dropId, setDropId] = useState<string>();
  const [copiedTarget, setCopiedTarget] = useState<Pick<FilterRule, "target" | "autoRange">>();
  const [copiedEffects, setCopiedEffects] = useState<{ effects: RuleEffects; file?: File }>();
  const [notice, setNotice] = useState("");
  const active = profile.rules.find((rule) => rule.id === activeId) ?? profile.rules[0];
  const index = active ? profile.rules.indexOf(active) : -1;
  const tiers = currencyPriceTiers(market);

  function selectRule(id: string) {
    setActiveId(id);
    setNotice("");
  }

  return (
    <Panel title="自定义过滤规则" description="按列表顺序匹配，首条命中的规则生效。">
      <div className="grid items-start gap-3 xl:grid-cols-[minmax(13rem,1fr)_minmax(0,2.3fr)]">
        <aside className="min-w-0 space-y-2" aria-label="规则顺序">
          <ol className="m-0 list-none space-y-2 p-0">
            {profile.rules.map((rule, currentIndex) => (
              <li key={rule.id} className={cn("min-w-0 rounded-sm border bg-surface-2", active?.id === rule.id ? "border-gold/60" : "border-line", dropId === rule.id && dragId !== rule.id && "ring-1 ring-gold")}
                onDragOver={(event) => { if (dragId) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDropId(rule.id); } }}
                onDrop={(event) => {
                  if (!dragId) return;
                  event.preventDefault();
                  const from = profile.rules.findIndex((entry) => entry.id === dragId);
                  if (from >= 0 && from !== currentIndex) onMoveRule(dragId, currentIndex - from);
                  setDragId(undefined);
                  setDropId(undefined);
                }}>
                <div className="flex items-stretch">
                  <span draggable aria-hidden="true" className="cursor-grab self-center p-2 text-ink-muted active:cursor-grabbing"
                    onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", rule.id); setDragId(rule.id); }}
                    onDragEnd={() => { setDragId(undefined); setDropId(undefined); }}>
                    <GripVertical className="size-4" />
                  </span>
                  <button type="button" aria-current={active?.id === rule.id ? "true" : undefined} className="flex min-w-0 flex-1 flex-col gap-1 py-2 pr-2 text-left" onClick={() => selectRule(rule.id)}>
                    <span className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                      <span className="font-mono text-ink-muted">{currentIndex + 1}</span>
                      <span className="min-w-0 flex-1 truncate font-medium text-ink">{rule.name || "规则名称"}</span>
                      <span className={rule.hidden ? "text-ember" : "text-ink-muted"}>{rule.hidden ? "隐藏" : "显示"}</span>
                      <span className="text-ink-muted">{rule.enabled ? "启用" : "停用"}</span>
                    </span>
                    <span className="line-clamp-2 text-xs text-ink-muted">{ruleSummary(rule)}</span>
                  </button>
                </div>
              </li>
            ))}
          </ol>
          {active && <div className="flex justify-end gap-1" role="group" aria-label="移动当前规则">
            <Button variant="ghost" size="sm" disabled={index === 0} onClick={() => onMoveRule(active.id, -1)}><ArrowUp className="size-4" aria-hidden="true" />上移</Button>
            <Button variant="ghost" size="sm" disabled={index === profile.rules.length - 1} onClick={() => onMoveRule(active.id, 1)}><ArrowDown className="size-4" aria-hidden="true" />下移</Button>
          </div>}
          <Button variant="secondary" className="w-full border-dashed" disabled={profile.rules.length >= 100} onClick={() => selectRule(onAddRule())}><Plus className="size-4" aria-hidden="true" />新增规则</Button>
        </aside>

        {active && <div className="min-w-0 space-y-2">
          <Disclosure summary={<span className="flex items-center gap-2"><span>批量操作</span><span className="text-xs font-normal text-ink-muted">复制或粘贴条件与特效</span></span>} className="rounded-lg border border-line bg-surface-2/55 px-3" contentClassName="pb-2" storageKey="ui.rules.batch-actions">
            <div className="flex flex-wrap items-center gap-1" role="group" aria-label="复制规则设置">
              <Button size="sm" variant="ghost" onClick={() => {
                setCopiedTarget({ target: structuredClone(active.target), autoRange: active.autoRange });
                setNotice("已复制条件");
              }}>复制条件</Button>
              <Button size="sm" variant="ghost" disabled={!copiedTarget} onClick={() => {
                if (!copiedTarget) return;
                onRuleChange(active.id, structuredClone(copiedTarget));
                setNotice("已应用条件");
              }}>粘贴条件</Button>
              <Button size="sm" variant="ghost" onClick={() => {
                const effects = active.followBaseline ? baseInspection?.styles[active.id]?.effects ?? {} : active.effects;
                setCopiedEffects({ effects: structuredClone(effects), file: effects.sound?.type === "custom" ? customSounds[active.id] : undefined });
                setNotice("已复制特效");
              }}>复制特效</Button>
              <Button size="sm" variant="ghost" disabled={!copiedEffects} onClick={() => {
                if (!copiedEffects) return;
                onSound(active.id, copiedEffects.file);
                onRuleChange(active.id, { effects: structuredClone(copiedEffects.effects), effectPresetId: undefined, followBaseline: Object.prototype.hasOwnProperty.call(DEFAULT_EFFECT_ITEMS, active.id) ? false : undefined });
                setNotice("已应用特效");
              }}>粘贴特效</Button>
              <span className="ml-auto pr-2 text-xs text-ink-muted" role="status">{notice}</span>
            </div>
          </Disclosure>
          <RuleEditor key={active.id} rule={active} index={index} locale="cn" base={profile.baseFilter} inherited={baseInspection?.styles[active.id]}
            presets={baseInspection?.presets ?? []} market={market} customFile={active.effects.sound?.type === "custom" ? customSounds[active.id] : undefined}
            onChange={(patch) => onRuleChange(active.id, patch)} onRemove={() => { onRemoveRule(active.id); setActiveId(profile.rules[index + 1]?.id ?? profile.rules[index - 1]?.id); }}
            onSound={(file) => onSound(active.id, file)} />
          {active.autoRange && <div className="flex flex-wrap gap-2" aria-label="市场价格档">
            {tiers.map((tier) => <span key={tier.itemId} className="rounded-sm border border-line bg-surface-2 px-2 py-1.5 text-xs text-ink-muted">{tier.name} <strong className="font-mono font-medium text-gold">{formatPrice({ amount: tier.exaltedValue, currency: "exalted" })}</strong></span>)}
            {!tiers.length && <p className="text-xs text-ink-muted">刷新当前赛季行情以计算价格档。</p>}
          </div>}
        </div>}
      </div>
    </Panel>
  );
}

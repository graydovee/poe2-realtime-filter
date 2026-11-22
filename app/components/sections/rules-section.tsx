"use client";

import { Plus } from "lucide-react";

import type { InheritedStyle } from "../../../lib/baseline-effects";
import { currencyPriceTiers, formatPrice } from "../../../lib/pricing";
import type { FilterProfile, FilterRule, MarketSnapshot } from "../../../lib/types";
import { RuleEditor } from "../rule-editor";
import { Button, Panel } from "../ui/primitives";

export function RulesSection({
  profile,
  market,
  customSounds,
  baseStyles,
  onRuleChange,
  onRemoveRule,
  onAddRule,
  onMoveRule,
  onSound,
}: {
  profile: FilterProfile;
  market: MarketSnapshot;
  customSounds: Record<string, File>;
  baseStyles: Record<string, InheritedStyle>;
  onRuleChange: (id: string, patch: Partial<FilterRule>) => void;
  onRemoveRule: (id: string) => void;
  onAddRule: () => void;
  onMoveRule: (id: string, delta: number) => void;
  onSound: (id: string, file: File | undefined) => void;
}) {
  const tiers = currencyPriceTiers(market);
  const enabled = profile.rules.filter((rule) => rule.enabled).length;
  const hidden = profile.rules.filter((rule) => rule.enabled && rule.hidden).length;

  return (
    <Panel
      title="自定义过滤规则"
      description="从上到下依次匹配，第一个命中的规则生效。适用物品与价格区间可以只填一个，也可以同时填（取交集）。没有填写的特效交给基础过滤器，隐藏也是规则里的一个选项。"
    >
      <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {tiers.length ? (
          tiers.map((tier) => (
            <div key={tier.itemId} className="flex flex-col gap-1.5 rounded-sm border border-line bg-surface-2 px-3 py-2.5">
              <span className="truncate text-xs text-ink-muted">{tier.name}</span>
              <strong className="font-mono text-[13px] font-medium text-gold">{formatPrice({ amount: tier.exaltedValue, currency: "exalted" })}</strong>
            </div>
          ))
        ) : (
          <p className="col-span-2 text-xs leading-relaxed text-ink-muted sm:col-span-4">
            当前赛季没有可用的锚点行情，跟随市价的价格档会被禁用；仍可以用「选择物品」或固定价格写规则。
          </p>
        )}
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-muted">
        <span>
          共 <b className="font-mono font-normal text-ink">{profile.rules.length}</b> 条规则，启用 <b className="font-mono font-normal text-ink">{enabled}</b> 条
          {hidden > 0 ? <>，其中隐藏规则 <b className="font-mono font-normal text-ember">{hidden}</b> 条</> : null}
        </span>
      </div>

      <div className="flex flex-col gap-3">
        {profile.rules.length === 0 && (
          <p className="rounded-sm border border-dashed border-line bg-surface-2/40 px-4 py-6 text-center text-xs text-ink-muted">
            还没有规则，输出等于基础过滤器。可以先「新增规则」。
          </p>
        )}
        {profile.rules.map((rule, index) => (
          <RuleEditor
            key={rule.id}
            rule={rule}
            index={index}
            total={profile.rules.length}
            locale={profile.locale}
            style={profile.style}
            base={profile.baseFilter}
            inherited={baseStyles[rule.id]}
            market={market}
            customFile={customSounds[rule.id]}
            onChange={(patch) => onRuleChange(rule.id, patch)}
            onRemove={() => onRemoveRule(rule.id)}
            onMove={(delta) => onMoveRule(rule.id, delta)}
            onSound={(file) => onSound(rule.id, file)}
          />
        ))}
      </div>

      <Button variant="secondary" className="mt-4 w-full border-dashed" onClick={onAddRule}>
        <Plus aria-hidden="true" className="size-4" />
        新增规则
      </Button>
    </Panel>
  );
}

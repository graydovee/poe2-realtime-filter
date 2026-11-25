"use client";

import { useState } from "react";
import { ChevronDown, ClipboardPaste, Copy, Plus, Sparkles } from "lucide-react";

import type { FilterRule, RuleEffects } from "../../../lib/types";
import { ruleEffectsPending, shownRuleEffects } from "../../state/editor";
import { useAppStore, useEditorMarket } from "../../state/store";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { EmptyState } from "../ui/empty-state";
import { Panel } from "../ui/panel";
import { toast } from "../ui/toast";
import { RuleEditor } from "./rule-editor";
import { RuleList, RuleStrip } from "./rule-list";

/** 模块 ③：自定义规则。左边是规则顺序，右边是选中规则的编辑器。 */
export function RulesModule() {
  const rules = useAppStore((state) => state.profile.rules);
  const base = useAppStore((state) => state.profile.baseFilter);
  const baseInspection = useAppStore((state) => state.baseInspection);
  const customSounds = useAppStore((state) => state.customSounds);
  const activeRuleId = useAppStore((state) => state.activeRuleId);
  const updateRule = useAppStore((state) => state.updateRule);
  const removeRule = useAppStore((state) => state.removeRule);
  const undoRemoveRule = useAppStore((state) => state.undoRemoveRule);
  const setRuleAppearance = useAppStore((state) => state.setRuleAppearance);
  const addRule = useAppStore((state) => state.addRule);
  const { selected: market } = useEditorMarket();
  const [copiedTarget, setCopiedTarget] = useState<Pick<FilterRule, "target">>();
  const [copiedEffects, setCopiedEffects] = useState<{ effects: RuleEffects; file?: File }>();

  const active = rules.find((rule) => rule.id === activeRuleId) ?? rules[0];
  const awaitingEffects = useAppStore((state) => Boolean(active && ruleEffectsPending(active, state)));

  function removeActive() {
    if (!active) return;
    const name = active.name;
    removeRule(active.id);
    toast(`已删除规则「${name}」`, { action: { label: "撤销", onClick: undoRemoveRule } });
  }

  const batch = active && (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="ghost" className="text-ink-muted">
          <Copy aria-hidden="true" />
          批量操作
          <ChevronDown aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem
          onSelect={() => {
            setCopiedTarget({ target: structuredClone(active.target) });
            toast.success("已复制条件");
          }}
        >
          <Copy aria-hidden="true" />
          复制条件
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!copiedTarget}
          onSelect={() => {
            if (!copiedTarget) return;
            updateRule(active.id, structuredClone(copiedTarget));
            toast.success("已应用条件");
          }}
        >
          <ClipboardPaste aria-hidden="true" />
          粘贴条件
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={awaitingEffects}
          onSelect={() => {
            const effects = shownRuleEffects(active, baseInspection);
            setCopiedEffects({
              effects: structuredClone(effects),
              file: effects.sound?.type === "custom" ? customSounds[active.id] : undefined,
            });
            toast.success("已复制特效");
          }}
        >
          <Copy aria-hidden="true" />
          复制特效
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!copiedEffects}
          onSelect={() => {
            if (!copiedEffects) return;
            setRuleAppearance(active.id, { effects: structuredClone(copiedEffects.effects), file: copiedEffects.file });
            toast.success("已应用特效");
          }}
        >
          <ClipboardPaste aria-hidden="true" />
          粘贴特效
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <Panel
      id="module-rules"
      title="自定义规则"
      description="按列表顺序匹配，首条命中的规则生效。"
      actions={batch}
      bodyClassName="@container"
    >
      {/* 面板内容区是容器查询的参照物；列模板要写在它的子元素上，写在自己身上不会生效。 */}
      <div className="grid gap-3 @3xl:grid-cols-[13.5rem_minmax(0,1fr)] @3xl:items-start">
        {/* 窄的时候规则列表是一行可横向滚动的标签；够宽时排成左栏。标签条自身可横向滚动，所以必须允许它收缩。 */}
        <div className="min-w-0 @3xl:hidden">
          <RuleStrip />
        </div>
        <div className="hidden min-w-0 @3xl:block">
          <RuleList />
        </div>
        <div className="min-w-0 @3xl:border-l @3xl:border-line @3xl:pl-3">
          {active ? (
            <RuleEditor
              key={active.id}
              rule={active}
              index={rules.indexOf(active)}
              base={base}
              presets={baseInspection?.presets ?? []}
              market={market}
              onChange={(patch) => updateRule(active.id, patch)}
              onRemove={removeActive}
            />
          ) : (
            <EmptyState
              icon={<Sparkles className="size-5" aria-hidden="true" />}
              title="还没有自定义规则"
              description="新增一条规则，为指定物品或价格区间设置掉落效果。"
              action={
                <Button variant="primary" onClick={addRule}>
                  <Plus aria-hidden="true" />
                  新增规则
                </Button>
              }
            />
          )}
        </div>
      </div>
    </Panel>
  );
}

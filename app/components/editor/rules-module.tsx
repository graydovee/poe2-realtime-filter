"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ClipboardPaste, Copy, Plus, Sparkles, TriangleAlert, Undo2 } from "lucide-react";

import type { FilterRule, RuleEffects } from "../../../lib/types";
import { cn } from "../../../lib/cn";
import { useActiveEntry } from "../../state/active-entry";
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
import { Separator } from "../ui/separator";
import { Switch } from "../ui/switch";
import { toast } from "../ui/toast";
import { Tooltip } from "../ui/tooltip";
import { BaseRuleEditor } from "./base-rule-editor";
import { BaseRuleList } from "./base-rule-list";
import { RuleEditor } from "./rule-editor";
import { RuleList, RuleStrip } from "./rule-list";

/** 模块 ③：自定义规则。左边是规则顺序，右边是选中规则的编辑器。 */
export function RulesModule() {
  const rules = useAppStore((state) => state.profile.rules);
  const base = useAppStore((state) => state.profile.baseFilter);
  const overlays = useAppStore((state) => state.profile.overlays);
  const profileEditsEnabled = useAppStore((state) => state.profile.editsEnabled);
  const editsOn = profileEditsEnabled !== false;
  const baseRules = useAppStore((state) => state.baseRules);
  const baseRulesError = useAppStore((state) => state.baseRulesError);
  const showBaseRules = useAppStore((state) => state.showBaseRules);
  const setShowBaseRules = useAppStore((state) => state.setShowBaseRules);
  const loadBaseRules = useAppStore((state) => state.loadBaseRules);
  const baseInspection = useAppStore((state) => state.baseInspection);
  const customSounds = useAppStore((state) => state.customSounds);
  const activeBase = useAppStore((state) => state.activeBase);
  const clipboard = useAppStore((state) => state.overlayClipboard);
  const updateRule = useAppStore((state) => state.updateRule);
  const removeRule = useAppStore((state) => state.removeRule);
  const undoRemoveRule = useAppStore((state) => state.undoRemoveRule);
  const setRuleAppearance = useAppStore((state) => state.setRuleAppearance);
  const addRule = useAppStore((state) => state.addRule);
  const copyOverlays = useAppStore((state) => state.copyOverlays);
  const pasteOverlays = useAppStore((state) => state.pasteOverlays);
  const setEditsEnabled = useAppStore((state) => state.setEditsEnabled);
  const restoreBaseRules = useAppStore((state) => state.restoreBaseRules);
  const undoRestoreBaseRules = useAppStore((state) => state.undoRestoreBaseRules);
  const { selected: market } = useEditorMarket();
  const [copiedTarget, setCopiedTarget] = useState<Pick<FilterRule, "target">>();
  const [copiedEffects, setCopiedEffects] = useState<{ effects: RuleEffects; file?: File }>();

  const { rule: active, baseSelected } = useActiveEntry();
  const awaitingEffects = useAppStore((state) => Boolean(active && ruleEffectsPending(active, state)));
  const enabledEdits = overlays.filter((overlay) => overlay.enabled).length;
  const invalidEdits = editsOn
    ? (baseRules ? Object.values(baseRules.overlays) : []).filter((status) => status.state === "invalid").length
    : 0;

  // 列出基础规则，或者方案里有修改时，读取基础规则表。
  useEffect(() => {
    if (base && (showBaseRules || overlays.length) && !baseRules && !baseRulesError) void loadBaseRules();
  }, [base, showBaseRules, overlays.length, baseRules, baseRulesError, loadBaseRules]);

  function removeActive() {
    if (!active) return;
    const name = active.name;
    removeRule(active.id);
    toast(`已删除规则「${name}」`, { action: { label: "撤销", onClick: undoRemoveRule } });
  }

  // 总开关。按下时每处修改按自己的启用状态生效；不按下时全部不生效，下面这一组操作也不显示。
  // 按钮文字里带着「开 / 关」，数量和失效的说明放在悬停提示里。
  const invalidText = editsOn && invalidEdits > 0 ? `有 ${invalidEdits} 处修改在当前基础过滤器上失效。` : "";
  const countText = overlays.length ? `共 ${overlays.length} 处修改，${enabledEdits} 处启用。` : "";
  const edits = (base || overlays.length > 0) && (
    <Tooltip label={`基础规则修改${editsOn ? "已启用" : "已关闭"}。点一下${editsOn ? "关闭，全部修改不生效，基础规则只读" : "启用，每处修改按各自的启用状态生效"}。${countText}${invalidText}`}>
      <Button
        size="sm"
        aria-pressed={editsOn}
        aria-label={`基础规则修改${editsOn ? "已启用" : "已关闭"}，点一下${editsOn ? "关闭" : "启用"}`}
        className={cn("text-ink-muted", editsOn && "border-gold/35 bg-gold/10 text-gold-bright hover:border-gold/50 hover:bg-gold/15")}
        onClick={() => {
          setEditsEnabled(!editsOn);
          toast(editsOn ? "已关闭基础规则修改" : "已启用基础规则修改");
        }}
      >
        {`基础规则修改：${editsOn ? "开" : "关"}`}
        {invalidText && <TriangleAlert aria-hidden="true" className="size-3.5 text-ember" />}
      </Button>
    </Tooltip>
  );

  const editItems = editsOn && (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        disabled={!overlays.length}
        onSelect={() => {
          copyOverlays();
          toast.success(`已复制 ${overlays.length} 处基础规则修改`);
        }}
      >
        <Copy aria-hidden="true" />
        复制基础规则修改
      </DropdownMenuItem>
      <DropdownMenuItem
        disabled={!clipboard?.length}
        onSelect={() => {
          const result = pasteOverlays();
          if (!result) return;
          if (result.invalid) toast(`已粘贴 ${result.pasted} 处修改，${result.invalid} 处在当前基础过滤器上不生效`);
          else toast.success(`已粘贴 ${result.pasted} 处修改`);
        }}
      >
        <ClipboardPaste aria-hidden="true" />
        粘贴基础规则修改
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        disabled={!overlays.length}
        onSelect={() => {
          const count = restoreBaseRules();
          if (count) toast(`已还原基础规则，去掉 ${count} 处修改`, { action: { label: "撤销", onClick: undoRestoreBaseRules } });
        }}
      >
        <Undo2 aria-hidden="true" />
        还原基础规则
      </DropdownMenuItem>
    </>
  );

  const batch = (active || base || overlays.length > 0) && (
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
          disabled={!active}
          onSelect={() => {
            if (!active) return;
            setCopiedTarget({ target: structuredClone(active.target) });
            toast.success("已复制条件");
          }}
        >
          <Copy aria-hidden="true" />
          复制条件
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!active || !copiedTarget}
          onSelect={() => {
            if (!active || !copiedTarget) return;
            updateRule(active.id, structuredClone(copiedTarget));
            toast.success("已应用条件");
          }}
        >
          <ClipboardPaste aria-hidden="true" />
          粘贴条件
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={!active || awaitingEffects}
          onSelect={() => {
            if (!active) return;
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
          disabled={!active || !copiedEffects}
          onSelect={() => {
            if (!active || !copiedEffects) return;
            setRuleAppearance(active.id, { effects: structuredClone(copiedEffects.effects), file: copiedEffects.file });
            toast.success("已应用特效");
          }}
        >
          <ClipboardPaste aria-hidden="true" />
          粘贴特效
        </DropdownMenuItem>
        {editItems}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <Panel
      id="module-rules"
      title="自定义规则"
      description="按列表顺序匹配，首条命中的规则生效。"
      actions={
        <div className="flex items-center gap-2">
          <Switch
            checked={showBaseRules}
            onCheckedChange={setShowBaseRules}
            disabled={!base}
            label="显示基础规则"
            title="在规则列表下面显示基础过滤器的规则"
          />
          {edits}
          {batch && (
            <>
              <Separator orientation="vertical" className="mx-0 h-4" />
              {batch}
            </>
          )}
        </div>
      }
      bodyClassName="@container"
    >
      {/* 面板内容区是容器查询的参照物；列模板要写在它的子元素上，写在自己身上不会生效。 */}
      <div className="grid gap-3 @3xl:grid-cols-[13.5rem_minmax(0,1fr)] @3xl:items-start">
        {/* 窄的时候规则列表是一行可横向滚动的标签；够宽时排成左栏。标签条自身可横向滚动，所以必须允许它收缩。 */}
        <div className="min-w-0 @3xl:hidden">
          <RuleStrip />
          {showBaseRules && <BaseRuleList />}
        </div>
        <div className="hidden min-w-0 @3xl:block">
          <RuleList />
        </div>
        <div className="min-w-0 @3xl:border-l @3xl:border-line @3xl:pl-3">
          {baseSelected ? (
            <BaseRuleEditor
              key={activeBase?.kind === "rule" ? `rule:${activeBase.index}` : activeBase?.kind === "edit" ? `edit:${activeBase.id}` : "base"}
            />
          ) : active ? (
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

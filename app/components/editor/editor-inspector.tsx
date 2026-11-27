"use client";

import { scrollToModule } from "../../hooks/navigation";
import { requestLeaveEditor } from "../../hooks/use-shortcuts";
import { blockKey } from "../../../lib/base-overlays";
import { useActiveEntry } from "../../state/active-entry";
import { effectiveRule, useBaseEdits } from "../../state/base-edits";
import { ruleEffectsPending, shownRuleEffects } from "../../state/editor";
import { useAppStore } from "../../state/store";
import { SoundPreviewButton } from "../sound-preview";
import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import { EmptyState } from "../ui/empty-state";
import { Separator } from "../ui/separator";
import { effectSourceLabel, EffectSummary, LootScene } from "./appearance-preview";

type SummaryRow = { label: string; value: string; warning?: boolean; jump: () => void };

/** 方案摘要：每一行都能跳到对应的模块。 */
function Summary() {
  const profile = useAppStore((state) => state.profile);
  const baseRules = useAppStore((state) => state.baseRules);
  const setBaseFilterOpen = useAppStore((state) => state.setBaseFilterOpen);
  const rules = profile.rules ?? [];
  const edits = profile.overlays ?? [];
  const invalidEdits = (baseRules ? Object.values(baseRules.overlays) : []).filter((status) => status.state === "invalid").length;
  const jumpToBase = () => {
    setBaseFilterOpen(true);
    scrollToModule("base");
  };
  const rows: SummaryRow[] = [
    {
      label: "赛季",
      value: profile.league || "待选择",
      warning: !profile.league,
      jump: () => scrollToModule("season"),
    },
    {
      label: "基础过滤器",
      value: profile.baseFilter?.name ?? (profile.baseFilterHint ? "待选择" : "仅自定义规则"),
      warning: Boolean(profile.baseFilterHint) && !profile.baseFilter,
      jump: jumpToBase,
    },
    {
      label: "自定义规则",
      value: `${rules.length} 条 · 启用 ${rules.filter((rule) => rule.enabled).length}`,
      jump: () => scrollToModule("rules"),
    },
    {
      label: "隐藏规则",
      value: `${rules.filter((rule) => rule.enabled && rule.hidden).length} 条`,
      jump: () => scrollToModule("rules"),
    },
  ];
  if (edits.length) {
    const editsOn = profile.editsEnabled !== false;
    rows.push({
      label: "基础规则修改",
      value: editsOn
        ? `${edits.length} 处 · 启用 ${edits.filter((edit) => edit.enabled).length}` + (invalidEdits ? ` · ${invalidEdits} 处不生效` : "")
        : `${edits.length} 处 · 已关闭`,
      warning: editsOn && invalidEdits > 0,
      jump: () => scrollToModule("rules"),
    });
  }
  if (profile.baseFilter) {
    rows.push({ label: "跳过物品", value: `${profile.skippedItemIds.length} 项`, jump: jumpToBase });
  }

  return (
    <section aria-label="方案摘要">
      <h3 className="mb-1.5 px-1 text-xs font-semibold text-ink-muted">方案摘要</h3>
      <ul className="grid gap-0.5">
        {rows.map((row) => (
          <li key={row.label}>
            <button
              type="button"
              onClick={row.jump}
              className="grid w-full cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-4 rounded-sm px-1 py-1 text-left transition-colors duration-150 hover:bg-surface-2 hover:text-gold-bright"
            >
              <span className="text-sm text-ink-muted">{row.label}</span>
              <span className={`truncate text-right text-sm ${row.warning ? "text-ember" : "text-ink"}`} title={row.value}>
                {row.value}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 编辑器的检查器：当前选中条目在游戏里的实时效果、方案摘要，以及保存 / 预览 / 取消。 */
export function EditorInspector() {
  const base = useAppStore((state) => state.profile.baseFilter);
  const baseInspection = useAppStore((state) => state.baseInspection);
  const customSounds = useAppStore((state) => state.customSounds);
  const activeBase = useAppStore((state) => state.activeBase);
  const saveError = useAppStore((state) => state.saveError);
  const schemeBusy = useAppStore((state) => state.schemeBusy);
  const previewBusy = useAppStore((state) => state.previewBusy);
  const requestSave = useAppStore((state) => state.requestSave);
  const generate = useAppStore((state) => state.generate);

  const { rule: active, base: baseRule, baseSelected } = useActiveEntry();
  const byKey = useBaseEdits();
  const editsOn = useAppStore((state) => state.profile.editsEnabled !== false);
  const edit = baseRule ? byKey.get(blockKey(baseRule.conditions)) : undefined;
  const baseView = baseRule ? effectiveRule(baseRule, edit, editsOn) : undefined;
  const awaitingEffects = useAppStore((state) => Boolean(active && ruleEffectsPending(active, state)));
  const sourceId = active?.baselineEffectItemId;
  const sourceStyle = sourceId ? baseInspection?.styles[sourceId] : undefined;
  const previewBase = sourceId && (!sourceStyle || sourceStyle.warning) ? undefined : base;
  const shownEffects = active ? shownRuleEffects(active, baseInspection) : {};
  const sound = baseSelected ? baseView?.effects.sound : shownEffects.sound;
  const customFile = baseSelected
    ? edit && baseView?.effects.sound?.type === "custom" ? customSounds[edit.id] : undefined
    : active && shownEffects.sound?.type === "custom" ? customSounds[active.id] : undefined;

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <section aria-label="实时预览" className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold text-ink-muted">实时预览</h3>
            {(active || baseView) && <SoundPreviewButton sound={sound} file={customFile} base={base} />}
          </div>
          {baseSelected ? (
            activeBase?.kind === "edit" ? (
              <p className="text-sm text-ink-muted">选中的是一处失效的修改，它不生效。</p>
            ) : baseView ? (
              baseView.hidden ? (
                <p className="text-sm text-ink-muted">这条规则隐藏命中的物品，没有光柱和地图图标。</p>
              ) : (
                <>
                  <LootScene effects={baseView.effects} label={baseRule?.label ?? ""} />
                  <EffectSummary effects={baseView.effects} base={editsOn && edit ? base : undefined} />
                </>
              )
            ) : (
              <p role="status" className="text-sm text-ink-muted">正在读取基础过滤器的规则…</p>
            )
          ) : (
            <>
              {sourceId && <p className="text-xs text-ink-muted [overflow-wrap:anywhere]">特效来源 · {effectSourceLabel(sourceId)}</p>}
              {awaitingEffects ? (
                <p role="status" className="text-sm text-ink-muted">正在读取基础过滤器特效…</p>
              ) : active ? (
                <>
                  <LootScene effects={shownEffects} label={active.name || "示例物品"} />
                  <EffectSummary effects={shownEffects} base={previewBase} />
                </>
              ) : (
                <EmptyState compact title="还没有规则" description="新增一条规则后，这里会显示它在游戏里的掉落效果。" />
              )}
            </>
          )}
        </section>
        <Separator orientation="horizontal" className="my-0" />
        <Summary />
        {saveError && <Alert tone="ember">{saveError}</Alert>}
      </div>
      <footer className="grid shrink-0 gap-2 border-t border-line p-3">
        <Button variant="primary" size="lg" disabled={schemeBusy} onClick={requestSave}>
          {schemeBusy ? "保存中…" : "保存方案"}
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button disabled={schemeBusy || previewBusy} onClick={() => void generate()}>
            {previewBusy ? "生成中…" : "预览"}
          </Button>
          <Button disabled={schemeBusy} onClick={requestLeaveEditor}>
            取消
          </Button>
        </div>
      </footer>
    </div>
  );
}

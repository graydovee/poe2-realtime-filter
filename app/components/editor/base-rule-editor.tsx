"use client";

import { useId, useState } from "react";
import { PenLine, Plus, Trash2, TriangleAlert, Undo2, X } from "lucide-react";
import { toast } from "sonner";

import { blockKey, conditionLineIssue, MAX_CONDITIONS } from "../../../lib/base-overlays";
import { describeEffects, describeIcon } from "../../../lib/effect-labels";
import { customSoundOptions } from "../../../lib/sound-library";
import type { BaseOverlay, RuleEffects, RuleFont } from "../../../lib/types";
import { cn } from "../../../lib/cn";
import { effectiveRule, useBaseEdits } from "../../state/base-edits";
import { useAppStore } from "../../state/store";
import { Alert } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button, IconButton } from "../ui/button";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { BeamField, FontSizeField, MapIconField, RgbColorField, SoundField } from "./appearance-fields";

/** 条件行里的条件名；格式不对时为空。 */
const conditionField = (line: string) => /^([A-Za-z]+)\b/.exec(line.trim())?.[1];

/** 特效的七项：光柱、地图图标、字号、三种颜色和音效。 */
type EffectFieldKey = "beam" | "icon" | "fontSize" | "textColor" | "borderColor" | "backgroundColor" | "sound";

const COLORS = [
  ["textColor", "文字颜色"],
  ["borderColor", "边框颜色"],
  ["backgroundColor", "背景颜色"],
] as const;

/** 没写的那一项，占位文字里写基础规则现在的值。 */
function inheritedText(original: RuleEffects, key: EffectFieldKey): string {
  const font = original.font ?? {};
  const sound = original.sound ? (original.sound.type === "builtin" ? `内置音效 ${original.sound.id}` : original.sound.fileName) : "";
  const value = {
    beam: original.beam ? describeEffects({ beam: original.beam }) : "",
    icon: original.icon ? describeIcon(original.icon) : "",
    fontSize: font.fontSize ? `${font.fontSize} 号` : "",
    textColor: font.textColor ?? "",
    borderColor: font.borderColor ?? "",
    backgroundColor: font.backgroundColor ?? "",
    sound,
  }[key];
  return value ? `基础规则：${value}` : "基础规则未设置";
}

/**
 * 基础过滤器一侧的编辑区：一条基础规则的匹配条件、显示与特效，改它就是在建立对这条规则的修改；
 * 或者一处失效的修改，只能查看、启停和删除。
 */
export function BaseRuleEditor() {
  const activeBase = useAppStore((state) => state.activeBase);
  const baseRules = useAppStore((state) => state.baseRules);
  const baseRulesError = useAppStore((state) => state.baseRulesError);
  const overlays = useAppStore((state) => state.profile.overlays);
  const editsOn = useAppStore((state) => state.profile.editsEnabled !== false);
  const rules = useAppStore((state) => state.profile.rules);
  const customSounds = useAppStore((state) => state.customSounds);
  const editBaseRule = useAppStore((state) => state.editBaseRule);
  const updateOverlay = useAppStore((state) => state.updateOverlay);
  const removeOverlay = useAppStore((state) => state.removeOverlay);
  const undoRemoveOverlay = useAppStore((state) => state.undoRemoveOverlay);
  const setOverlaySound = useAppStore((state) => state.setOverlaySound);
  const pickOverlaySound = useAppStore((state) => state.pickOverlaySound);
  const byKey = useBaseEdits();
  const titleId = useId();
  const conditionsId = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);

  const rule = activeBase?.kind === "rule" ? baseRules?.rules[activeBase.index] : undefined;
  const stale = activeBase?.kind === "edit" ? overlays.find((overlay) => overlay.id === activeBase.id) : undefined;
  const edit = rule ? byKey.get(blockKey(rule.conditions)) : undefined;
  // 总开关关闭时这里只读：修改都按关闭显示，不能改条件、改特效，也不能还原或删除。
  const editOn = editsOn && Boolean(edit?.enabled);
  const view = rule ? effectiveRule(rule, edit, editsOn) : undefined;
  const editingNow = editing && editsOn;
  const reading = activeBase?.kind === "rule" && !baseRules && !baseRulesError;
  if (!rule && !stale) {
    return reading ? <p role="status" className="px-1 py-6 text-center text-sm text-ink-muted">正在读取基础过滤器的规则…</p> : null;
  }

  const conditions = view?.conditions ?? stale?.conditions ?? [];
  const name = rule?.label ?? "失效的修改";
  const ruleIndex = rule?.index;

  /** 条件输入框里的草稿：每一行都没有格式问题时才写进方案。 */
  const commit = (next: string[]) => {
    setDraft(next);
    if (ruleIndex !== undefined && next.every((line) => !conditionLineIssue(line))) {
      editBaseRule(ruleIndex, { conditionLines: next.map((line) => line.trim()) });
    }
  };
  // 总开关关闭时各项按没写显示，占位文字是基础规则现在的值。
  const effects: RuleEffects = editsOn ? edit?.effects ?? {} : {};
  const font = effects.font ?? {};
  const inherited = (key: EffectFieldKey) => (rule ? inheritedText(rule.effects, key) : "");
  const reset = (key: EffectFieldKey) => {
    if (ruleIndex === undefined || !edit) return;
    const next = { ...edit.effects };
    if (key === "beam" || key === "icon" || key === "sound") delete next[key];
    else {
      const nextFont = { ...next.font };
      delete nextFont[key];
      if (Object.keys(nextFont).length) next.font = nextFont;
      else delete next.font;
    }
    editBaseRule(ruleIndex, { effects: next });
  };
  /** 改一项特效：合并进这处修改，空项去掉。 */
  const editEffects = (patch: Partial<RuleEffects>) => {
    if (ruleIndex === undefined) return;
    const next: RuleEffects = { ...effects, ...patch };
    for (const key of Object.keys(next) as Array<keyof RuleEffects>) {
      const entry = next[key];
      if (entry === undefined || entry === "" || (key === "font" && (!entry || Object.keys(entry).length === 0))) delete next[key];
    }
    editBaseRule(ruleIndex, { effects: next });
  };
  const editFont = (patch: Partial<RuleFont>) => {
    const next: RuleFont = { ...font, ...patch };
    for (const key of Object.keys(next) as Array<keyof RuleFont>) {
      if (next[key] === undefined || next[key] === "") delete next[key];
    }
    editEffects({ font: next });
  };
  const remove = (overlay: BaseOverlay) => {
    removeOverlay(overlay.id);
    toast("已删除这处修改", { action: { label: "撤销", onClick: undoRemoveOverlay } });
  };

  return (
    <div className="@container min-w-0">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-1 py-2">
        <span
          aria-hidden="true"
          className={cn(
            "grid size-7 shrink-0 place-items-center rounded-sm border font-mono text-xs",
            stale ? "border-ember/35 bg-ember/10 text-ember" : "border-line bg-surface-2 text-ink-muted",
          )}
        >
          {ruleIndex === undefined ? <TriangleAlert className="size-3.5" /> : ruleIndex + 1}
        </span>
        <div className="min-w-0 flex-1 basis-40">
          <h2 id={titleId} className="truncate text-sm font-semibold text-ink">{name}</h2>
          <p className="truncate text-xs text-ink-muted">{rule?.section || "基础过滤器规则"}</p>
        </div>
        {stale ? (
          <>
            <Badge tone="ember">已失效</Badge>
            {editsOn && (
              <IconButton label="删除这处修改" variant="danger" size="icon-sm" onClick={() => remove(stale)}>
                <Trash2 aria-hidden="true" className="size-3.5" />
              </IconButton>
            )}
          </>
        ) : edit ? (
          <>
            <Badge tone="muted">基础</Badge>
            <Badge tone={editOn ? "gold" : "muted"}>{editOn ? "已修改" : "已关闭"}</Badge>
            <Switch checked={edit.enabled} disabled={!editsOn} onCheckedChange={(enabled) => updateOverlay(edit.id, { enabled })} label="启用这处修改" />
            {editsOn && (
              <IconButton label="还原这条规则" size="icon-sm" onClick={() => remove(edit)}>
                <Undo2 aria-hidden="true" className="size-3.5" />
              </IconButton>
            )}
          </>
        ) : (
          <Badge tone="muted">基础</Badge>
        )}
      </header>

      {rule && !editsOn && (
        <Alert tone="muted" className="mt-3">
          基础规则修改已关闭，这条规则按基础过滤器原样生效。要修改它，先点标题栏的「基础规则修改：关」。
        </Alert>
      )}

      {stale && (
        <Alert tone="ember" className="mt-3">
          {`这处修改不生效，方案照常生成。${baseRules?.overlays[stale.id]?.state === "invalid" ? (baseRules.overlays[stale.id] as { reason: string }).reason : "当前基础过滤器里找不到它对应的规则。"}`}
        </Alert>
      )}

      <section aria-labelledby={conditionsId} className="space-y-3 p-1 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 id={conditionsId} className="text-xs font-semibold tracking-wide text-ink-muted">匹配条件</h3>
          {rule && (editingNow ? (
            <div className="flex flex-wrap items-center gap-1">
              <Button size="sm" variant="ghost" disabled={draft.length >= MAX_CONDITIONS} onClick={() => commit([...draft, ""])}>
                <Plus aria-hidden="true" />添加条件
              </Button>
              {edit?.conditionLines !== undefined && (
                <Button size="sm" variant="ghost" onClick={() => editBaseRule(rule.index, { conditionLines: undefined })}>恢复原条件</Button>
              )}
              <Button size="sm" disabled={draft.some((line) => conditionLineIssue(line))} onClick={() => setEditing(false)}>完成</Button>
            </div>
          ) : editsOn ? (
            <Button size="sm" onClick={() => { setDraft([...conditions]); setEditing(true); }}>
              <PenLine aria-hidden="true" />修改条件
            </Button>
          ) : null)}
        </div>
        <div className="rounded-md border border-line bg-surface-2/70 p-3">
          {conditions.length === 0 && !editingNow ? (
            <p className="text-xs leading-relaxed text-ink-muted">没有条件，这条规则匹配所有物品。</p>
          ) : editingNow ? (
            <div className="space-y-2">
              {draft.map((line, index) => {
                const issue = conditionLineIssue(line);
                const field = conditionField(line);
                const unused = !issue && rule && field && !baseRules?.conditionNames.includes(field.toLowerCase());
                return (
                  <div key={index} className="flex flex-col gap-1">
                    <div className="flex gap-2">
                      <Input
                        aria-label={`第 ${index + 1} 行条件`}
                        aria-invalid={issue ? true : undefined}
                        className="font-mono"
                        value={line}
                        onChange={(event) => commit(draft.map((entry, at) => (at === index ? event.target.value : entry)))}
                      />
                      <IconButton label={`删除第 ${index + 1} 行条件`} size="icon-sm" onClick={() => commit(draft.filter((_, at) => at !== index))}>
                        <X aria-hidden="true" className="size-3.5" />
                      </IconButton>
                    </div>
                    {issue && <p role="alert" className="text-xs leading-relaxed text-ember">{issue}</p>}
                    {!issue && unused && <p className="text-xs leading-relaxed text-gold-bright">基础过滤器里没有用到条件「{field}」，请确认拼写。</p>}
                  </div>
                );
              })}
              {draft.length === 0 && <p className="text-xs leading-relaxed text-ember">没有条件时，这条规则匹配所有物品。</p>}
            </div>
          ) : (
            <ul className="space-y-0.5 font-mono text-xs leading-relaxed text-ink">
              {conditions.map((line, index) => (
                <li key={index} className="truncate" title={line}>{line}</li>
              ))}
            </ul>
          )}
        </div>
        {rule && !editingNow && (
          <p className="text-xs leading-relaxed text-ink-muted">
            {editsOn ? "条件是基础过滤器原本的写法。改过的条件整组替换原来的，规则在列表里的位置不变。" : "这是基础过滤器原本的写法。"}
          </p>
        )}
      </section>

      {rule && view && (
        <>
          {view.hidden && (
            <p className="border-y border-line bg-ember/6 px-1 py-2 text-xs leading-relaxed text-ember">
              这条规则会隐藏命中的物品；隐藏物品在游戏内按住 Alt 仍可见，所以下面的特效照样会生效。
            </p>
          )}
          <section aria-label="显示与特效" className="p-1 pt-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-xs font-semibold tracking-wide text-ink-muted">显示与特效</h3>
              <Switch checked={view.hidden} disabled={!editsOn} onCheckedChange={(hidden) => editBaseRule(rule.index, { hidden })} label="隐藏物品" />
            </div>
            <p className="mb-3 text-xs leading-relaxed text-ink-muted">
              {editsOn ? "留空的项沿用基础规则，占位文字是它现在的值；改过的项可以逐项恢复。" : "这是基础规则现在的显示和特效。"}
            </p>
            <fieldset className="grid min-w-0 gap-3 sm:grid-cols-2">
              <MapIconField
                className="sm:col-span-2"
                ruleName={name}
                value={effects.icon}
                beamColor={(effects.beam ?? rule.effects.beam)?.split(" ")[0]}
                inherited={inherited("icon")}
                onReset={effects.icon !== undefined ? () => reset("icon") : undefined}
                disabled={!editsOn}
                onChange={(icon) => editEffects({ icon })}
              />
              <BeamField
                ruleName={name}
                value={effects.beam}
                inherited={inherited("beam")}
                onReset={effects.beam !== undefined ? () => reset("beam") : undefined}
                disabled={!editsOn}
                onChange={(beam) => editEffects({ beam })}
              />
              <FontSizeField
                ruleName={name}
                value={font.fontSize}
                inherited={inherited("fontSize")}
                onReset={font.fontSize !== undefined ? () => reset("fontSize") : undefined}
                disabled={!editsOn}
                onChange={(fontSize) => editFont({ fontSize })}
              />
              {COLORS.map(([key, label]) => (
                <RgbColorField
                  key={key}
                  ruleName={name}
                  label={label}
                  value={font[key]}
                  inherited={inherited(key)}
                  onReset={font[key] !== undefined ? () => reset(key) : undefined}
                  disabled={!editsOn}
                  onChange={(value) => editFont({ [key]: value })}
                />
              ))}
              <SoundField
                ruleName={name}
                value={effects.sound}
                inherited={inherited("sound")}
                onReset={effects.sound !== undefined ? () => reset("sound") : undefined}
                disabled={!editsOn}
                customOptions={customSoundOptions(rules, customSounds, overlays)}
                onChange={(sound) => editEffects({ sound })}
                onReuse={(option) => edit && pickOverlaySound(edit.id, option)}
                onPickFile={(file) => editsOn && edit && file && setOverlaySound(edit.id, file)}
              />
            </fieldset>
          </section>
        </>
      )}

      {stale && (
        <section aria-label="这处修改的内容" className="border-t border-line p-1 pt-4">
          <h3 className="mb-3 text-xs font-semibold tracking-wide text-ink-muted">这处修改的内容</h3>
          <dl className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
            <dt className="text-ink-muted">显示</dt>
            <dd className="text-ink">{stale.hidden === undefined ? "不改" : stale.hidden ? "隐藏物品" : "显示物品"}</dd>
            <dt className="text-ink-muted">条件</dt>
            <dd className="min-w-0 text-ink [overflow-wrap:anywhere]">{stale.conditionLines === undefined ? "不改" : stale.conditionLines.join(" · ")}</dd>
            <dt className="text-ink-muted">特效</dt>
            <dd className="min-w-0 text-ink [overflow-wrap:anywhere]">{Object.keys(stale.effects).length ? describeEffects(stale.effects) : "不改"}</dd>
          </dl>
        </section>
      )}
    </div>
  );
}

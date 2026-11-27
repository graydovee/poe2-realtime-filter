"use client";

import { useRef } from "react";
import { Sparkles, Upload } from "lucide-react";

import { describeEffects, pickEffects } from "../../../lib/effect-labels";
import { customSoundOptions } from "../../../lib/sound-library";
import type { BaseFilter, EffectPreset, FilterRule, RuleEffects, RuleFont } from "../../../lib/types";
import { cn } from "../../../lib/cn";
import { ruleEffectsPending, shownRuleEffects } from "../../state/editor";
import { useAppStore } from "../../state/store";
import { buttonVariants, Button } from "../ui/button";
import { Disclosure } from "../ui/collapsible";
import { Field } from "../ui/field";
import { Input } from "../ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Select } from "../ui/select";
import { effectSourceLabel } from "./appearance-preview";
import { BeamField, MapIconField, RgbColorField } from "./appearance-fields";
import { PresetGallery } from "./preset-gallery";

const NONE = "__none";
const PICK_FILE = "__pick";
const CUSTOM_PREFIX = "custom:";

/** 「显示与特效」：完整特效预设，以及逐项的高级外观设置。 */
export function EffectSection({
  rule,
  presets,
  base,
}: {
  rule: FilterRule;
  presets: EffectPreset[];
  base?: BaseFilter;
}) {
  const baseInspection = useAppStore((state) => state.baseInspection);
  const awaitingEffects = useAppStore((state) => ruleEffectsPending(rule, state));
  const rules = useAppStore((state) => state.profile.rules);
  const customFile = useAppStore((state) => state.customSounds[rule.id]);
  const customSounds = useAppStore((state) => state.customSounds);
  const galleryOpen = useAppStore((state) => state.presetGalleryOpen);
  const setGalleryOpen = useAppStore((state) => state.setPresetGalleryOpen);
  const openPicker = useAppStore((state) => state.openPicker);
  const setRuleAppearance = useAppStore((state) => state.setRuleAppearance);
  const setRuleSound = useAppStore((state) => state.setRuleSound);
  const pickRuleSound = useAppStore((state) => state.pickRuleSound);
  const fileInput = useRef<HTMLInputElement>(null);

  const sourceId = rule.baselineEffectItemId;
  const inherited = sourceId ? baseInspection?.styles[sourceId] : undefined;
  const shownEffects = shownRuleEffects(rule, baseInspection);
  const font = shownEffects.font ?? {};
  const useBaseDefaults = base && (!sourceId || (inherited && !inherited.warning));
  const defaultStyleLabel = useBaseDefaults ? "沿用基础" : "游戏默认";
  const selected = sourceId
    ? presets.find((preset) => preset.sourceItemIds?.includes(sourceId))
    : presets.find((preset) => preset.id === rule.effectPresetId && !preset.sourceItemIds?.length &&
        JSON.stringify(pickEffects(preset)) === JSON.stringify(pickEffects({ id: "", ...shownEffects })));
  const summary = Object.keys(shownEffects).length ? describeEffects(shownEffects) : `${defaultStyleLabel}样式`;
  const sound = shownEffects.sound;
  const soundValue =
    !sound
      ? NONE
      : sound.type === "custom"
        ? CUSTOM_PREFIX + sound.fileName
        : sound.type === "builtin"
          ? "builtin:" + sound.id
          : "base:" + sound.fileName;
  // 方案里各条规则已经选过的自定义音效；当前这条规则的音效文件读不到时，也把名字列出来，看得出缺了什么。
  const customOptions = customSoundOptions(rules, customSounds);
  const customItems = [
    ...customOptions.map((option) => ({ value: CUSTOM_PREFIX + option.fileName, label: option.fileName })),
    ...(sound?.type === "custom" && !customOptions.some((option) => option.fileName === sound.fileName)
      ? [{ value: CUSTOM_PREFIX + sound.fileName, label: sound.fileName }]
      : []),
    { value: PICK_FILE, label: "选择文件" },
  ];

  function applyPreset(preset: EffectPreset) {
    const sources = preset.sourceItemIds ?? [];
    if (sources.length > 1) {
      setGalleryOpen(false);
      openPicker({ kind: "effect-source", ruleId: rule.id, itemIds: sources });
    } else if (sources.length === 1) {
      setRuleAppearance(rule.id, { itemId: sources[0] });
    } else {
      setRuleAppearance(rule.id, { effects: pickEffects(preset), presetId: preset.id });
    }
  }

  function editEffects(patch: Partial<RuleEffects>) {
    const next: RuleEffects = { ...shownEffects, ...patch };
    for (const key of Object.keys(next) as Array<keyof RuleEffects>) {
      const value = next[key];
      if (value === undefined || value === "" || (key === "font" && (!value || Object.keys(value).length === 0))) delete next[key];
    }
    setRuleAppearance(rule.id, { effects: next, file: customFile });
  }

  function editFont(patch: Partial<RuleFont>) {
    const next: RuleFont = { ...font, ...patch };
    for (const key of Object.keys(next) as Array<keyof RuleFont>) {
      if (next[key] === undefined || next[key] === "") delete next[key];
    }
    editEffects({ font: Object.keys(next).length ? next : undefined });
  }

  const colors = [
    ["textColor", "文字颜色"],
    ["borderColor", "边框颜色"],
    ["backgroundColor", "背景颜色"],
  ] as const;

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-line bg-surface-2 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h4 className="text-sm font-semibold text-ink">完整特效预设</h4>
            <p className="truncate text-xs text-ink-muted" title={awaitingEffects ? undefined : summary} role={awaitingEffects ? "status" : undefined}>
              {awaitingEffects ? "正在读取基础过滤器特效…" : summary}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {presets.length > 0 && <span className="font-mono text-xs text-ink-faint">{presets.length} 种可用</span>}
            <Popover open={galleryOpen} onOpenChange={setGalleryOpen}>
              <PopoverTrigger asChild>
                <Button size="sm" disabled={!presets.length}>
                  <Sparkles aria-hidden="true" />
                  选择预设
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-[min(44rem,calc(100vw-2rem))]" aria-label="特效预设">
                <PresetGallery presets={presets} selectedId={selected?.id} onSelect={applyPreset} />
              </PopoverContent>
            </Popover>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <p className="min-w-0 text-xs text-ink-muted [overflow-wrap:anywhere]">
            {sourceId ? `来源物品 · ${effectSourceLabel(sourceId)}` : "固定特效"}
          </p>
          <Button size="sm" variant="ghost" onClick={() => openPicker({ kind: "effect-source", ruleId: rule.id })}>
            {sourceId ? "更换来源物品" : "绑定来源物品"}
          </Button>
        </div>
        {sourceId && !base && <p className="mt-2 text-xs text-ink-muted">选择基础过滤器后，将使用此物品的特效。</p>}
        {sourceId && base && !awaitingEffects && (inherited?.warning || !inherited) && (
          <p className="mt-2 text-xs leading-relaxed text-ember">
            {inherited?.warning ?? "当前基础过滤器无法提供此物品的特效，暂用游戏默认样式。"}
          </p>
        )}
        {!presets.length && !awaitingEffects && (
          <p className="mt-2 text-xs leading-relaxed text-ink-muted">
            {base ? "当前基础过滤器没有可用预设。" : "选择基础过滤器后，可以套用它自带的特效预设。"}
          </p>
        )}
      </div>

      <div className="rounded-md border border-line">
        <Disclosure summary="高级外观设置" className="px-3" contentClassName="pb-4">
          <p className="mb-3 text-xs leading-relaxed text-ink-muted">
            留空的项{useBaseDefaults ? "沿用基础过滤器" : "使用游戏默认样式"}。{sourceId && "修改任意一项后，当前特效会固定下来。"}
          </p>
          <fieldset disabled={awaitingEffects} className="grid min-w-0 gap-3 sm:grid-cols-2">
            <MapIconField
              className="sm:col-span-2"
              ruleName={rule.name}
              value={shownEffects.icon}
              beamColor={shownEffects.beam?.split(" ")[0]}
              defaultLabel={defaultStyleLabel}
              onChange={(icon) => editEffects({ icon })}
            />
            <BeamField
              ruleName={rule.name}
              value={shownEffects.beam}
              defaultLabel={defaultStyleLabel}
              onChange={(beam) => editEffects({ beam })}
            />
            <Field label="字号" hint="18–45">
              <Input
                type="number"
                min={1}
                max={45}
                aria-label={`${rule.name} 字号`}
                placeholder={defaultStyleLabel}
                value={font.fontSize ?? ""}
                onChange={(event) => editFont({ fontSize: event.target.value === "" ? undefined : Number(event.target.value) })}
              />
            </Field>
            {colors.map(([key, label]) => (
              <RgbColorField
                key={key}
                ruleName={rule.name}
                label={label}
                value={font[key]}
                defaultLabel={defaultStyleLabel}
                onChange={(value) => editFont({ [key]: value })}
              />
            ))}
            <Field label="音效">
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    className="min-w-0 flex-1 basis-40"
                    ariaLabel={`${rule.name} 音效`}
                    value={soundValue}
                    onValueChange={(value) => {
                      if (value === NONE) editEffects({ sound: undefined });
                      else if (value === PICK_FILE) fileInput.current?.click();
                      else if (value.startsWith(CUSTOM_PREFIX)) {
                        const option = customOptions.find((entry) => CUSTOM_PREFIX + entry.fileName === value);
                        if (option) pickRuleSound(rule.id, option);
                      } else if (value.startsWith("builtin:")) {
                        const id = Number(value.slice(8));
                        editEffects({ sound: sound?.type === "builtin" && sound.id === id ? sound : { type: "builtin", id, volume: 300 } });
                      }
                    }}
                    options={[
                      { value: NONE, label: defaultStyleLabel },
                      ...(soundValue.startsWith("base:")
                        ? [{ value: soundValue, label: "基础过滤器音效 · " + soundValue.slice(5) }]
                        : []),
                    ]}
                    groups={[
                      { label: "自定义音效", options: customItems },
                      {
                        label: "内置音效",
                        options: Array.from({ length: 16 }, (_, index) => ({ value: "builtin:" + (index + 1), label: "内置音效 " + (index + 1) })),
                      },
                    ]}
                  />
                  <label className="inline-flex shrink-0 cursor-pointer">
                    <input
                      ref={fileInput}
                      type="file"
                      className="peer sr-only"
                      accept="audio/mpeg,audio/wav,audio/ogg"
                      aria-label={`${rule.name} 自定义音效`}
                      onChange={(event) => {
                        setRuleSound(rule.id, event.target.files?.[0]);
                        event.target.value = "";
                      }}
                    />
                    <span className={cn(buttonVariants({ size: "sm" }), "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-gold-bright")}>
                      <Upload aria-hidden="true" />
                      选择文件
                    </span>
                  </label>
                </div>
                {!base && !sourceId && (sound?.type === "neversink" || sound?.type === "baseline") && (
                  <p className="text-xs text-ember">请选择内置音效或自定义音效，替换「{sound.fileName}」。</p>
                )}
              </div>
            </Field>
          </fieldset>
        </Disclosure>
      </div>
    </div>
  );
}

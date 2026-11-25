"use client";

import { Sparkles, Upload } from "lucide-react";

import { describeEffects, pickEffects } from "../../../lib/effect-labels";
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
import { PresetGallery } from "./preset-gallery";

const NONE = "__none";
const CUSTOM_SOUND = "__custom";

function ColorSwatch({ color }: { color?: string }) {
  const parts = (color ?? "").split(/\s+/).map(Number);
  const valid = parts.length >= 3 && parts.slice(0, 3).every((value) => Number.isFinite(value));
  return (
    <span
      aria-hidden="true"
      title={color || "沿用基础样式"}
      className="grid size-8 shrink-0 place-items-center rounded-md border border-line bg-surface-3"
    >
      <span
        className="size-4 rounded-sm border border-line-strong/60"
        style={{ background: valid ? "rgb(" + parts.slice(0, 3).join(",") + ")" : "transparent" }}
      />
    </span>
  );
}

function SoundUpload({ label, fileName, onFile }: { label: string; fileName: string; onFile: (file: File | undefined) => void }) {
  return (
    <label className="flex min-w-0 cursor-pointer flex-wrap items-center gap-2">
      <input
        type="file"
        className="peer sr-only"
        accept="audio/mpeg,audio/wav,audio/ogg"
        aria-label={label}
        onChange={(event) => onFile(event.target.files?.[0])}
      />
      <span className={cn(buttonVariants({ size: "sm" }), "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-gold-bright")}>
        <Upload aria-hidden="true" />
        上传音效
      </span>
      <span className="min-w-0 max-w-48 truncate font-mono text-xs text-ink-muted">{fileName}</span>
    </label>
  );
}

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
  const customFile = useAppStore((state) => state.customSounds[rule.id]);
  const galleryOpen = useAppStore((state) => state.presetGalleryOpen);
  const setGalleryOpen = useAppStore((state) => state.setPresetGalleryOpen);
  const openPicker = useAppStore((state) => state.openPicker);
  const setRuleAppearance = useAppStore((state) => state.setRuleAppearance);
  const setRuleSound = useAppStore((state) => state.setRuleSound);

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
        ? CUSTOM_SOUND
        : sound.type === "builtin"
          ? "builtin:" + sound.id
          : "base:" + sound.fileName;

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
            <Field label="光柱">
              <Input
                aria-label={`${rule.name} 光柱`}
                placeholder={`PlayEffect，留空使用${defaultStyleLabel === "沿用基础" ? "基础样式" : "游戏默认样式"}`}
                value={shownEffects.beam ?? ""}
                onChange={(event) => editEffects({ beam: event.target.value })}
              />
            </Field>
            <Field label="地图图标">
              <Input
                aria-label={`${rule.name} 地图图标`}
                placeholder={`MinimapIcon，${defaultStyleLabel}`}
                value={shownEffects.icon ?? ""}
                onChange={(event) => editEffects({ icon: event.target.value })}
              />
            </Field>
            <Field label="字号" hint="18–45">
              <div className="flex gap-2">
                <Input
                  type="number"
                  min={1}
                  max={45}
                  aria-label={`${rule.name} 字号`}
                  placeholder={defaultStyleLabel}
                  value={font.fontSize ?? ""}
                  onChange={(event) => editFont({ fontSize: event.target.value === "" ? undefined : Number(event.target.value) })}
                />
                <ColorSwatch color={font.textColor} />
              </div>
            </Field>
            {colors.map(([key, label]) => (
              <Field key={key} label={label}>
                <div className="flex gap-2">
                  <Input
                    aria-label={`${rule.name} ${label}`}
                    placeholder={`R G B (A)，${defaultStyleLabel}`}
                    value={font[key] ?? ""}
                    onChange={(event) => editFont({ [key]: event.target.value })}
                  />
                  <ColorSwatch color={font[key]} />
                </div>
              </Field>
            ))}
            <Field label="音效" className="sm:col-span-2">
              <div className="flex flex-col gap-2">
                <Select
                  ariaLabel={`${rule.name} 音效`}
                  value={soundValue}
                  onValueChange={(value) => {
                    if (value === NONE) editEffects({ sound: undefined });
                    else if (value === CUSTOM_SOUND)
                      editEffects({ sound: { type: "custom", fileName: sound?.type === "custom" ? sound.fileName : "" } });
                    else if (value.startsWith("builtin:")) {
                      const id = Number(value.slice(8));
                      editEffects({ sound: sound?.type === "builtin" && sound.id === id ? sound : { type: "builtin", id, volume: 300 } });
                    }
                  }}
                  options={[
                    { value: NONE, label: defaultStyleLabel },
                    ...Array.from({ length: 16 }, (_, index) => ({ value: "builtin:" + (index + 1), label: "内置音效 " + (index + 1) })),
                    ...(soundValue.startsWith("base:")
                      ? [{ value: soundValue, label: "基础过滤器音效 · " + soundValue.slice(5) }]
                      : []),
                    { value: CUSTOM_SOUND, label: "自定义上传…" },
                  ]}
                />
                {!base && !sourceId && (sound?.type === "neversink" || sound?.type === "baseline") && (
                  <p className="text-xs text-ember">请选择内置音效或上传音效，替换「{sound.fileName}」。</p>
                )}
                {sound?.type === "custom" && (
                  <SoundUpload
                    label={`${rule.name} 自定义音效`}
                    fileName={customFile?.name || sound.fileName || "选择 mp3 / wav / ogg"}
                    onFile={(file) => setRuleSound(rule.id, file)}
                  />
                )}
              </div>
            </Field>
          </fieldset>
        </Disclosure>
      </div>
    </div>
  );
}

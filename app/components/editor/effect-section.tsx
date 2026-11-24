"use client";

import { Sparkles, Upload } from "lucide-react";

import { DEFAULT_EFFECT_ITEMS } from "../../../lib/baseline-effects";
import { describeEffects, pickEffects } from "../../../lib/effect-labels";
import type { BaseFilter, EffectPreset, FilterRule, RuleEffects, RuleFont } from "../../../lib/types";
import { cn } from "../../../lib/cn";
import { useAppStore } from "../../state/store";
import { buttonVariants, Button } from "../ui/button";
import { Disclosure } from "../ui/collapsible";
import { Field } from "../ui/field";
import { Input } from "../ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Select } from "../ui/select";
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
  onChange,
  onSound,
}: {
  rule: FilterRule;
  presets: EffectPreset[];
  base?: BaseFilter;
  onChange: (patch: Partial<FilterRule>) => void;
  onSound: (file: File | undefined) => void;
}) {
  const inherited = useAppStore((state) => state.baseInspection?.styles[rule.id]);
  const customFile = useAppStore((state) => (rule.effects.sound?.type === "custom" ? state.customSounds[rule.id] : undefined));
  const galleryOpen = useAppStore((state) => state.presetGalleryOpen);
  const setGalleryOpen = useAppStore((state) => state.setPresetGalleryOpen);

  const canFollow = Object.prototype.hasOwnProperty.call(DEFAULT_EFFECT_ITEMS, rule.id);
  // 默认价格档还没自定义过特效：沿用基础过滤器里对应通货的样式，界面上就当它是当前选中的预设。
  const following = Boolean(rule.followBaseline);
  const shownEffects = following ? inherited?.effects ?? {} : rule.effects;
  const font = shownEffects.font ?? {};
  const defaultStyleLabel = base ? "沿用基础" : "游戏默认";
  const selected = presets.find((preset) => JSON.stringify(pickEffects(preset)) === JSON.stringify(pickEffects({ id: "", ...shownEffects })));
  const summary = selected
    ? describeEffects(pickEffects(selected))
    : following ? (base ? "基础过滤器里对应通货的样式" : "游戏默认样式") : "自定义外观";
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
    onChange({ effectPresetId: preset.id, effects: pickEffects(preset), ...(canFollow ? { followBaseline: false } : {}) });
  }

  function editEffects(patch: Partial<RuleEffects>) {
    const next: RuleEffects = { ...shownEffects, ...patch };
    for (const key of Object.keys(next) as Array<keyof RuleEffects>) {
      const value = next[key];
      if (value === undefined || value === "" || (key === "font" && (!value || Object.keys(value).length === 0))) delete next[key];
    }
    onChange({ effectPresetId: undefined, effects: next, ...(canFollow ? { followBaseline: false } : {}) });
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
            <p className="truncate text-xs text-ink-muted" title={summary}>
              {summary}
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
        {following && inherited?.warning && <p className="mt-2 text-xs leading-relaxed text-ember">{inherited.warning}</p>}
        {following && selected && (
          <p className="mt-2 text-xs leading-relaxed text-ink-muted">
            默认沿用基础过滤器里这类通货的样式。换一个预设或修改任意一项后，这条规则改用自己的特效。
          </p>
        )}
        {!presets.length && (
          <p className="mt-2 text-xs leading-relaxed text-ink-muted">
            {base ? "当前基础过滤器没有可用预设，可在下方手动设置外观。" : "选择基础过滤器后，可以套用它自带的特效预设。"}
          </p>
        )}
      </div>

      <div className="rounded-md border border-line">
        <Disclosure summary="高级外观设置" className="px-3" contentClassName="pb-4">
          <p className="mb-3 text-xs leading-relaxed text-ink-muted">
            留空的项{defaultStyleLabel === "沿用基础" ? "沿用基础过滤器" : "使用游戏默认样式"}。修改任意一项后，这条规则不再匹配完整预设。
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
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
                      editEffects({ sound: { type: "custom", fileName: rule.effects.sound?.type === "custom" ? rule.effects.sound.fileName : "" } });
                    else if (value.startsWith("builtin:")) {
                      const id = Number(value.slice(8));
                      editEffects({
                        sound: {
                          type: "builtin",
                          id,
                          volume: rule.effects.sound?.type === "builtin" && rule.effects.sound.id === id ? rule.effects.sound.volume : 300,
                        },
                      });
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
                {!base && !rule.followBaseline && (rule.effects.sound?.type === "neversink" || rule.effects.sound?.type === "baseline") && (
                  <p className="text-xs text-ember">请选择内置音效或上传音效，替换「{rule.effects.sound.fileName}」。</p>
                )}
                {rule.effects.sound?.type === "custom" && (
                  <SoundUpload
                    label={`${rule.name} 自定义音效`}
                    fileName={customFile?.name || rule.effects.sound.fileName || "选择 mp3 / wav / ogg"}
                    onFile={onSound}
                  />
                )}
              </div>
            </Field>
          </div>
        </Disclosure>
      </div>
    </div>
  );
}

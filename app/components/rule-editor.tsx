"use client";

import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";

import { EFFECT_PRESETS } from "../../lib/data";
import { CURRENCY_ANCHORS, formatPrice, toExalted } from "../../lib/pricing";
import type { Currency, FilterRule, Locale, MarketSnapshot, PresetSound, PricePoint, RuleFont } from "../../lib/types";
import { cn } from "../../lib/cn";
import { ItemPicker, type ItemPickerToggle } from "./item-picker";
import { Checkbox, FileInput, Select, Switch, TextInput } from "./ui/controls";
import { Disclosure } from "./ui/nav";
import { Button, Field } from "./ui/primitives";

const currencyLabels: Record<Currency, string> = { divine: "D · 神圣石", chaos: "C · 混沌石", exalted: "E · 崇高石" };
const NONE = "__inherit";
const CUSTOM = "__custom";

const hex = (color?: string) => {
  if (!color) return "—";
  const parts = color.split(/\s+/).map(Number);
  if (parts.length < 3 || parts.some((part) => !Number.isFinite(part))) return color;
  return "#" + parts.slice(0, 3).map((value) => value.toString(16).padStart(2, "0")).join("");
};

const soundLabel = (sound: PresetSound) =>
  sound.type === "builtin" ? "内置 " + sound.id + " · 音量 " + sound.volume : sound.fileName;

export function RuleEditor({
  rule,
  index,
  total,
  locale,
  market,
  customFile,
  onChange,
  onRemove,
  onMove,
  onSound,
}: {
  rule: FilterRule;
  index: number;
  total: number;
  locale: Locale;
  market: MarketSnapshot;
  customFile?: File;
  onChange: (patch: Partial<FilterRule>) => void;
  onRemove: () => void;
  onMove: (delta: number) => void;
  onSound: (file: File | undefined) => void;
}) {
  const font = rule.effects.font ?? {};
  const fontOptions = EFFECT_PRESETS.fonts
    .filter((candidate) => font.fontSize === undefined || candidate.fontSize === font.fontSize)
    .map((candidate) => ({ value: JSON.stringify(candidate), label: fontLabel(candidate) }));
  const currentFont = rule.effects.font && Object.keys(rule.effects.font).length ? JSON.stringify(rule.effects.font) : NONE;
  const soundValue = !rule.effects.sound ? NONE : rule.effects.sound.type === "custom" ? CUSTOM : rule.effects.sound.type === "neversink" ? "neversink:" + rule.effects.sound.fileName : "builtin:" + rule.effects.sound.id;

  function patchEffects(patch: Partial<FilterRule["effects"]>) {
    onChange({ effects: { ...rule.effects, ...patch } });
  }

  function patchFont(patch: Partial<RuleFont>) {
    const next: RuleFont = { ...font, ...patch };
    for (const key of Object.keys(next) as Array<keyof RuleFont>) {
      if (next[key] === undefined || next[key] === "") delete next[key];
    }
    patchEffects({ font: Object.keys(next).length ? next : undefined });
  }

  function patchTarget(patch: Partial<FilterRule["target"]>) {
    onChange({ target: { ...rule.target, ...patch } });
  }

  return (
    <div className={cn("rounded-sm border p-4 transition", rule.enabled ? "border-gold/40 bg-gold/[0.04]" : "border-line bg-surface-2/40")}>
      <div className="flex flex-wrap items-center gap-3">
        <Checkbox checked={rule.enabled} onCheckedChange={(enabled) => onChange({ enabled })} label="启用" className="min-w-[4.5rem]" />
        <TextInput
          aria-label={"规则 " + (index + 1) + " 名称"}
          className="h-8 min-w-0 flex-1 py-1 text-xs"
          value={rule.name}
          onChange={(event) => onChange({ name: event.target.value })}
        />
        <Switch checked={rule.hidden} onCheckedChange={(hidden) => onChange({ hidden })} label="隐藏物品" />
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" aria-label="上移规则" disabled={index === 0} onClick={() => onMove(-1)}>
            <ArrowUp aria-hidden="true" className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon" aria-label="下移规则" disabled={index === total - 1} onClick={() => onMove(1)}>
            <ArrowDown aria-hidden="true" className="size-3.5" />
          </Button>
          <Button variant="danger" size="icon" aria-label={"删除 " + rule.name} onClick={onRemove}>
            <Trash2 aria-hidden="true" className="size-3.5" />
          </Button>
        </div>
      </div>

      {rule.hidden && (
        <p className="mt-2 text-[11px] leading-relaxed text-ember/90">
          这条规则会隐藏命中的物品；隐藏物品在游戏内按住 Alt 仍可见，所以下面的特效照样会生效。
        </p>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-3 rounded-sm border border-line/70 bg-surface-2/40 p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] font-medium text-ink">适用物品</span>
            <span className="font-mono text-[10px] text-ink-muted">{rule.target.itemIds.length ? rule.target.itemIds.length + " 项" : "未选择"}</span>
          </div>
          <Disclosure summary={rule.target.itemIds.length ? "修改物品选择（" + rule.target.itemIds.length + " 项）" : "选择物品（可选）"} className="rounded-sm border border-line/60 px-3 py-2">
            <div className="pt-3">
              <ItemPicker
                locale={locale}
                entries={rule.target.itemIds.length ? [{ id: "rule-items", label: "规则物品", itemIds: rule.target.itemIds }] : []}
                onToggle={(toggle: ItemPickerToggle) => {
                  const current = new Set(rule.target.itemIds);
                  for (const id of toggle.ids) {
                    if (toggle.checked) current.add(id);
                    else current.delete(id);
                  }
                  patchTarget({ itemIds: [...current] });
                }}
                onRemoveEntry={() => patchTarget({ itemIds: [] })}
              />
            </div>
          </Disclosure>
          <p className="text-[10px] leading-relaxed text-ink-muted/85">不选物品 = 规则对所有物品生效（配合价格区间使用）。</p>
        </div>

        <div className="flex flex-col gap-3 rounded-sm border border-line/70 bg-surface-2/40 p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] font-medium text-ink">价格区间</span>
            {rule.autoRange ? (
              <span className="font-mono text-[10px] text-gold">跟随市价</span>
            ) : (
              <span className="font-mono text-[10px] text-ink-muted">固定价格</span>
            )}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <PriceBoundEditor label="下限（含）" point={rule.target.range?.min} market={market} autoRange={rule.autoRange} onChange={(point) => onChange({ autoRange: false, target: { ...rule.target, range: { ...rule.target.range, min: point } } })} />
            <PriceBoundEditor label="上限（不含）" point={rule.target.range?.max} market={market} autoRange={rule.autoRange} onChange={(point) => onChange({ autoRange: false, target: { ...rule.target, range: { ...rule.target.range, max: point } } })} />
          </div>
          {rule.autoRange ? (
            <Button variant="secondary" size="sm" disabled={!rule.target.range?.min} onClick={() => onChange({ autoRange: false })}>
              改为固定价格
            </Button>
          ) : (
            <p className="text-[10px] leading-relaxed text-ink-muted/85">留空上限表示不封顶；两条规则区间重叠时，列表靠前的那条先生效。</p>
          )}
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="光柱">
          <div className="flex gap-2">
            <Select
              ariaLabel={rule.name + " 光柱预设"}
              className="flex-1"
              value={rule.effects.beam ?? NONE}
              onValueChange={(value) => patchEffects({ beam: value === NONE ? undefined : value })}
              options={[{ value: NONE, label: "不设置（沿用基础）" }, ...EFFECT_PRESETS.beams.map((beam) => ({ value: beam, label: beam }))]}
            />
            <TextInput
              className="w-28 shrink-0"
              aria-label={rule.name + " 光柱值"}
              placeholder="PlayEffect"
              value={rule.effects.beam ?? ""}
              onChange={(event) => patchEffects({ beam: event.target.value || undefined })}
            />
          </div>
        </Field>

        <Field label="地图图标">
          <div className="flex gap-2">
            <Select
              ariaLabel={rule.name + " 地图图标预设"}
              className="flex-1"
              value={rule.effects.icon ?? NONE}
              onValueChange={(value) => patchEffects({ icon: value === NONE ? undefined : value })}
              options={[{ value: NONE, label: "不设置（沿用基础）" }, ...EFFECT_PRESETS.icons.map((icon) => ({ value: icon, label: icon }))]}
            />
            <TextInput
              className="w-32 shrink-0"
              aria-label={rule.name + " 地图图标值"}
              placeholder="MinimapIcon"
              value={rule.effects.icon ?? ""}
              onChange={(event) => patchEffects({ icon: event.target.value || undefined })}
            />
          </div>
        </Field>

        <Field label="字体预设" hint="选中后会把字号和三种颜色一起填好，之后可以继续改。">
          <Select
            ariaLabel={rule.name + " 字体预设"}
            value={currentFont}
            onValueChange={(value) => {
              if (value === NONE) patchEffects({ font: undefined });
              else patchEffects({ font: JSON.parse(value) as RuleFont });
            }}
            options={[{ value: NONE, label: "不设置（沿用基础）" }, ...fontOptions]}
          />
        </Field>

        <Field label="字号" hint="18–45">
          <div className="flex gap-2">
            <TextInput
              type="number"
              min={18}
              max={45}
              aria-label={rule.name + " 字号"}
              value={font.fontSize ?? ""}
              placeholder="沿用基础"
              onChange={(event) => patchFont({ fontSize: event.target.value === "" ? undefined : Number(event.target.value) })}
            />
            <ColorSwatch color={font.textColor} />
          </div>
        </Field>

        {(
          [
            ["textColor", "文字颜色"],
            ["borderColor", "边框颜色"],
            ["backgroundColor", "背景颜色"],
          ] as const
        ).map(([key, label]) => (
          <Field key={key} label={label}>
            <div className="flex gap-2">
              <TextInput
                aria-label={rule.name + " " + label}
                placeholder="R G B (A)，留空沿用基础"
                value={font[key] ?? ""}
                onChange={(event) => patchFont({ [key]: event.target.value || undefined })}
              />
              <ColorSwatch color={font[key]} />
            </div>
          </Field>
        ))}

        <Field label="音效">
          <div className="flex flex-col gap-2">
            <Select
              ariaLabel={rule.name + " 音效预设"}
              value={soundValue}
              onValueChange={(value) => {
                if (value === NONE) patchEffects({ sound: undefined });
                else if (value === CUSTOM) patchEffects({ sound: { type: "custom", fileName: rule.effects.sound?.type === "custom" ? rule.effects.sound.fileName : "" } });
                else if (value.startsWith("builtin:")) patchEffects({ sound: { type: "builtin", id: Number(value.slice(8)), volume: 300 } });
                else patchEffects({ sound: { type: "neversink", fileName: value.slice(10) } });
              }}
              options={[
                { value: NONE, label: "不设置（沿用基础）" },
                ...Array.from({ length: 6 }, (_, index) => ({ value: "builtin:" + (index + 1), label: "内置音效 " + (index + 1) + " · 音量 300" })),
                ...EFFECT_PRESETS.customSounds.map((fileName) => ({ value: "neversink:" + fileName, label: "模板音效 · " + fileName })),
                { value: CUSTOM, label: "自定义上传…" },
              ]}
            />
            {rule.effects.sound?.type === "custom" && (
              <FileInput
                label={rule.name + " 自定义音效"}
                accept="audio/mpeg,audio/wav,audio/ogg"
                fileName={customFile?.name || rule.effects.sound.fileName || "选择 mp3 / wav / ogg"}
                onFile={onSound}
              />
            )}
            <span className="font-mono text-[10px] text-ink-muted/85">当前：{rule.effects.sound ? soundLabel(rule.effects.sound) : "沿用基础过滤器"}</span>
          </div>
        </Field>
      </div>
    </div>
  );
}

function fontLabel(font: RuleFont) {
  return "字号 " + (font.fontSize ?? "—") + " · " + hex(font.textColor) + " / " + hex(font.borderColor) + " / " + hex(font.backgroundColor);
}

function ColorSwatch({ color }: { color?: string }) {
  const parts = (color ?? "").split(/\s+/).map(Number);
  const valid = parts.length >= 3 && parts.slice(0, 3).every((value) => Number.isFinite(value));
  return (
    <span
      aria-hidden="true"
      className="grid size-10 shrink-0 place-items-center rounded-sm border border-line bg-surface-3"
      title={color || "沿用基础"}
    >
      <span className="size-6 rounded-sm border border-line/60" style={{ background: valid ? "rgb(" + parts.slice(0, 3).join(",") + ")" : "transparent" }} />
    </span>
  );
}

function PriceBoundEditor({ label, point, market, autoRange, onChange }: { label: string; point?: PricePoint; market: MarketSnapshot; autoRange?: boolean; onChange: (point?: PricePoint) => void }) {
  if (point?.referenceItemId) {
    const value = toExalted(point, market.rates, market.prices);
    return (
      <div className="flex flex-col gap-1.5 rounded-sm border border-line bg-surface-2/60 px-3 py-2.5">
        <span className="text-[11px] text-ink-muted">{label}</span>
        <strong className="font-mono text-xs font-medium text-ink">{formatPrice(point, market)}</strong>
        {!autoRange && (
          <Button variant="secondary" size="sm" disabled={value === undefined} onClick={() => onChange({ amount: value!, currency: "exalted" })}>
            改为固定价格
          </Button>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1.5 rounded-sm border border-line bg-surface-2/60 px-3 py-2.5">
      <span className="text-[11px] text-ink-muted">{label}</span>
      <div className="flex gap-2">
        <TextInput
          type="number"
          min={0}
          step={0.01}
          placeholder="不限"
          aria-label={label + "数值"}
          className="h-9 min-w-0 py-1 text-xs"
          value={point?.amount ?? ""}
          onChange={(event) => onChange(event.target.value === "" ? undefined : { amount: Number(event.target.value), currency: point?.currency ?? "divine" })}
        />
        <Select
          value={point?.currency ?? "divine"}
          onValueChange={(currency) => onChange({ amount: point?.amount ?? 0, currency: currency as Currency })}
          ariaLabel={label + "单位"}
          className="h-9 w-[8.5rem] shrink-0 py-1 text-xs"
          options={Object.entries(currencyLabels).map(([value, name]) => ({ value, label: name }))}
        />
      </div>
    </div>
  );
}

"use client";

import { ExternalLink, RotateCcw } from "lucide-react";

import { CURRENCY_ANCHORS, formatPrice, toExalted } from "../../lib/pricing";
import { NEVERSINK_VERSION, templateAppearance } from "../../lib/neversink-appearance";
import type { TemplateSelection } from "../../lib/neversink-appearance";
import type { Currency, MarketSnapshot, PricePoint, VisualPreset } from "../../lib/types";
import { cn } from "../../lib/cn";
import { Checkbox, FileInput, Select, TextInput } from "./ui/controls";
import { Disclosure } from "./ui/nav";
import { Button, Field } from "./ui/primitives";

const currencyLabels: Record<Currency, string> = { divine: "D · 神圣石", chaos: "C · 混沌石", exalted: "E · 崇高石" };
const effectNames: Record<string, string> = {
  Red: "红色",
  Orange: "橙色",
  Yellow: "黄色",
  Green: "绿色",
  Blue: "蓝色",
  Cyan: "青色",
  Purple: "紫色",
  Pink: "粉色",
  White: "白色",
  Brown: "棕色",
  Grey: "灰色",
};
const effectColors: Record<string, string> = {
  Red: "#ff4040",
  Orange: "#ff9c38",
  Yellow: "#ffe14d",
  Green: "#6bdc68",
  Blue: "#4995ff",
  Cyan: "#5ee4eb",
  Purple: "#b380f5",
  Pink: "#ff91cb",
  White: "#fff",
  Brown: "#a87950",
  Grey: "#9a9a9a",
};
const shapes: Record<string, string> = {
  Circle: "圆形",
  Star: "星形",
  Diamond: "菱形",
  Square: "方形",
  Pentagon: "五边形",
  Hexagon: "六边形",
  Triangle: "三角形",
  Cross: "十字",
  Kite: "风筝形",
  UpsideDownHouse: "倒屋形",
};

function rgba(value?: string, fallback = "transparent") {
  if (!value) return fallback;
  const parts = value.split(/\s+/).map(Number);
  if (parts.length < 3 || parts.some((part) => !Number.isFinite(part))) return fallback;
  return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${(parts[3] ?? 255) / 255})`;
}

function AppearancePreview({ preset, itemName }: { preset: VisualPreset; itemName: string }) {
  const [iconSize, iconColor, shape] = preset.minimapIcon?.split(" ") ?? [];
  const [beam, temporary] = preset.effect.split(" ");
  const beamColor = effectColors[beam] || "transparent";
  return (
    <div className="grid gap-4 rounded-sm border border-line bg-surface-2/50 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(11rem,0.85fr)]">
      <div className="loot-scene border border-line/70">
        <span
          aria-hidden="true"
          className="loot-beam"
          style={{ background: "linear-gradient(to bottom, " + beamColor + ", transparent 78%)" }}
        />
        <span
          className="loot-label"
          style={{
            color: rgba(preset.textColor, "#c8c8c8"),
            borderColor: rgba(preset.borderColor),
            backgroundColor: rgba(preset.backgroundColor, "rgba(0,0,0,.7)"),
          }}
        >
          {itemName}
        </span>
        {shape && (
          <svg
            viewBox="0 0 24 24"
            className="loot-icon"
            style={{ color: effectColors[iconColor] }}
            aria-label={(effectNames[iconColor] || iconColor) + (shapes[shape] || shape)}
          >
            {shape === "Star" ? (
              <path fill="currentColor" d="m12 1 3.1 7.1 7.8.7-5.9 5.1 1.8 7.6L12 17.5 5.2 21.5 7 13.9 1.1 8.8l7.8-.7z" />
            ) : shape === "Circle" ? (
              <circle cx="12" cy="12" r="9" fill="currentColor" />
            ) : (
              <path d="M12 2 22 12 12 22 2 12z" fill="currentColor" />
            )}
          </svg>
        )}
      </div>
      <dl className="grid grid-cols-[3.5rem_minmax(0,1fr)] content-center gap-x-3 gap-y-2 text-[11px] leading-relaxed">
        <dt className="text-ink-muted">光柱</dt>
        <dd className="text-ink/90">
          {effectNames[beam] || beam}
          {temporary ? "（临时）" : ""}
        </dd>
        <dt className="text-ink-muted">地图图标</dt>
        <dd className="text-ink/90">
          {shape ? (effectNames[iconColor] || iconColor) + (shapes[shape] || shape) + " · 尺寸 " + iconSize : "无"}
        </dd>
        <dt className="text-ink-muted">字体</dt>
        <dd className="text-ink/90">{preset.fontSize || "游戏默认"}</dd>
        <dt className="text-ink-muted">音效</dt>
        <dd className="text-ink/90">
          {preset.sound.type === "builtin" ? "内置 " + preset.sound.id + " · 音量 " + preset.sound.volume : preset.sound.fileName}
        </dd>
      </dl>
    </div>
  );
}

export function PresetEditor({
  preset,
  template,
  market,
  customFile,
  onChange,
  onRemove,
  onSound,
}: {
  preset: VisualPreset;
  template: TemplateSelection;
  market: MarketSnapshot;
  customFile?: File;
  onChange: (patch: Partial<VisualPreset>) => void;
  onRemove: () => void;
  onSound: (file: File | undefined) => void;
}) {
  const range = preset.range;
  const appearanceId = preset.appearanceItemId ?? preset.sourceItemId;
  const original = preset.followTemplate !== false ? templateAppearance(template, appearanceId) : undefined;
  const itemName = appearanceId ? CURRENCY_ANCHORS[appearanceId] || preset.name : preset.name;

  function chooseAppearance(id: string) {
    if (id === "custom") {
      onChange({ ...preset, followTemplate: false });
      return;
    }
    const selected = templateAppearance(template, id);
    if (selected) onChange({ appearanceItemId: id, followTemplate: true, sound: selected.sound });
  }

  function customize(patch: Partial<VisualPreset>) {
    onChange({ ...preset, ...patch, followTemplate: false });
  }

  return (
    <div
      className={cn(
        "rounded-sm border p-4 transition",
        preset.enabled ? "border-gold/40 bg-gold/[0.04]" : "border-line bg-surface-2/40",
      )}
    >
      <div className="flex flex-wrap items-center gap-3">
        <Checkbox checked={preset.enabled} onCheckedChange={(enabled) => onChange({ enabled })} label="启用" className="min-w-[4.5rem]" />
        <TextInput
          aria-label={preset.name + "规则名称"}
          className="h-8 flex-1 py-1 text-xs"
          value={preset.name}
          onChange={(event) => onChange({ name: event.target.value })}
        />
        <Button variant="danger" size="sm" onClick={onRemove} aria-label={"删除 " + preset.name}>
          删除
        </Button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] sm:items-end">
        <Field label="通货样式">
          <Select
            value={original ? appearanceId ?? "custom" : "custom"}
            onValueChange={chooseAppearance}
            ariaLabel={preset.name + " 通货样式"}
            options={[
              ...Object.entries(CURRENCY_ANCHORS).map(([id, label]) => ({ value: id, label: label + "原始样式" })),
              { value: "custom", label: "自定义样式" },
            ]}
          />
        </Field>
        {original && (
          <a
            href={original.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 pb-2.5 text-[11px] text-ink-muted underline decoration-line-strong underline-offset-4 transition hover:text-gold"
          >
            NeverSink {NEVERSINK_VERSION} · 查看原始规则
            <ExternalLink aria-hidden="true" className="size-3" />
          </a>
        )}
      </div>

      <div className="mt-3">
        <AppearancePreview preset={preset} itemName={itemName} />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <PriceBoundEditor
          label="下限（含）"
          point={range.min}
          market={market}
          onChange={(point) => onChange({ autoRange: false, range: { ...range, min: point } })}
        />
        <PriceBoundEditor
          label="上限（不含）"
          point={range.max}
          market={market}
          onChange={(point) => onChange({ autoRange: false, range: { ...range, max: point } })}
        />
      </div>

      <Disclosure summary="自定义外观" className="mt-2 border-t border-line/60">
        <div className="grid gap-3 pb-1 sm:grid-cols-2">
          <Field label="光柱颜色">
            <Select
              value={preset.effect}
              onValueChange={(effect) => customize({ effect })}
              ariaLabel={preset.name + " 光柱颜色"}
              options={Object.entries(effectNames)
                .filter(([key]) => key !== "Grey")
                .flatMap(([key, label]) => [
                  { value: key, label },
                  { value: key + " Temp", label: label + "（临时）" },
                ])}
            />
          </Field>
          <Field label="字体大小">
            <TextInput
              type="number"
              min={18}
              max={45}
              value={preset.fontSize ?? 32}
              aria-label={preset.name + " 字体大小"}
              onChange={(event) => customize({ fontSize: Number(event.target.value) })}
            />
          </Field>
          {(
            [
              ["textColor", "文字颜色"],
              ["borderColor", "边框颜色"],
              ["backgroundColor", "背景颜色"],
              ["minimapIcon", "小地图图标"],
            ] as const
          ).map(([field, label]) => (
            <Field key={field} label={label}>
              <TextInput
                value={preset[field] ?? ""}
                placeholder="沿用游戏默认"
                aria-label={preset.name + " " + label}
                onChange={(event) => customize({ [field]: event.target.value || undefined })}
              />
            </Field>
          ))}
        </div>
      </Disclosure>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-3 border-t border-line/60 pt-3">
        <div className="flex flex-wrap items-center gap-3">
          {preset.sourceItemId && !preset.autoRange && (
            <Button variant="secondary" size="sm" onClick={() => onChange({ autoRange: true })}>
              <RotateCcw aria-hidden="true" className="size-3.5" />
              恢复跟随通货市价
            </Button>
          )}
          <FileInput
            label={preset.name + " 自定义音效"}
            accept="audio/mpeg,audio/wav,audio/ogg"
            fileName={preset.sound.type === "custom" ? customFile?.name || preset.sound.fileName : "使用模板音效"}
            onFile={onSound}
          />
        </div>
        <span className="font-mono text-[10px] leading-relaxed text-gold/90">
          范围：{range.min ? formatPrice(range.min, market) : "0"} — {range.max ? formatPrice(range.max, market) : "∞"}
        </span>
      </div>
    </div>
  );
}

function PriceBoundEditor({
  label,
  point,
  market,
  onChange,
}: {
  label: string;
  point?: PricePoint;
  market: MarketSnapshot;
  onChange: (point?: PricePoint) => void;
}) {
  if (point?.referenceItemId) {
    const value = toExalted(point, market.rates, market.prices);
    return (
      <div className="flex flex-col gap-1.5 rounded-sm border border-line bg-surface-2/60 px-3 py-2.5">
        <span className="text-[11px] text-ink-muted">{label}</span>
        <strong className="font-mono text-xs font-medium text-ink">{formatPrice(point, market)}</strong>
        <Button variant="secondary" size="sm" disabled={value === undefined} onClick={() => onChange({ amount: value!, currency: "exalted" })}>
          改为固定价格
        </Button>
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
          className="h-9 py-1 text-xs"
          value={point?.amount ?? ""}
          onChange={(event) =>
            onChange(event.target.value === "" ? undefined : { amount: Number(event.target.value), currency: point?.currency ?? "divine" })
          }
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

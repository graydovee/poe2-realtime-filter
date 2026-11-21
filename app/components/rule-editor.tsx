"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Check, Trash2 } from "lucide-react";

import { EFFECT_PRESETS, effectPresetsFor } from "../../lib/data";
import { formatPrice, toExalted } from "../../lib/pricing";
import type {
  Currency,
  EffectPreset,
  FilterRule,
  Locale,
  MarketSnapshot,
  PresetSound,
  PricePoint,
  RuleEffects,
  RuleFont,
} from "../../lib/types";
import { cn } from "../../lib/cn";
import { ItemPicker, type ItemPickerToggle } from "./item-picker";
import { Checkbox, FileInput, SearchInput, Select, Switch, TextInput } from "./ui/controls";
import { Disclosure } from "./ui/nav";
import { Button, Field } from "./ui/primitives";

const currencyLabels: Record<Currency, string> = { divine: "D · 神圣石", chaos: "C · 混沌石", exalted: "E · 崇高石" };
const NONE = "__none";
const CUSTOM_SOUND = "__custom";

const colorNames: Record<string, string> = {
  Red: "红色", Orange: "橙色", Yellow: "黄色", Green: "绿色", Blue: "蓝色", Cyan: "青色",
  Purple: "紫色", Pink: "粉色", White: "白色", Brown: "棕色", Grey: "灰色",
};
const colorValues: Record<string, string> = {
  Red: "#ff4040", Orange: "#ff9c38", Yellow: "#ffe14d", Green: "#6bdc68", Blue: "#4995ff", Cyan: "#5ee4eb",
  Purple: "#b380f5", Pink: "#ff91cb", White: "#fff", Brown: "#a87950", Grey: "#9a9a9a",
};
const shapeNames: Record<string, string> = {
  Circle: "圆形", Star: "星形", Diamond: "菱形", Square: "方形", Pentagon: "五边形", Hexagon: "六边形",
  Triangle: "三角", Cross: "十字", Kite: "风筝", UpsideDownHouse: "倒屋",
};

function rgbaFromHex(value: string, alpha: number) {
  const hexValue = value.replace("#", "");
  const full = hexValue.length === 3 ? hexValue.split("").map((part) => part + part).join("") : hexValue;
  const number = Number.parseInt(full, 16);
  if (!Number.isFinite(number) || full.length !== 6) return "rgba(255,255,255," + alpha + ")";
  const red = (number >> 16) & 255;
  const green = (number >> 8) & 255;
  const blue = number & 255;
  return "rgba(" + red + "," + green + "," + blue + "," + alpha + ")";
}

function rgba(value?: string, fallback = "transparent") {
  if (!value) return fallback;
  const parts = value.split(/\s+/).map(Number);
  if (parts.length < 3 || parts.some((part) => !Number.isFinite(part))) return fallback;
  return "rgba(" + parts[0] + ", " + parts[1] + ", " + parts[2] + ", " + (parts[3] ?? 255) / 255 + ")";
}

function hex(value?: string) {
  if (!value) return "—";
  const parts = value.split(/\s+/).map(Number);
  if (parts.length < 3 || parts.slice(0, 3).some((part) => !Number.isFinite(part))) return value;
  return "#" + parts.slice(0, 3).map((part) => part.toString(16).padStart(2, "0")).join("");
}

function iconParts(icon?: string) {
  const [size, color, shape] = icon?.split(" ") ?? [];
  return { size, color, shape };
}

/** 把一套完整特效描述成中文，用于预设列表与「当前预设」回显。 */
export function describeEffects(effects: RuleEffects): string {
  const parts: string[] = [];
  if (effects.beam) {
    const [color, temporary] = effects.beam.split(" ");
    parts.push((colorNames[color] ?? color) + "光柱" + (temporary ? "（临时）" : ""));
  }
  if (effects.icon) {
    const { size, color, shape } = iconParts(effects.icon);
    parts.push((colorNames[color] ?? color ?? "") + (shapeNames[shape] ?? shape ?? "") + "图标" + (size ? "·" + size : ""));
  }
  if (effects.font) {
    const font = effects.font;
    const bits = [font.fontSize ? font.fontSize + "号" : "", hex(font.textColor), hex(font.borderColor), hex(font.backgroundColor)].filter(Boolean);
    parts.push("字体 " + bits.join(" / "));
  }
  if (effects.sound) {
    parts.push(effects.sound.type === "builtin" ? "音效 " + effects.sound.id : "音效 " + effects.sound.fileName);
  }
  return parts.length ? parts.join(" · ") : "跟随基础过滤器";
}

function pickEffects(preset: EffectPreset): RuleEffects {
  return {
    ...(preset.beam ? { beam: preset.beam } : {}),
    ...(preset.icon ? { icon: preset.icon } : {}),
    ...(preset.font ? { font: preset.font } : {}),
    ...(preset.sound ? { sound: preset.sound } : {}),
  };
}

function AppearancePreview({ effects, name }: { effects: RuleEffects; name: string }) {
  const { color: iconColor, shape } = iconParts(effects.icon);
  const [beamColor] = (effects.beam ?? "").split(" ");
  const beam = colorValues[beamColor] ?? "transparent";
  const font = effects.font ?? {};
  return (
    <div className="grid gap-4 rounded-sm border border-line bg-surface-2/50 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(11rem,0.85fr)]">
      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-gold">实时预览</span>
          <span className="text-[10px] text-ink-muted">改任意字段都会立刻更新</span>
        </div>
        <div className="loot-scene border border-line/70">
        <span aria-hidden="true" className="loot-glow" style={{ background: "radial-gradient(ellipse at center, " + rgbaFromHex(beam === "transparent" ? "#8a7a5c" : beam, 0.45) + ", transparent 70%)" }} />
        <span
          aria-hidden="true"
          className="loot-beam"
          style={{ color: beam, background: "linear-gradient(to top, " + rgbaFromHex(beam === "transparent" ? "#8a7a5c" : beam, 0.95) + " 0%, " + rgbaFromHex(beam === "transparent" ? "#8a7a5c" : beam, 0.55) + " 55%, transparent 92%)" }}
        />
        <span
          className="loot-label"
          style={{
            color: rgba(font.textColor, "#c8c8c8"),
            borderColor: rgba(font.borderColor),
            backgroundColor: rgba(font.backgroundColor, "rgba(0,0,0,.7)"),
          }}
        >
          {name}
        </span>
        {shape && (
          <svg viewBox="0 0 24 24" className="loot-icon" style={{ color: colorValues[iconColor] ?? "#9a9a9a" }} aria-label={iconColor + shape}>
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
      </div>
      <dl className="grid grid-cols-[3.5rem_minmax(0,1fr)] content-center gap-x-3 gap-y-2 text-[11px] leading-relaxed">
        <dt className="text-ink-muted">光柱</dt>
        <dd className="text-ink/90">{effects.beam ? (colorNames[effects.beam.split(" ")[0]] ?? effects.beam) + (effects.beam.endsWith("Temp") ? "（临时）" : "") : "沿用基础"}</dd>
        <dt className="text-ink-muted">地图图标</dt>
        <dd className="text-ink/90">{effects.icon ? describeIcon(effects.icon) : "沿用基础"}</dd>
        <dt className="text-ink-muted">字体</dt>
        <dd className="text-ink/90">{font.fontSize ? font.fontSize + " 号" : "沿用基础"}</dd>
        <dt className="text-ink-muted">音效</dt>
        <dd className="text-ink/90">{effects.sound ? (effects.sound.type === "builtin" ? "内置 " + effects.sound.id + " · 音量 " + effects.sound.volume : effects.sound.fileName) : "沿用基础"}</dd>
      </dl>
    </div>
  );
}

function describeIcon(icon: string) {
  const { size, color, shape } = iconParts(icon);
  return (colorNames[color] ?? color) + (shapeNames[shape] ?? shape) + " · 尺寸 " + (size ?? "?");
}

function PresetCard({ preset, active, onSelect }: { preset: EffectPreset; active: boolean; onSelect: () => void }) {
  const { color: iconColor, shape } = iconParts(preset.icon);
  const [beamColor] = (preset.beam ?? "").split(" ");
  const font = preset.font ?? {};
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={cn(
        "group flex flex-col gap-2 rounded-sm border p-2 text-left transition",
        active ? "border-gold/70 bg-gold/[0.08]" : "border-line bg-surface-2/60 hover:border-line-strong",
      )}
    >
      <span className="loot-scene" style={{ minHeight: "4.25rem" }}>
        <span aria-hidden="true" className="loot-glow" style={{ background: "radial-gradient(ellipse at center, " + rgbaFromHex(colorValues[beamColor] ?? "#8a7a5c", 0.4) + ", transparent 70%)" }} />
        <span
          aria-hidden="true"
          className="loot-beam"
          style={{
            color: colorValues[beamColor] ?? "transparent",
            background: "linear-gradient(to top, " + rgbaFromHex(colorValues[beamColor] ?? "#8a7a5c", 0.9) + " 0%, " + rgbaFromHex(colorValues[beamColor] ?? "#8a7a5c", 0.5) + " 55%, transparent 92%)",
          }}
        />
        <span
          className="loot-label"
          style={{
            color: rgba(font.textColor, "#c8c8c8"),
            borderColor: rgba(font.borderColor),
            backgroundColor: rgba(font.backgroundColor, "rgba(0,0,0,.7)"),
            fontSize: "10px",
          }}
        >
          示例
        </span>
        {shape && (
          <svg viewBox="0 0 24 24" className="loot-icon" style={{ color: colorValues[iconColor] ?? "#9a9a9a" }}>
            {shape === "Star" ? (
              <path fill="currentColor" d="m12 1 3.1 7.1 7.8.7-5.9 5.1 1.8 7.6L12 17.5 5.2 21.5 7 13.9 1.1 8.8l7.8-.7z" />
            ) : shape === "Circle" ? (
              <circle cx="12" cy="12" r="9" fill="currentColor" />
            ) : (
              <path d="M12 2 22 12 12 22 2 12z" fill="currentColor" />
            )}
          </svg>
        )}
      </span>
      <span className="flex items-start gap-1 text-[10px] leading-tight text-ink-muted group-hover:text-ink/90">
        {active && <Check aria-hidden="true" className="mt-0.5 size-3 shrink-0 text-gold" />}
        <span className="line-clamp-2">{describeEffects(pickEffects(preset))}</span>
      </span>
    </button>
  );
}

export function RuleEditor({
  rule,
  index,
  total,
  locale,
  style,
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
  style: string;
  market: MarketSnapshot;
  customFile?: File;
  onChange: (patch: Partial<FilterRule>) => void;
  onRemove: () => void;
  onMove: (delta: number) => void;
  onSound: (file: File | undefined) => void;
}) {
  const presets = useMemo(() => effectPresetsFor(style), [style]);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [query, setQuery] = useState("");
  const font = rule.effects.font ?? {};
  const selected = presets.find((preset) => preset.id === rule.effectPresetId);
  const filtered = query.trim() ? presets.filter((preset) => describeEffects(pickEffects(preset)).includes(query.trim())) : presets;
  const soundValue = !rule.effects.sound ? NONE : rule.effects.sound.type === "custom" ? CUSTOM_SOUND : rule.effects.sound.type === "neversink" ? "neversink:" + rule.effects.sound.fileName : "builtin:" + rule.effects.sound.id;

  function applyPreset(preset: EffectPreset) {
    onChange({ effectPresetId: preset.id, effects: pickEffects(preset) });
  }

  function editEffects(patch: Partial<RuleEffects>) {
    const next: RuleEffects = { ...rule.effects, ...patch };
    for (const key of Object.keys(next) as Array<keyof RuleEffects>) {
      const value = next[key];
      if (value === undefined || value === "" || (key === "font" && (!value || Object.keys(value).length === 0))) delete next[key];
    }
    onChange({ effectPresetId: undefined, effects: next });
  }

  function editFont(patch: Partial<RuleFont>) {
    const next: RuleFont = { ...font, ...patch };
    for (const key of Object.keys(next) as Array<keyof RuleFont>) {
      if (next[key] === undefined || next[key] === "") delete next[key];
    }
    editEffects({ font: Object.keys(next).length ? next : undefined });
  }

  function editTarget(patch: Partial<FilterRule["target"]>) {
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
                  editTarget({ itemIds: [...current] });
                }}
                onRemoveEntry={() => editTarget({ itemIds: [] })}
              />
            </div>
          </Disclosure>
          <p className="text-[10px] leading-relaxed text-ink-muted/85">不选物品 = 规则对所有物品生效（配合价格区间使用）。</p>
        </div>

        <div className="flex flex-col gap-3 rounded-sm border border-line/70 bg-surface-2/40 p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] font-medium text-ink">价格区间</span>
            {rule.autoRange ? <span className="font-mono text-[10px] text-gold">跟随市价</span> : <span className="font-mono text-[10px] text-ink-muted">固定价格</span>}
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

      <div className="mt-4 rounded-sm border border-line/70 bg-surface-2/40 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <span className="text-[11px] font-medium text-ink">完整特效预设</span>
            <p className="mt-1 truncate text-[10px] text-ink-muted" title={selected ? describeEffects(pickEffects(selected)) : describeEffects(rule.effects)}>
              {selected ? describeEffects(pickEffects(selected)) : "自定义（逐项填写）"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-ink-muted">{presets.length} 种可用</span>
            <Button variant="secondary" size="sm" onClick={() => setGalleryOpen((open) => !open)} aria-expanded={galleryOpen}>
              {galleryOpen ? "收起预设" : "选择预设"}
            </Button>
          </div>
        </div>

        {galleryOpen && (
          <div className="mt-3 flex flex-col gap-2">
            <SearchInput value={query} onChange={(event) => setQuery(event.target.value)} aria-label="筛选特效预设" placeholder="筛选预设，例如 星形 / 40号 / 白边" />
            <div className="grid max-h-[22rem] grid-cols-2 gap-2 overflow-auto pr-1 sm:grid-cols-3 lg:grid-cols-4">
              {filtered.map((preset) => (
                <PresetCard key={preset.id} preset={preset} active={preset.id === rule.effectPresetId} onSelect={() => applyPreset(preset)} />
              ))}
              {filtered.length === 0 && <p className="col-span-full py-4 text-center text-[11px] text-ink-muted">没有匹配的预设。</p>}
            </div>
            <p className="text-[10px] leading-relaxed text-ink-muted/85">预设是一次性填入光柱、地图图标、字体和音效；填好之后下面的字段仍可继续修改（改完会变成「自定义」）。</p>
          </div>
        )}
      </div>

      <div className="mt-3">
        <AppearancePreview effects={rule.effects} name={rule.name || "示例物品"} />
      </div>

      <Disclosure summary="自定义外观（光柱 / 地图图标 / 字体 / 音效）" className="mt-3 border-t border-line/60 pt-3">
      <div className="grid gap-3 pt-3 sm:grid-cols-2">
        <Field label="光柱">
          <TextInput aria-label={rule.name + " 光柱"} placeholder="PlayEffect，留空沿用基础" value={rule.effects.beam ?? ""} onChange={(event) => editEffects({ beam: event.target.value })} />
        </Field>
        <Field label="地图图标">
          <TextInput aria-label={rule.name + " 地图图标"} placeholder="MinimapIcon，留空沿用基础" value={rule.effects.icon ?? ""} onChange={(event) => editEffects({ icon: event.target.value })} />
        </Field>
        <Field label="字号" hint="18–45">
          <div className="flex gap-2">
            <TextInput
              type="number"
              min={18}
              max={45}
              aria-label={rule.name + " 字号"}
              placeholder="沿用基础"
              value={font.fontSize ?? ""}
              onChange={(event) => editFont({ fontSize: event.target.value === "" ? undefined : Number(event.target.value) })}
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
              <TextInput aria-label={rule.name + " " + label} placeholder="R G B (A)，留空沿用基础" value={font[key] ?? ""} onChange={(event) => editFont({ [key]: event.target.value })} />
              <ColorSwatch color={font[key]} />
            </div>
          </Field>
        ))}
        <Field label="音效">
          <div className="flex flex-col gap-2">
            <Select
              ariaLabel={rule.name + " 音效"}
              value={soundValue}
              onValueChange={(value) => {
                if (value === NONE) editEffects({ sound: undefined });
                else if (value === CUSTOM_SOUND) editEffects({ sound: { type: "custom", fileName: rule.effects.sound?.type === "custom" ? rule.effects.sound.fileName : "" } });
                else if (value.startsWith("builtin:")) {
                  const id = Number(value.slice(8));
                  editEffects({ sound: { type: "builtin", id, volume: rule.effects.sound?.type === "builtin" && rule.effects.sound.id === id ? rule.effects.sound.volume : 300 } });
                } else editEffects({ sound: { type: "neversink", fileName: value.slice(10) } });
              }}
              options={[
                { value: NONE, label: "沿用基础" },
                ...EFFECT_PRESETS.sounds.map((sound) => ({
                  value: sound.type === "builtin" ? "builtin:" + sound.id : "neversink:" + sound.fileName,
                  label: sound.type === "builtin" ? "内置音效 " + sound.id + " · 音量 " + sound.volume : "模板音效 · " + sound.fileName,
                })),
                { value: CUSTOM_SOUND, label: "自定义上传…" },
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
          </div>
        </Field>
      </div>
      </Disclosure>
    </div>
  );
}

function ColorSwatch({ color }: { color?: string }) {
  const parts = (color ?? "").split(/\s+/).map(Number);
  const valid = parts.length >= 3 && parts.slice(0, 3).every((value) => Number.isFinite(value));
  return (
    <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-sm border border-line bg-surface-3" title={color || "沿用基础"}>
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

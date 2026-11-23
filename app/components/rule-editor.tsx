"use client";

import { useId, useState } from "react";
import { Check, Trash2 } from "lucide-react";

import { DEFAULT_EFFECT_ITEMS, type InheritedStyle } from "../../lib/baseline-effects";
import { formatPrice, toExalted } from "../../lib/pricing";
import type {
  BaseFilter,
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
import { DropConditionsEditor } from "./drop-conditions-editor";
import { ItemPicker, type ItemPickerToggle } from "./item-picker";
import { SoundPreviewButton } from "./sound-preview";
import { FileInput, SearchInput, Select, Switch, TextInput } from "./ui/controls";
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

function AppearancePreview({ effects, name, file, base }: { effects: RuleEffects; name: string; file?: File; base?: BaseFilter }) {
  const defaultStyleLabel = base ? "沿用基础" : "游戏默认";
  const { color: iconColor, shape } = iconParts(effects.icon);
  const [beamColor] = (effects.beam ?? "").split(" ");
  const beam = colorValues[beamColor] ?? "transparent";
  const font = effects.font ?? {};
  return (
    <div className="grid gap-4 rounded-sm border border-line bg-surface-2/50 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(11rem,0.85fr)]">
      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="font-mono text-xs uppercase tracking-[0.16em] text-gold">实时预览</span>
          <div className="flex items-center gap-3">
            <span className="text-xs text-ink-muted">改任意字段都会立刻更新</span>
            <SoundPreviewButton sound={effects.sound} file={file} base={base} />
          </div>
        </div>
        <div className="loot-scene border border-line/70">
        <div className="loot-beam-wrap">
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
        </div>
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
      <dl className="grid grid-cols-[3.5rem_minmax(0,1fr)] content-center gap-x-3 gap-y-2 text-xs leading-relaxed">
        <dt className="text-ink-muted">光柱</dt>
        <dd className="text-ink/90">{effects.beam ? (colorNames[effects.beam.split(" ")[0]] ?? effects.beam) + (effects.beam.endsWith("Temp") ? "（临时）" : "") : defaultStyleLabel}</dd>
        <dt className="text-ink-muted">地图图标</dt>
        <dd className="text-ink/90">{effects.icon ? describeIcon(effects.icon) : defaultStyleLabel}</dd>
        <dt className="text-ink-muted">字体</dt>
        <dd className="text-ink/90">{font.fontSize ? font.fontSize + " 号" : defaultStyleLabel}</dd>
        <dt className="text-ink-muted">音效</dt>
        <dd className="text-ink/90">{effects.sound ? (effects.sound.type === "builtin" ? "内置 " + effects.sound.id + " · 音量 " + effects.sound.volume : effects.sound.fileName) : defaultStyleLabel}</dd>
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
        <span className="loot-beam-wrap">
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
      <span className="flex items-start gap-1 text-xs leading-tight text-ink-muted group-hover:text-ink/90">
        {active && <Check aria-hidden="true" className="mt-0.5 size-3 shrink-0 text-gold" />}
        <span className="line-clamp-2">{describeEffects(pickEffects(preset))}</span>
      </span>
    </button>
  );
}

export function RuleEditor({
  rule,
  index,
  locale,
  presets,
  base,
  inherited,
  market,
  customFile,
  onChange,
  onRemove,
  onSound,
}: {
  rule: FilterRule;
  index: number;
  locale: Locale;
  presets: EffectPreset[];
  base?: BaseFilter;
  inherited?: InheritedStyle;
  market: MarketSnapshot;
  customFile?: File;
  onChange: (patch: Partial<FilterRule>) => void;
  onRemove: () => void;
  onSound: (file: File | undefined) => void;
}) {
  const canFollow = Object.prototype.hasOwnProperty.call(DEFAULT_EFFECT_ITEMS, rule.id);
  const shownEffects = rule.followBaseline ? inherited?.effects ?? {} : rule.effects;
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [query, setQuery] = useState("");
  const font = shownEffects.font ?? {};
  const hasItems = rule.target.itemIds.length > 0;
  const hasPrice = Boolean(rule.target.range);
  const itemConditionOn = rule.target.itemEnabled !== false && hasItems;
  const priceConditionOn = rule.target.priceEnabled !== false && hasPrice;
  const conditionId = useId();
  const itemConditionLocked = itemConditionOn && !priceConditionOn;
  const priceConditionLocked = priceConditionOn && !itemConditionOn;
  const selected = rule.followBaseline ? undefined : presets.find((preset) => JSON.stringify(pickEffects(preset)) === JSON.stringify(pickEffects({ id: "", ...rule.effects })));
  const filtered = query.trim() ? presets.filter((preset) => describeEffects(pickEffects(preset)).includes(query.trim())) : presets;
  const defaultStyleLabel = base ? "沿用基础" : "游戏默认";
  const soundValue = !rule.effects.sound ? NONE : rule.effects.sound.type === "custom" ? CUSTOM_SOUND : rule.effects.sound.type === "builtin" ? "builtin:" + rule.effects.sound.id : "base:" + rule.effects.sound.fileName;

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

  function editTarget(patch: Partial<FilterRule["target"]>) {
    onChange({ target: { ...rule.target, ...patch } });
  }

  return (
    <div className={cn("rounded border transition", rule.enabled ? "border-gold/55 bg-surface" : "border-line bg-surface")}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-t-[9px] border-b border-line bg-surface-2 px-3 py-3 sm:px-4">
        <TextInput
          aria-label={"规则 " + (index + 1) + " 名称"}
          className="h-9 min-w-0 basis-full py-1 sm:flex-1"
          value={rule.name}
          onChange={(event) => onChange({ name: event.target.value })}
        />
        <Switch checked={rule.enabled} onCheckedChange={(enabled) => onChange({ enabled })} label="启用规则" />
        <Switch checked={rule.hidden} onCheckedChange={(hidden) => onChange({ hidden })} label="隐藏物品" />
        <div className="flex items-center gap-1">
          <Button variant="danger" size="icon" aria-label={"删除 " + rule.name} onClick={onRemove}>
            <Trash2 aria-hidden="true" className="size-3.5" />
          </Button>
        </div>
      </div>

      {rule.hidden && (
        <p className="mx-3 mt-3 text-xs leading-relaxed text-ember sm:mx-4">
          这条规则会隐藏命中的物品；隐藏物品在游戏内按住 Alt 仍可见，所以下面的特效照样会生效。
        </p>
      )}

      <section className="space-y-3 border-b border-line p-3 sm:p-4" aria-label="匹配条件">
        <h3 className="text-sm font-semibold text-ink">匹配条件</h3>
        <div className="grid gap-3 2xl:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-3 rounded-sm border border-line bg-surface-2 p-3">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <h3 className="text-sm font-semibold text-ink">物品条件</h3>
            <Switch
              checked={itemConditionOn}
              disabled={!hasItems || itemConditionLocked}
              onCheckedChange={(next) => editTarget({ itemEnabled: next })}
              label="启用物品条件"
              describedBy={conditionId + "-items"}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Disclosure summary={rule.target.itemIds.length ? "修改物品选择 · 已选 " + rule.target.itemIds.length + " 项" : "选择物品"} className="rounded-sm border border-line/60 px-3 py-2">
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
                    editTarget({ itemIds: [...current], ...(toggle.checked ? { itemEnabled: true } : {}) });
                  }}
                  onRemoveEntry={() => editTarget({ itemIds: [] })}
                  onGemLevel={(id, level) => editTarget({
                    itemIds: [...new Set([...rule.target.itemIds, id])], itemEnabled: true,
                    dropConditions: { ...rule.target.dropConditions, gemLevel: { enabled: true, bounds: [{ op: "=", value: level }] } },
                  })}
                />
              </div>
            </Disclosure>
            <p id={conditionId + "-items"} className="text-xs leading-relaxed text-ink-muted">
              {!hasItems
                ? "先选择物品，再启用此条件。"
                : itemConditionLocked
                  ? "当前唯一启用的条件。启用价格条件后可关闭。"
                  : itemConditionOn
                    ? "只匹配所选物品与价格区间的交集。"
                    : "已关闭。所选物品已保留。"}
            </p>
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-3 rounded-sm border border-line bg-surface-2 p-3">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <h3 className="text-sm font-semibold text-ink">价格条件</h3>
            <Switch
              checked={priceConditionOn}
              disabled={!hasPrice || priceConditionLocked}
              onCheckedChange={(next) => editTarget({ priceEnabled: next })}
              label="启用价格条件"
              describedBy={conditionId + "-price"}
            />
          </div>
          {rule.autoRange && <span className="text-xs font-medium text-gold">跟随市价</span>}
          <div className="grid gap-2 sm:grid-cols-2">
            <PriceBoundEditor label="下限（含）" point={rule.target.range?.min} market={market} autoRange={rule.autoRange} onChange={(point) => onChange({ autoRange: false, target: { ...rule.target, range: { ...rule.target.range, min: point } } })} />
            <PriceBoundEditor label="上限（不含）" point={rule.target.range?.max} market={market} autoRange={rule.autoRange} onChange={(point) => onChange({ autoRange: false, target: { ...rule.target, range: { ...rule.target.range, max: point } } })} />
          </div>
          {rule.autoRange ? (
            <Button variant="secondary" size="sm" disabled={!rule.target.range?.min} onClick={() => onChange({ autoRange: false })}>
              改为固定价格
            </Button>
          ) : null}
          <p id={conditionId + "-price"} className="text-xs leading-relaxed text-ink-muted">
            {!hasPrice
              ? "先填写价格区间，再启用此条件。"
              : priceConditionLocked
                ? "当前唯一启用的条件。启用物品条件后可关闭。"
                : !priceConditionOn
                  ? "已关闭。填写的价格区间已保留。"
                  : rule.autoRange
                    ? "根据市价更新区间。"
                    : "留空上限表示不封顶。"}
          </p>
        </div>
      </div>

        <DropConditionsEditor rule={rule} onChange={editTarget} />
      </section>

      <section className="flex flex-col gap-3 p-3 sm:p-4" aria-label="显示与特效">
        <h3 className="text-sm font-semibold text-ink">显示与特效</h3>
        {canFollow && <div className="rounded-sm border border-line bg-surface-2 p-3">
          <Switch checked={Boolean(rule.followBaseline)} onCheckedChange={(followBaseline) => onChange({ followBaseline })} label="跟随基础过滤器" />
          {rule.followBaseline && <p className="mt-2 text-xs text-ink-muted">
            {!base ? "当前使用游戏默认样式。" : inherited?.warning ?? (inherited ? describeEffects(inherited.effects) : "基础特效尚未读取")}
          </p>}
        </div>}
        <div className="rounded-sm border border-line bg-surface-2 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <span className="text-xs font-medium text-ink">完整特效预设</span>
              <p className="mt-1 truncate text-xs text-ink-muted" title={selected ? describeEffects(pickEffects(selected)) : describeEffects(rule.effects)}>
                {selected ? describeEffects(pickEffects(selected)) : "自定义外观"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-ink-muted">{presets.length} 种可用</span>
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
                  <PresetCard key={preset.id} preset={preset} active={preset.id === selected?.id} onSelect={() => applyPreset(preset)} />
                ))}
                {filtered.length === 0 && <p className="col-span-full py-4 text-center text-xs text-ink-muted">{query && presets.length ? "试试其他特效关键词。" : base ? "当前没有可用预设。" : "选择基础过滤器后可以套用它的特效。"}</p>}
              </div>
              <p className="text-xs leading-relaxed text-ink-muted">应用预设后，可展开「高级外观设置」调整单项特效。</p>
            </div>
          )}
        </div>

        <div>
          <AppearancePreview effects={shownEffects} name={rule.name || "示例物品"} file={customFile} base={base} />
        </div>

        <Disclosure summary="高级外观设置" className="border-t border-line pt-1">
          <div className="grid gap-3 pt-3 sm:grid-cols-2">
            <Field label="光柱">
              <TextInput aria-label={rule.name + " 光柱"} placeholder={`PlayEffect，留空使用${defaultStyleLabel === "沿用基础" ? "基础样式" : "游戏默认样式"}`} value={shownEffects.beam ?? ""} onChange={(event) => editEffects({ beam: event.target.value })} />
            </Field>
            <Field label="地图图标">
              <TextInput aria-label={rule.name + " 地图图标"} placeholder={`MinimapIcon，${defaultStyleLabel}`} value={shownEffects.icon ?? ""} onChange={(event) => editEffects({ icon: event.target.value })} />
            </Field>
            <Field label="字号" hint="18–45">
              <div className="flex gap-2">
                <TextInput
                  type="number"
                  min={1}
                  max={45}
                  aria-label={rule.name + " 字号"}
                  placeholder={defaultStyleLabel}
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
                  <TextInput aria-label={rule.name + " " + label} placeholder={`R G B (A)，${defaultStyleLabel}`} value={font[key] ?? ""} onChange={(event) => editFont({ [key]: event.target.value })} />
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
                    }
                  }}
                  options={[
                    { value: NONE, label: defaultStyleLabel },
                    ...Array.from({ length: 16 }, (_, index) => ({
                      value: "builtin:" + (index + 1),
                      label: "内置音效 " + (index + 1),
                    })),
                    ...(soundValue.startsWith("base:") ? [{ value: soundValue, label: "基础过滤器音效 · " + soundValue.slice(5) }] : []),
                    { value: CUSTOM_SOUND, label: "自定义上传…" },
                  ]}
                />
                {!base && !rule.followBaseline && (rule.effects.sound?.type === "neversink" || rule.effects.sound?.type === "baseline") && (
                  <p className="text-xs text-ember">请选择内置音效或上传音效，替换「{rule.effects.sound.fileName}」。</p>
                )}
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
      </section>
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
        <span className="text-xs text-ink-muted">{label}</span>
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
      <span className="text-xs text-ink-muted">{label}</span>
      <div className="grid grid-cols-[minmax(4.5rem,1fr)_minmax(0,1.3fr)] gap-2">
        <TextInput
          type="number"
          min={0}
          step={0.01}
          placeholder="不限"
          aria-label={label + "数值"}
          className="h-9 px-2 py-1 text-xs"
          value={point?.amount ?? ""}
          onChange={(event) => onChange(event.target.value === "" ? undefined : { amount: Number(event.target.value), currency: point?.currency ?? "divine" })}
        />
        <Select
          value={point?.currency ?? "divine"}
          onValueChange={(currency) => onChange({ amount: point?.amount ?? 0, currency: currency as Currency })}
          ariaLabel={label + "单位"}
          className="h-9 px-2 py-1 text-xs"
          options={Object.entries(currencyLabels).map(([value, name]) => ({ value, label: name }))}
        />
      </div>
    </div>
  );
}

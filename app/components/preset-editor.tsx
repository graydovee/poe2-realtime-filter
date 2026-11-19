"use client";

import { CURRENCY_ANCHORS, formatPrice, toExalted } from "../../lib/pricing";
import { NEVERSINK_VERSION, templateAppearance } from "../../lib/neversink-appearance";
import type { TemplateSelection } from "../../lib/neversink-appearance";
import type { Currency, MarketSnapshot, PricePoint, VisualPreset } from "../../lib/types";

const currencyLabels: Record<Currency, string> = { divine: "D · 神圣石", chaos: "C · 混沌石", exalted: "E · 崇高石" };
const effectNames: Record<string, string> = { Red: "红色", Orange: "橙色", Yellow: "黄色", Green: "绿色", Blue: "蓝色", Cyan: "青色", Purple: "紫色", Pink: "粉色", White: "白色", Brown: "棕色", Grey: "灰色" };
const effectColors: Record<string, string> = { Red: "#ff4040", Orange: "#ff9c38", Yellow: "#ffe14d", Green: "#6bdc68", Blue: "#4995ff", Cyan: "#5ee4eb", Purple: "#b380f5", Pink: "#ff91cb", White: "#fff", Brown: "#a87950", Grey: "#9a9a9a" };
const shapes: Record<string, string> = { Circle: "圆形", Star: "星形", Diamond: "菱形", Square: "方形", Pentagon: "五边形", Hexagon: "六边形", Triangle: "三角形", Cross: "十字", Kite: "风筝形", UpsideDownHouse: "倒屋形" };

function rgba(value?: string, fallback = "transparent") {
  if (!value) return fallback;
  const parts = value.split(/\s+/).map(Number);
  if (parts.length < 3 || parts.some((part) => !Number.isFinite(part))) return fallback;
  return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${(parts[3] ?? 255) / 255})`;
}

function AppearancePreview({ preset, itemName }: { preset: VisualPreset; itemName: string }) {
  const [iconSize, iconColor, shape] = preset.minimapIcon?.split(" ") ?? [];
  const [beam, temporary] = preset.effect.split(" ");
  return <div className="appearance-preview">
    <div className="loot-scene"><span className="loot-beam" style={{ backgroundColor: effectColors[beam] || "transparent" }} aria-hidden="true" /><span className="loot-label" style={{ color: rgba(preset.textColor, "#c8c8c8"), borderColor: rgba(preset.borderColor), backgroundColor: rgba(preset.backgroundColor, "rgba(0,0,0,.7)") }}>{itemName}</span>{shape && <svg viewBox="0 0 24 24" className="loot-icon" style={{ color: effectColors[iconColor] }} aria-label={(effectNames[iconColor] || iconColor) + (shapes[shape] || shape)}>{shape === "Star" ? <path fill="currentColor" d="m12 1 3.1 7.1 7.8.7-5.9 5.1 1.8 7.6L12 17.5 5.2 21.5 7 13.9 1.1 8.8l7.8-.7z" /> : shape === "Circle" ? <circle cx="12" cy="12" r="9" fill="currentColor" /> : <path d="M12 2 22 12 12 22 2 12z" fill="currentColor" />}</svg>}</div>
    <dl className="appearance-facts"><dt>光柱</dt><dd>{effectNames[beam] || beam}{temporary ? "（临时）" : ""}</dd><dt>地图图标</dt><dd>{shape ? (effectNames[iconColor] || iconColor) + (shapes[shape] || shape) + " · 尺寸 " + iconSize : "无"}</dd><dt>字体</dt><dd>{preset.fontSize || "游戏默认"}</dd><dt>音效</dt><dd>{preset.sound.type === "builtin" ? "内置 " + preset.sound.id + " · 音量 " + preset.sound.volume : preset.sound.fileName}</dd></dl>
  </div>;
}

export function PresetEditor({ preset, template, market, customFile, onChange, onRemove, onSound }: { preset: VisualPreset; template: TemplateSelection; market: MarketSnapshot; customFile?: File; onChange: (patch: Partial<VisualPreset>) => void; onRemove: () => void; onSound: (file: File | undefined) => void }) {
  const range = preset.range;
  const appearanceId = preset.appearanceItemId ?? preset.sourceItemId;
  const original = preset.followTemplate !== false ? templateAppearance(template, appearanceId) : undefined;
  const itemName = appearanceId ? CURRENCY_ANCHORS[appearanceId] || preset.name : preset.name;
  function chooseAppearance(id: string) {
    if (id === "custom") { onChange({ ...preset, followTemplate: false }); return; }
    const selected = templateAppearance(template, id);
    if (selected) onChange({ appearanceItemId: id, followTemplate: true, sound: selected.sound });
  }
  function customize(patch: Partial<VisualPreset>) { onChange({ ...preset, ...patch, followTemplate: false }); }
  return <div className={"preset-editor " + (preset.enabled ? "enabled" : "")}>
    <div className="preset-top"><label className="preset-enable"><input type="checkbox" checked={preset.enabled} onChange={(event) => onChange({ enabled: event.target.checked })} /><span>{preset.name}</span></label><input aria-label={preset.name + "规则名称"} className="preset-name" value={preset.name} onChange={(event) => onChange({ name: event.target.value })} /><button className="remove-button" onClick={onRemove} aria-label={"删除 " + preset.name}>删除</button></div>
    <label className="appearance-select">通货样式<select value={original ? appearanceId : "custom"} onChange={(event) => chooseAppearance(event.target.value)}>{Object.entries(CURRENCY_ANCHORS).map(([id, label]) => <option key={id} value={id}>{label}原始样式</option>)}<option value="custom">自定义样式</option></select></label>
    <AppearancePreview preset={preset} itemName={itemName} />
    {original && <p className="appearance-source"><a href={original.url} target="_blank" rel="noreferrer">NeverSink {NEVERSINK_VERSION} · 查看原始规则</a></p>}
    <div className="preset-grid"><PriceBoundEditor label="下限（含）" point={range.min} market={market} onChange={(point) => onChange({ autoRange: false, range: { ...range, min: point } })} /><PriceBoundEditor label="上限（不含）" point={range.max} market={market} onChange={(point) => onChange({ autoRange: false, range: { ...range, max: point } })} /></div>
    <details className="appearance-customize"><summary>自定义外观</summary><div className="appearance-fields"><label>光柱颜色<select value={preset.effect} onChange={(event) => customize({ effect: event.target.value })}>{Object.entries(effectNames).filter(([key]) => key !== "Grey").flatMap(([key, label]) => [<option key={key} value={key}>{label}</option>, <option key={key + " Temp"} value={key + " Temp"}>{label}（临时）</option>])}</select></label><label>字体大小<input type="number" min="18" max="45" value={preset.fontSize ?? 32} onChange={(event) => customize({ fontSize: Number(event.target.value) })} /></label>{([['textColor', '文字颜色'], ['borderColor', '边框颜色'], ['backgroundColor', '背景颜色'], ['minimapIcon', '小地图图标']] as const).map(([field, label]) => <label key={field}>{label}<input value={preset[field] ?? ""} placeholder="沿用游戏默认" onChange={(event) => customize({ [field]: event.target.value || undefined })} /></label>)}</div></details>
    <div className="preset-bottom">{preset.sourceItemId && !preset.autoRange && <button className="secondary-button" onClick={() => onChange({ autoRange: true })}>恢复跟随通货市价</button>}<label className="sound-file">自定义音效<input type="file" accept="audio/mpeg,audio/wav,audio/ogg" onChange={(event) => onSound(event.target.files?.[0])} /><small>{preset.sound.type === "custom" ? customFile?.name || preset.sound.fileName : "使用模板音效"}</small></label><span className="preset-note">范围：{range.min ? formatPrice(range.min, market) : "0"} — {range.max ? formatPrice(range.max, market) : "∞"}</span></div>
  </div>;
}

function PriceBoundEditor({ label, point, market, onChange }: { label: string; point?: PricePoint; market: MarketSnapshot; onChange: (point?: PricePoint) => void }) {
  if (point?.referenceItemId) {
    const value = toExalted(point, market.rates, market.prices);
    return <div className="price-bound"><span>{label}</span><strong>{formatPrice(point, market)}</strong><button type="button" className="secondary-button" disabled={value === undefined} onClick={() => onChange({ amount: value!, currency: "exalted" })}>改为固定价格</button></div>;
  }
  return <div className="price-bound"><span>{label}</span><label><span className="sr-only">{label}数值</span><input type="number" min="0" step="0.01" placeholder="不限" value={point?.amount ?? ""} onChange={(event) => onChange(event.target.value === "" ? undefined : { amount: Number(event.target.value), currency: point?.currency ?? "divine" })} /></label><label><span className="sr-only">{label}单位</span><select value={point?.currency ?? "divine"} onChange={(event) => onChange({ amount: point?.amount ?? 0, currency: event.target.value as Currency })}>{Object.entries(currencyLabels).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label></div>;
}

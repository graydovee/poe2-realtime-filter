"use client";

import { useEffect, useMemo, useState } from "react";
import { CATEGORY_LABELS, FALLBACK_SNAPSHOT, DEFAULT_VISUAL_PRESETS, ITEM_CATALOG, LOCALE_LABELS, STRICTNESS_LABELS, STYLE_LABELS } from "../lib/data";
import type { Currency, FilterProfile, FilterStyle, Locale, MarketSnapshot, PricePoint, Strictness, VisualPreset } from "../lib/types";

import { currencyDefaultRanges, displayPrice, formatPrice, toDivines } from "../lib/pricing";

const currencyLabels: Record<Currency, string> = { divine: "D · 神圣石", chaos: "C · 混沌石", exalted: "E · 崇高石" };
const currencyShort: Record<Currency, string> = { divine: "D", chaos: "C", exalted: "E" };
const safeSoundName = (value: string) => value.replace(/[^a-zA-Z0-9._-]/g, "_");

const initialProfile: FilterProfile = {
  strictness: 2,
  style: "default",
  locale: "cn",
  itemLevelMin: 65,
  areaLevelMin: 65,
  hideBelowEnabled: false,
  hideBelowAmount: 0.5,
  hideBelowCurrency: "divine",
  whitelist: [],
  visualPresets: DEFAULT_VISUAL_PRESETS,
  sound: { pack: "neversink", alertLevel: "economy" },
  visuals: { showBeams: true, showMinimapIcons: true, fontSize: 32, highValueColor: "255 220 90", valuableColor: "80 210 255", unknownColor: "255 120 220" },
};

type Generated = {
  filterFile: string;
  fileName: string;
  baselineFile: string;
  appliedPresets: Array<{ presetId: string; presetName: string; itemCount: number }>;
  safetyReport: { passed: boolean; warnings: string[]; unknownItems: number; unpricedItems: number; ambiguousItems: number; hiddenHighValueItems: string[]; coveredItems: number; catalogSize: number };
  market: { source: string; capturedAt: string; expiresAt: string; rates?: { divineToChaos: number; divineToExalted: number } };
};

export default function HomePage() {
  const [market, setMarket] = useState<MarketSnapshot>(FALLBACK_SNAPSHOT);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/market", { signal: controller.signal }).then((response) => {
      if (!response.ok) throw new Error("行情加载失败");
      return response.json();
    }).then(setMarket).catch(() => {});
    return () => controller.abort();
  }, []);
  const [profile, setProfile] = useState<FilterProfile>(initialProfile);
  const [customSounds, setCustomSounds] = useState<Record<string, File>>({});
  const [generated, setGenerated] = useState<Generated | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<"builder" | "preview">("builder");
  const [itemSearch, setItemSearch] = useState("");
  const [itemCategory, setItemCategory] = useState("all");

  const filteredItems = useMemo(() => ITEM_CATALOG.filter((item) => {
    const query = itemSearch.trim().toLowerCase();
    const matchesText = !query || [item.name, item.localeNames.cn, item.localeNames.tw, item.localeNames.us].some((value) => value.toLowerCase().includes(query));
    return matchesText && (itemCategory === "all" || item.category === itemCategory);
  }), [itemSearch, itemCategory]);

  const categories = useMemo(() => [...new Set(ITEM_CATALOG.map((item) => item.category))], []);

  function update<K extends keyof FilterProfile>(key: K, value: FilterProfile[K]) {
    setProfile((current) => ({ ...current, [key]: value }));
  }

  function toggleWhitelist(itemId: string, checked: boolean) {
    const existing = profile.whitelist.flatMap((entry) => entry.itemIds);
    const ids = checked ? [...new Set([...existing, itemId])] : existing.filter((id) => id !== itemId);
    update("whitelist", ids.map((id) => {
      const item = ITEM_CATALOG.find((candidate) => candidate.id === id);
      return { id: "wl-" + id, label: item?.name || id, itemIds: [id] };
    }));
  }

  function updatePreset(id: string, patch: Partial<VisualPreset>) {
    update("visualPresets", profile.visualPresets.map((preset) => preset.id === id ? { ...preset, ...patch } : preset));
  }

  function addPreset() {
    const id = "custom-" + Date.now();
    update("visualPresets", [...profile.visualPresets, { id, name: "自定义光效", enabled: false, effect: "Blue", range: {}, sound: { type: "neversink", fileName: "1maybevaluable.mp3" } }]);
  }

  function removePreset(id: string) {
    update("visualPresets", profile.visualPresets.filter((preset) => preset.id !== id));
    setCustomSounds((current) => { const next = { ...current }; delete next[id]; return next; });
  }

  async function generate() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(profile) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "生成失败");
      setGenerated(payload);
      setActiveTab("preview");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "生成失败");
    } finally {
      setBusy(false);
    }
  }

  function downloadFilter() {
    if (!generated) return;
    const url = URL.createObjectURL(new Blob([generated.filterFile], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = generated.fileName; anchor.click(); URL.revokeObjectURL(url);
  }

  async function downloadBundle() {
    const form = new FormData();
    form.set("profile", JSON.stringify(profile));
    for (const [id, file] of Object.entries(customSounds)) form.set("sound:" + id, file);
    const response = await fetch("/api/export", { method: "POST", body: form });
    if (!response.ok) throw new Error("ZIP 导出失败");
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "poe2-filter.zip"; anchor.click(); URL.revokeObjectURL(url);
  }

  return (
    <main className="shell">
      <header className="topbar"><div className="brand"><span className="brand-mark">◈</span><div><strong>poe2-filter</strong><span>Path of Exile 2</span></div></div><div className="topbar-meta">基于 NeverSink · 行情来源 poe.ninja</div></header>
      <section className="page-heading"><h1>PoE2 过滤器编辑器</h1><p>选择基础档位，设置白名单、价格光效和音效，然后下载过滤器。</p></section>
      <div className="tabbar"><button className={activeTab === "builder" ? "active" : ""} onClick={() => setActiveTab("builder")}>配置过滤器</button><button className={activeTab === "preview" ? "active" : ""} onClick={() => setActiveTab("preview")}>预览与导出</button><span className="tab-spacer" /><span className="sync-status">价格单位 D / C / E</span></div>

      {activeTab === "builder" ? <section className="workspace"><div className="main-column">
        <section className="panel"><PanelHeading step="01" title="选择基础过滤器" description="严格度越高，显示的物品越少。" /><div className="strictness-grid">{(Object.keys(STRICTNESS_LABELS).map(Number) as Strictness[]).map((level) => <button key={level} className={"strictness " + (profile.strictness === level ? "selected" : "")} onClick={() => update("strictness", level)}><span className="strict-number">{level}</span><span><b>{STRICTNESS_LABELS[level]}</b><small>{level < 2 ? "显示更多物品" : level > 4 ? "专注高价值" : "推荐起点"}</small></span></button>)}</div><div className="inline-fields"><label>视觉风格<select value={profile.style} onChange={(event) => update("style", event.target.value as FilterStyle)}>{Object.entries(STYLE_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>客户端语言<select value={profile.locale} onChange={(event) => update("locale", event.target.value as Locale)}>{Object.entries(LOCALE_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label></div></section>

        <section className="panel"><PanelHeading step="02" title="物品目录与白名单" description="搜索物品并勾选加入白名单，也可以按类别筛选。" /><div className="catalog-toolbar"><input aria-label="搜索物品" value={itemSearch} onChange={(event) => setItemSearch(event.target.value)} placeholder="搜索中文、繁中或英文名称" /><select aria-label="物品类别" value={itemCategory} onChange={(event) => setItemCategory(event.target.value)}><option value="all">全部类别</option>{categories.map((category) => <option value={category} key={category}>{CATEGORY_LABELS[category]?.[profile.locale] || category}</option>)}</select></div><div className="catalog-list">{filteredItems.map((item) => { const checked = profile.whitelist.some((entry) => entry.itemIds.includes(item.id)); return <label className="catalog-row" key={item.id}><input type="checkbox" checked={checked} onChange={(event) => toggleWhitelist(item.id, event.target.checked)} /><span><b>{item.localeNames[profile.locale]}</b><small>{item.name} · {CATEGORY_LABELS[item.category]?.[profile.locale] || item.category}</small></span>{item.ambiguous ? <em>沿用原始</em> : <em>{checked ? "白名单" : "可配置"}</em>}</label>; })}</div><div className="catalog-count">显示 {filteredItems.length} / {ITEM_CATALOG.length} 项</div></section>

        <section className="panel"><PanelHeading step="03" title="价格光效规则" description="默认使用崇高石、混沌石、剥离石、神圣石的原始光效，按市价从低到高划分区间。可改为固定 D / C / E 价格；重叠范围按列表顺序匹配。" /><div className="preset-list">{currencyDefaultRanges(profile.visualPresets, market).map((preset) => <PresetEditor key={preset.id} preset={preset} market={market} customFile={customSounds[preset.id]} onChange={(patch) => updatePreset(preset.id, patch)} onRemove={() => removePreset(preset.id)} onSound={(file) => { if (!file) return; setCustomSounds((current) => ({ ...current, [preset.id]: file })); updatePreset(preset.id, { sound: { type: "custom", fileName: safeSoundName(file.name) } }); }} />)}</div><button className="secondary-button" onClick={addPreset}>＋ 新增光效预设</button></section>

        <section className="panel"><PanelHeading step="04" title="等级与基础视觉" description="设置等级条件、字体大小和显示效果。" /><div className="range-grid"><label>物品等级下限<strong>{profile.itemLevelMin}</strong><input type="range" min="1" max="86" value={profile.itemLevelMin} onChange={(event) => update("itemLevelMin", Number(event.target.value))} /></label><label>区域等级下限<strong>{profile.areaLevelMin}</strong><input type="range" min="1" max="86" value={profile.areaLevelMin} onChange={(event) => update("areaLevelMin", Number(event.target.value))} /></label><label>字体大小<strong>{profile.visuals.fontSize}</strong><input type="range" min="18" max="48" value={profile.visuals.fontSize} onChange={(event) => update("visuals", { ...profile.visuals, fontSize: Number(event.target.value) })} /></label></div><div className="checks"><label><input type="checkbox" checked={profile.visuals.showBeams} onChange={(event) => update("visuals", { ...profile.visuals, showBeams: event.target.checked })} />掉落光束</label><label><input type="checkbox" checked={profile.visuals.showMinimapIcons} onChange={(event) => update("visuals", { ...profile.visuals, showMinimapIcons: event.target.checked })} />小地图图标</label></div><div className="price-layout compact-price"><div className="price-hero"><span className="price-label">可选低价值隐藏</span><div className="price-input"><input type="number" min="0" step="0.05" value={profile.hideBelowAmount} onChange={(event) => update("hideBelowAmount", Number(event.target.value))} disabled={!profile.hideBelowEnabled} /><select value={profile.hideBelowCurrency} onChange={(event) => update("hideBelowCurrency", event.target.value as Currency)} disabled={!profile.hideBelowEnabled}>{Object.entries(currencyLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div><label className="switch-row"><input type="checkbox" checked={profile.hideBelowEnabled} onChange={(event) => update("hideBelowEnabled", event.target.checked)} /><span className="switch" />启用低价值隐藏</label></div><p className="field-help">仅对有价格的物品应用隐藏阈值。白名单物品始终显示，未定价物品使用所选 NeverSink 规则。</p></div></section>
      </div><aside className="side-column"><section className="panel config-summary"><h2>当前配置</h2><dl><dt>基础档位</dt><dd>{STRICTNESS_LABELS[profile.strictness]}</dd><dt>视觉风格</dt><dd>{STYLE_LABELS[profile.style]}</dd><dt>客户端语言</dt><dd>{LOCALE_LABELS[profile.locale]}</dd><dt>白名单</dt><dd>{profile.whitelist.flatMap((entry) => entry.itemIds).length} 项</dd><dt>启用光效</dt><dd>{profile.visualPresets.filter((preset) => preset.enabled).length} / {profile.visualPresets.length}</dd><dt>低价值隐藏</dt><dd>{profile.hideBelowEnabled ? "低于 " + profile.hideBelowAmount + " " + currencyShort[profile.hideBelowCurrency] : "未启用"}</dd></dl></section><button className="generate-button" onClick={generate} disabled={busy}><span>{busy ? "生成中…" : "生成过滤器"}</span><b>→</b></button>{error && <p className="error-message">{error}</p>}</aside></section> : <Preview generated={generated} onGenerate={generate} onDownload={downloadFilter} onBundle={downloadBundle} busy={busy} />}
      <footer><span>poe2-filter</span><span>模板：NeverSink · 行情：poe.ninja</span></footer>
    </main>
  );
}

function PanelHeading({ step, title, description }: { step: string; title: string; description: string }) {
  return <div className="panel-heading"><div><span className="step">{step}</span><div><h2>{title}</h2><p>{description}</p></div></div></div>;
}

function PresetEditor({ preset, market, customFile, onChange, onRemove, onSound }: { preset: VisualPreset; market: MarketSnapshot; customFile?: File; onChange: (patch: Partial<VisualPreset>) => void; onRemove: () => void; onSound: (file: File | undefined) => void }) {
  const range = preset.range;
  const setPoint = (side: "min" | "max", point?: PricePoint) => {
    onChange({ autoRange: false, range: { ...range, [side]: point } });
  };
  return <div className={"preset-editor " + (preset.enabled ? "enabled" : "")}><div className="preset-top"><label className="preset-enable"><input type="checkbox" checked={preset.enabled} onChange={(event) => onChange({ enabled: event.target.checked })} /><span>{preset.name}</span></label><input className="preset-name" value={preset.name} onChange={(event) => onChange({ name: event.target.value })} /><button className="remove-button" onClick={onRemove} aria-label={"删除 " + preset.name}>删除</button></div><div className="preset-grid"><label>NeverSink 光效<select value={preset.effect} onChange={(event) => onChange({ effect: event.target.value })}>{["Red","Red Temp","Orange","Orange Temp","Yellow","Yellow Temp","Green","Green Temp","Blue","Blue Temp","Cyan","Cyan Temp","Purple","Purple Temp","Pink","White","White Temp","Brown"].map((effect) => <option value={effect} key={effect}>{effect}</option>)}</select></label><PriceBoundEditor label="下限（含）" point={range.min} market={market} onChange={(point) => setPoint("min", point)} /><PriceBoundEditor label="上限（不含）" point={range.max} market={market} onChange={(point) => setPoint("max", point)} /></div><div className="preset-bottom">{preset.sourceItemId && !preset.autoRange && <button className="secondary-button" onClick={() => onChange({ autoRange: true })}>恢复跟随通货市价</button>}<label className="sound-file">音效<input type="file" accept="audio/mpeg,audio/wav,audio/ogg" onChange={(event) => onSound(event.target.files?.[0])} /><small>{customFile?.name || (preset.sound.type === "builtin" ? "NeverSink 内置音效 " + preset.sound.id : preset.sound.type === "custom" ? preset.sound.fileName : "NeverSink " + preset.sound.fileName)}</small></label><span className="preset-note">范围：{range.min ? formatPrice(range.min, market) : "0"} — {range.max ? formatPrice(range.max, market) : "∞"}</span></div></div>;
}

function PriceBoundEditor({ label, point, market, onChange }: { label: string; point?: PricePoint; market: MarketSnapshot; onChange: (point?: PricePoint) => void }) {
  if (point?.referenceItemId) {
    const value = toDivines(point, market.rates, market.prices);
    return <div className="price-bound"><span>{label}</span><strong>{formatPrice(point, market)}</strong><button type="button" className="secondary-button" disabled={value === undefined} onClick={() => onChange(displayPrice(value!, market.rates))}>改为固定价格</button></div>;
  }
  return <div className="price-bound"><span>{label}</span><label className="price-amount"><span className="sr-only">{label}数值</span><input type="number" min="0" step="0.01" placeholder="不限" value={point?.amount ?? ""} onChange={(event) => onChange(event.target.value === "" ? undefined : { amount: Number(event.target.value), currency: point?.currency ?? "divine" })} /></label><label><span className="sr-only">{label}单位</span><select value={point?.currency ?? "divine"} onChange={(event) => onChange({ amount: point?.amount ?? 0, currency: event.target.value as Currency })}>{Object.entries(currencyLabels).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label></div>;
}

function Preview({ generated, onGenerate, onDownload, onBundle, busy }: { generated: Generated | null; onGenerate: () => void; onDownload: () => void; onBundle: () => Promise<void>; busy: boolean }) {
  if (!generated) return <section className="empty-preview"><div className="empty-icon">⌁</div><h2>还没有生成过滤器</h2><p>在配置页设置规则后，生成并下载 .filter 文件或包含音效的 ZIP。</p><button className="generate-button small" onClick={onGenerate} disabled={busy}>开始生成 →</button></section>;
  return <section className="preview-layout"><div className="preview-main panel"><div className="preview-toolbar"><div><span className="eyebrow">生成结果</span><h2>{generated.fileName}</h2></div><div className="preview-actions"><button className="generate-button compact" onClick={onDownload}>下载 .filter <b>↓</b></button><button className="generate-button compact" onClick={() => void onBundle()}>导出 ZIP <b>↧</b></button></div></div>{!generated.safetyReport.passed && <div className="generation-error" role="alert"><strong>生成结果存在规则冲突</strong><p>请检查白名单和隐藏规则后重新生成。</p></div>}<pre className="filter-preview">{generated.filterFile.slice(0, 16000)}</pre></div><aside className="preview-side"><div className="panel"><span className="eyebrow">模板与行情</span><h3>{generated.baselineFile}</h3><dl><dt>市场来源</dt><dd>{generated.market.rates ? "poe.ninja" : "暂无可用行情"}</dd><dt>抓取时间</dt><dd>{generated.market.rates ? new Date(generated.market.capturedAt).toLocaleString("zh-CN") : "尚未更新"}</dd><dt>汇率</dt><dd>{generated.market.rates ? "1D = " + generated.market.rates.divineToChaos + "C / " + generated.market.rates.divineToExalted + "E" : "无有效汇率"}</dd></dl></div><details className="panel data-details"><summary>数据说明</summary><p>目录 {generated.safetyReport.catalogSize} 项 · 未定价 {generated.safetyReport.unpricedItems} 项 · 按原始规则处理 {generated.safetyReport.ambiguousItems} 项</p>{generated.safetyReport.warnings.map((warning) => <p key={warning}>{warning}</p>)}</details></aside></section>;
}

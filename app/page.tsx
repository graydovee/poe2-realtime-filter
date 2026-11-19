"use client";

import { useEffect, useState } from "react";
import { FALLBACK_SNAPSHOT, ITEM_CATALOG, LOCALE_LABELS, STRICTNESS_LABELS, STYLE_LABELS } from "../lib/data";
import type { Currency, FilterProfile, FilterStyle, Locale, MarketSnapshot, Strictness, VisualPreset } from "../lib/types";

import { PresetEditor } from "./components/preset-editor";
import { applyTemplateAppearances } from "../lib/neversink-appearance";
import { ItemPicker } from "./components/item-picker";
import { DEFAULT_PROFILE } from "../lib/default-profile";

import { currencyDefaultRanges, currencyPriceTiers, formatPrice } from "../lib/pricing";

const currencyLabels: Record<Currency, string> = { divine: "D · 神圣石", chaos: "C · 混沌石", exalted: "E · 崇高石" };
const currencyShort: Record<Currency, string> = { divine: "D", chaos: "C", exalted: "E" };
const safeSoundName = (value: string) => value.replace(/[^a-zA-Z0-9._-]/g, "_");


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
  const [profile, setProfile] = useState<FilterProfile>(DEFAULT_PROFILE);
  const [customSounds, setCustomSounds] = useState<Record<string, File>>({});
  const [generated, setGenerated] = useState<Generated | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<"builder" | "preview">("builder");
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

        <section className="panel" aria-labelledby="visibility-title"><div className="panel-heading"><div><span className="step">02</span><div><h2 id="visibility-title">白名单与低价值隐藏</h2><p>按物品种类选择白名单，并设置可选的价格隐藏阈值。</p></div></div></div><div className="hide-settings"><div className="hide-settings-heading"><h3>可选低价值隐藏</h3><label className="hide-toggle"><input type="checkbox" checked={profile.hideBelowEnabled} onChange={(event) => update("hideBelowEnabled", event.target.checked)} />启用低价值隐藏</label></div><div className="hide-price-fields"><label>隐藏价格阈值<input type="number" min="0" step="0.01" value={profile.hideBelowAmount} onChange={(event) => update("hideBelowAmount", Number(event.target.value))} disabled={!profile.hideBelowEnabled} /></label><label>计价单位<select value={profile.hideBelowCurrency} onChange={(event) => update("hideBelowCurrency", event.target.value as Currency)} disabled={!profile.hideBelowEnabled}>{Object.entries(currencyLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label></div><p className="field-help">启用后隐藏低于阈值的已定价物品；白名单优先，未定价物品沿用所选 NeverSink 规则。</p></div><ItemPicker locale={profile.locale} selectedIds={profile.whitelist.flatMap((entry) => entry.itemIds)} onToggle={toggleWhitelist} /></section>

        <section className="panel"><PanelHeading step="03" title="价格光效规则" description="默认使用崇高石、混沌石、剥离石、神圣石的原始光效，先统一换算成 E，再从低到高排序划分区间。可改为固定 D / C / E 价格；重叠范围按列表顺序匹配。" /><div className="currency-value-list">{currencyPriceTiers(market).map((tier) => <div key={tier.itemId}><span>{tier.name}</span><strong>{formatPrice({ amount: tier.exaltedValue, currency: "exalted" })}</strong></div>)}</div><div className="preset-list">{currencyDefaultRanges(applyTemplateAppearances(profile.visualPresets, profile), market).map((preset) => <PresetEditor key={preset.id} preset={preset} template={profile} market={market} customFile={customSounds[preset.id]} onChange={(patch) => updatePreset(preset.id, patch)} onRemove={() => removePreset(preset.id)} onSound={(file) => { if (!file) return; setCustomSounds((current) => ({ ...current, [preset.id]: file })); updatePreset(preset.id, { sound: { type: "custom", fileName: safeSoundName(file.name) } }); }} />)}</div><button className="secondary-button" onClick={addPreset}>＋ 新增光效预设</button></section>

        <section className="panel"><PanelHeading step="04" title="等级与基础视觉" description="设置等级条件、字体大小和显示效果。" /><div className="range-grid"><label>物品等级下限<strong>{profile.itemLevelMin}</strong><input type="range" min="1" max="86" value={profile.itemLevelMin} onChange={(event) => update("itemLevelMin", Number(event.target.value))} /></label><label>区域等级下限<strong>{profile.areaLevelMin}</strong><input type="range" min="1" max="86" value={profile.areaLevelMin} onChange={(event) => update("areaLevelMin", Number(event.target.value))} /></label><label>字体大小<strong>{profile.visuals.fontSize}</strong><input type="range" min="18" max="48" value={profile.visuals.fontSize} onChange={(event) => update("visuals", { ...profile.visuals, fontSize: Number(event.target.value) })} /></label></div><div className="checks"><label><input type="checkbox" checked={profile.visuals.showBeams} onChange={(event) => update("visuals", { ...profile.visuals, showBeams: event.target.checked })} />掉落光束</label><label><input type="checkbox" checked={profile.visuals.showMinimapIcons} onChange={(event) => update("visuals", { ...profile.visuals, showMinimapIcons: event.target.checked })} />小地图图标</label></div></section>
      </div><aside className="side-column"><section className="panel config-summary"><h2>当前配置</h2><dl><dt>基础档位</dt><dd>{STRICTNESS_LABELS[profile.strictness]}</dd><dt>视觉风格</dt><dd>{STYLE_LABELS[profile.style]}</dd><dt>客户端语言</dt><dd>{LOCALE_LABELS[profile.locale]}</dd><dt>白名单</dt><dd>{profile.whitelist.flatMap((entry) => entry.itemIds).length} 项</dd><dt>启用光效</dt><dd>{profile.visualPresets.filter((preset) => preset.enabled).length} / {profile.visualPresets.length}</dd><dt>低价值隐藏</dt><dd>{profile.hideBelowEnabled ? "低于 " + profile.hideBelowAmount + " " + currencyShort[profile.hideBelowCurrency] : "未启用"}</dd></dl></section><button className="generate-button" onClick={generate} disabled={busy}><span>{busy ? "生成中…" : "生成过滤器"}</span><b>→</b></button>{error && <p className="error-message">{error}</p>}</aside></section> : <Preview generated={generated} onGenerate={generate} onDownload={downloadFilter} onBundle={downloadBundle} busy={busy} />}
      <footer><span>poe2-filter</span><span>模板：NeverSink · 行情：poe.ninja</span></footer>
    </main>
  );
}

function PanelHeading({ step, title, description }: { step: string; title: string; description: string }) {
  return <div className="panel-heading"><div><span className="step">{step}</span><div><h2>{title}</h2><p>{description}</p></div></div></div>;
}

function Preview({ generated, onGenerate, onDownload, onBundle, busy }: { generated: Generated | null; onGenerate: () => void; onDownload: () => void; onBundle: () => Promise<void>; busy: boolean }) {
  if (!generated) return <section className="empty-preview"><div className="empty-icon">⌁</div><h2>还没有生成过滤器</h2><p>在配置页设置规则后，生成并下载 .filter 文件或包含音效的 ZIP。</p><button className="generate-button small" onClick={onGenerate} disabled={busy}>开始生成 →</button></section>;
  return <section className="preview-layout"><div className="preview-main panel"><div className="preview-toolbar"><div><span className="eyebrow">生成结果</span><h2>{generated.fileName}</h2></div><div className="preview-actions"><button className="generate-button compact" onClick={onDownload}>下载 .filter <b>↓</b></button><button className="generate-button compact" onClick={() => void onBundle()}>导出 ZIP <b>↧</b></button></div></div>{!generated.safetyReport.passed && <div className="generation-error" role="alert"><strong>生成结果存在规则冲突</strong><p>请检查白名单和隐藏规则后重新生成。</p></div>}<pre className="filter-preview">{generated.filterFile.slice(0, 16000)}</pre></div><aside className="preview-side"><div className="panel"><span className="eyebrow">模板与行情</span><h3>{generated.baselineFile}</h3><dl><dt>市场来源</dt><dd>{generated.market.rates ? "poe.ninja" : "暂无可用行情"}</dd><dt>抓取时间</dt><dd>{generated.market.rates ? new Date(generated.market.capturedAt).toLocaleString("zh-CN") : "尚未更新"}</dd><dt>汇率</dt><dd>{generated.market.rates ? "1D = " + generated.market.rates.divineToChaos + "C / " + generated.market.rates.divineToExalted + "E" : "无有效汇率"}</dd></dl></div><details className="panel data-details"><summary>数据说明</summary><p>目录 {generated.safetyReport.catalogSize} 项 · 未定价 {generated.safetyReport.unpricedItems} 项 · 按原始规则处理 {generated.safetyReport.ambiguousItems} 项</p>{generated.safetyReport.warnings.map((warning) => <p key={warning}>{warning}</p>)}</details></aside></section>;
}

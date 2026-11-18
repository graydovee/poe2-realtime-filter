"use client";

import { useMemo, useState } from "react";
import { CATEGORY_LABELS, ITEM_CATALOG, LOCALE_LABELS, STRICTNESS_LABELS, STYLE_LABELS } from "../lib/data";
import type { Currency, FilterProfile, FilterStyle, Locale, Strictness } from "../lib/types";

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
  sound: { pack: "neversink", alertLevel: "economy" },
  visuals: {
    showBeams: true,
    showMinimapIcons: true,
    fontSize: 32,
    highValueColor: "255 220 90",
    valuableColor: "80 210 255",
    unknownColor: "255 120 220",
  },
};

const currencyLabels: Record<Currency, string> = { divine: "神圣石", exalted: "崇高石", chaos: "混沌石" };

export default function HomePage() {
  const [profile, setProfile] = useState<FilterProfile>(initialProfile);
  const [customSound, setCustomSound] = useState<File | null>(null);
  const [generated, setGenerated] = useState<{ filterFile: string; fileName: string; safetyReport: { passed: boolean; warnings: string[]; unknownItems: number; hiddenHighValueItems: string[]; coveredItems: number; catalogSize: number }; baselineFile: string; market: { source: string; capturedAt: string; expiresAt: string } } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<"builder" | "preview">("builder");

  const groupedItems = useMemo(() => {
    return ITEM_CATALOG.reduce<Record<string, typeof ITEM_CATALOG>>((acc, item) => {
      acc[item.category] ??= [];
      acc[item.category].push(item);
      return acc;
    }, {});
  }, []);

  function update<K extends keyof FilterProfile>(key: K, value: FilterProfile[K]) {
    setProfile((current) => ({ ...current, [key]: value }));
  }

  async function generate() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...profile, sound: { ...profile.sound, customFileName: customSound?.name } }) });
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
    const blob = new Blob([generated.filterFile], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = generated.fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function downloadBundle() {
    const form = new FormData();
    form.set("profile", JSON.stringify({ ...profile, sound: { ...profile.sound, customFileName: customSound?.name } }));
    if (customSound) form.set("sound", customSound);
    const response = await fetch("/api/export", { method: "POST", body: form });
    if (!response.ok) throw new Error("ZIP 导出失败");
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "poe2-filter.zip";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function downloadManifest() {
    if (!generated) return;
    const manifest = JSON.stringify({ generatedAt: new Date().toISOString(), baseline: generated.baselineFile, sound: customSound?.name || "NeverSink CUSTOMSOUNDS", safety: generated.safetyReport, market: generated.market }, null, 2);
    const blob = new Blob([manifest], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "poe2-filter-manifest.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">◈</span><div><strong>poe2-filter</strong><span>安全优先的过滤器生成器</span></div></div>
        <div className="topbar-meta"><span className="version-dot" /> 数据快照 <b>NeverSink · 0.10.4a</b></div>
      </header>

      <section className="hero">
        <div>
          <p className="eyebrow">PATH OF EXILE 2 · DAILY ECONOMY</p>
          <h1>先保证看见，<em>再决定隐藏。</em></h1>
          <p className="hero-copy">选择 NeverSink 基础档位，叠加每日物价高亮，并用白名单和安全检查把高价值物品留在屏幕上。</p>
        </div>
        <div className="safety-card"><div className="safety-icon">✓</div><div><span>安全策略</span><strong>未知物品默认显示</strong><small>价格数据失效时回退基础模板</small></div></div>
      </section>

      <div className="tabbar"><button className={activeTab === "builder" ? "active" : ""} onClick={() => setActiveTab("builder")}>配置过滤器</button><button className={activeTab === "preview" ? "active" : ""} onClick={() => setActiveTab("preview")}>预览与导出</button><span className="tab-spacer" /><span className="sync-status"><i /> 价格快照 6 小时更新</span></div>

      {activeTab === "builder" ? <section className="workspace">
        <div className="main-column">
          <section className="panel panel-large"><div className="panel-heading"><div><span className="step">01</span><div><h2>选择基础过滤器</h2><p>NeverSink 原始规则保持完整，只在前面添加你的微调。</p></div></div><span className="source-pill">NeverSink PoE2</span></div>
            <div className="strictness-grid">{(Object.keys(STRICTNESS_LABELS) as unknown as Strictness[]).map((level) => <button key={level} className={`strictness ${profile.strictness === level ? "selected" : ""}`} onClick={() => update("strictness", level)}><span className="strict-number">{level}</span><span><b>{STRICTNESS_LABELS[level]}</b><small>{level < 2 ? "显示更多物品" : level > 4 ? "专注高价值" : "推荐起点"}</small></span></button>)}</div>
            <div className="inline-fields"><label>视觉风格<select value={profile.style} onChange={(event) => update("style", event.target.value as FilterStyle)}>{Object.entries(STYLE_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>客户端语言<select value={profile.locale} onChange={(event) => update("locale", event.target.value as Locale)}>{Object.entries(LOCALE_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label></div>
          </section>

          <section className="panel"><div className="panel-heading"><div><span className="step">02</span><div><h2>每日物价与隐藏</h2><p>默认只改变高亮；开启后才会隐藏低于阈值的已知物品。</p></div></div><span className="fresh-pill">● LIVE FALLBACK</span></div>
            <div className="price-layout"><div className="price-hero"><span className="price-label">隐藏低于</span><div className="price-input"><input type="number" min="0" step="0.05" value={profile.hideBelowAmount} onChange={(event) => update("hideBelowAmount", Number(event.target.value))} disabled={!profile.hideBelowEnabled} /><select value={profile.hideBelowCurrency} onChange={(event) => update("hideBelowCurrency", event.target.value as Currency)} disabled={!profile.hideBelowEnabled}>{Object.entries(currencyLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div><label className="switch-row"><input type="checkbox" checked={profile.hideBelowEnabled} onChange={(event) => update("hideBelowEnabled", event.target.checked)} /><span className="switch" />启用低价值隐藏</label></div><div className="price-note"><div className="mini-stat"><b>6h</b><span>更新周期</span></div><div className="mini-stat"><b>3 层</b><span>失效回退</span></div><div className="mini-stat"><b>0</b><span>高价值误藏</span></div></div></div>
          </section>

          <section className="panel"><div className="panel-heading"><div><span className="step">03</span><div><h2>等级与视觉</h2><p>控制显示规模和屏幕识别信号。</p></div></div></div><div className="range-grid"><label>物品等级下限<strong>{profile.itemLevelMin}</strong><input type="range" min="1" max="86" value={profile.itemLevelMin} onChange={(event) => update("itemLevelMin", Number(event.target.value))} /></label><label>区域等级下限<strong>{profile.areaLevelMin}</strong><input type="range" min="1" max="86" value={profile.areaLevelMin} onChange={(event) => update("areaLevelMin", Number(event.target.value))} /></label><label>字体大小<strong>{profile.visuals.fontSize}</strong><input type="range" min="18" max="48" value={profile.visuals.fontSize} onChange={(event) => update("visuals", { ...profile.visuals, fontSize: Number(event.target.value) })} /></label></div><div className="checks"><label><input type="checkbox" checked={profile.visuals.showBeams} onChange={(event) => update("visuals", { ...profile.visuals, showBeams: event.target.checked })} />掉落光束</label><label><input type="checkbox" checked={profile.visuals.showMinimapIcons} onChange={(event) => update("visuals", { ...profile.visuals, showMinimapIcons: event.target.checked })} />小地图图标</label></div></section>
        </div>

        <aside className="side-column"><section className="panel sound-panel"><div className="panel-heading"><div><span className="step">04</span><div><h2>声音</h2><p>默认使用 NeverSink 音效。</p></div></div></div><div className="sound-options"><label className={`sound-option ${profile.sound.pack === "neversink" ? "selected" : ""}`}><input type="radio" checked={profile.sound.pack === "neversink"} onChange={() => update("sound", { ...profile.sound, pack: "neversink" })} /><span className="sound-icon">◖</span><span><b>NeverSink 音效包</b><small>3 个价值层级</small></span><span className="radio-dot" /></label><label className={`sound-option ${profile.sound.pack === "custom" ? "selected" : ""}`}><input type="radio" checked={profile.sound.pack === "custom"} onChange={() => update("sound", { ...profile.sound, pack: "custom" })} /><span className="sound-icon">↥</span><span><b>上传自定义音效</b><small>{customSound ? customSound.name : "MP3 / WAV"}</small></span><span className="radio-dot" /></label></div><label className="upload-box"><input type="file" accept="audio/mpeg,audio/wav,audio/ogg" onChange={(event) => setCustomSound(event.target.files?.[0] || null)} /><span>拖入或选择音频文件</span><small>生成时会记录到导出清单</small></label></section>
          <section className="panel whitelist-panel"><div className="panel-heading"><div><span className="step">05</span><div><h2>白名单</h2><p>低于阈值也永远显示。</p></div></div></div><div className="whitelist-list">{["divine-orb", "mirror-of-kalandra", "temporalis", "advanced-dualstring-bow"].map((id) => { const item = ITEM_CATALOG.find((entry) => entry.id === id)!; const checked = profile.whitelist.some((entry) => entry.itemIds.includes(id)); return <label key={id}><input type="checkbox" checked={checked} onChange={(event) => { const next = profile.whitelist.filter((entry) => !entry.itemIds.includes(id)); if (event.target.checked) next.push({ id: `wl-${id}`, label: item.name, itemIds: [id] }); update("whitelist", next); }} /><span>{item.localeNames[profile.locale]}</span><small>{CATEGORY_LABELS[item.category][profile.locale]}</small></label>; })}</div></section>
          <section className="panel coverage-panel"><div className="coverage-head"><span className="coverage-ring">✓</span><div><strong>覆盖率保护</strong><span>NeverSink 基础规则已加载</span></div></div><div className="coverage-bar"><span style={{ width: "100%" }} /></div><div className="coverage-foot"><span>已处理物品类型</span><b>全量基线</b></div></section>
          <button className="generate-button" onClick={generate} disabled={busy}><span>{busy ? "生成中…" : "生成我的过滤器"}</span><b>→</b></button>{error && <p className="error-message">{error}</p>}
        </aside>
      </section> : <Preview generated={generated} onGenerate={generate} onDownload={downloadFilter} onBundle={downloadBundle} onManifest={downloadManifest} busy={busy} />}

      <footer><span>poe2-filter · 数据优先，安全回退</span><span>NeverSink 基础规则 · 三语支持 · MIT-compatible</span></footer>
    </main>
  );
}

function Preview({ generated, onGenerate, onDownload, onBundle, onManifest, busy }: { generated: HomePageProps["generated"]; onGenerate: () => void; onDownload: () => void; onBundle: () => Promise<void>; onManifest: () => void; busy: boolean }) {
  if (!generated) return <section className="empty-preview"><div className="empty-icon">⌁</div><h2>还没有生成过滤器</h2><p>完成配置后生成预览，安全检查会在下载前自动运行。</p><button className="generate-button small" onClick={onGenerate} disabled={busy}>开始生成 →</button></section>;
  return <section className="preview-layout"><div className="preview-main panel"><div className="preview-toolbar"><div><span className="eyebrow">GENERATED FILTER</span><h2>{generated.fileName}</h2></div><div className="preview-actions"><button onClick={onManifest}>下载清单</button><button className="generate-button compact" onClick={onDownload}>下载 .filter <b>↓</b></button><button className="generate-button compact" onClick={() => void onBundle()}>导出 ZIP <b>↧</b></button></div></div><div className="safety-result"><span className={generated.safetyReport.passed ? "pass-icon" : "fail-icon"}>{generated.safetyReport.passed ? "✓" : "!"}</span><div><strong>{generated.safetyReport.passed ? "安全检查通过" : "需要处理风险"}</strong><span>基础规则覆盖 {generated.safetyReport.coveredItems} 条 BaseType/Class 匹配 · {generated.safetyReport.unknownItems} 个未知覆盖项采用警示显示</span></div></div><pre className="filter-preview">{generated.filterFile.slice(0, 12000)}</pre></div><aside className="preview-side"><div className="panel"><span className="eyebrow">SOURCE</span><h3>{generated.baselineFile}</h3><p>基础规则保持原样，覆盖层位于文件最前端。</p><dl><dt>市场来源</dt><dd>{generated.market.source}</dd><dt>抓取时间</dt><dd>{new Date(generated.market.capturedAt).toLocaleString("zh-CN")}</dd><dt>失效时间</dt><dd>{new Date(generated.market.expiresAt).toLocaleString("zh-CN")}</dd></dl></div><div className="panel warning-panel"><span className="eyebrow">SAFETY NOTES</span>{generated.safetyReport.warnings.map((warning) => <p key={warning}>• {warning}</p>)}</div></aside></section>;
}

type HomePageProps = { generated: { filterFile: string; fileName: string; safetyReport: { passed: boolean; warnings: string[]; unknownItems: number; hiddenHighValueItems: string[]; coveredItems: number; catalogSize: number }; baselineFile: string; market: { source: string; capturedAt: string; expiresAt: string } } | null };

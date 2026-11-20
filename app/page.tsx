"use client";

import { useEffect, useRef, useState } from "react";

import { FALLBACK_SNAPSHOT, ITEM_CATALOG } from "../lib/data";
import type { Currency, FilterProfile, FilterStyle, LeagueCatalog, Locale, MarketSnapshot, Strictness, VisualPreset } from "../lib/types";

import { applyTemplateAppearances } from "../lib/neversink-appearance";
import { DEFAULT_PROFILE } from "../lib/default-profile";
import { currencyDefaultRanges, currencyPriceTiers, formatPrice } from "../lib/pricing";

import { AppShell } from "./components/app-shell";
import { PreviewView, type Generated } from "./components/preview-view";
import { SchemeManager } from "./components/scheme-manager";
import { BasicFilterSection } from "./components/sections/basic-filter-section";
import { PresetsSection } from "./components/sections/presets-section";
import { SeasonSection } from "./components/sections/season-section";
import { SummarySidebar } from "./components/sections/summary-sidebar";
import { VisualsSection } from "./components/sections/visuals-section";
import { WhitelistSection } from "./components/sections/whitelist-section";
import { TabBar } from "./components/ui/nav";

const safeSoundName = (value: string) => value.replace(/[^a-zA-Z0-9._-]/g, "_");

export default function HomePage() {
  const [market, setMarket] = useState<MarketSnapshot>(FALLBACK_SNAPSHOT);
  const [profile, setProfile] = useState<FilterProfile>(DEFAULT_PROFILE);
  const [customSounds, setCustomSounds] = useState<Record<string, File>>({});
  const [generated, setGenerated] = useState<Generated | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<"builder" | "preview">("builder");
  const [leagueCatalog, setLeagueCatalog] = useState<LeagueCatalog | null>(null);
  const [leaguesLoading, setLeaguesLoading] = useState(true);
  const [marketLoading, setMarketLoading] = useState(true);
  const [marketError, setMarketError] = useState("");
  const requestVersion = useRef(0);
  const selectedMarket: MarketSnapshot = market.league === profile.league ? market : { ...FALLBACK_SNAPSHOT, league: profile.league };

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/leagues", { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("无法获取赛季列表");
      return response.json() as Promise<LeagueCatalog>;
    }).then((catalog) => {
      if (controller.signal.aborted) return;
      setLeagueCatalog(catalog);
      if (catalog.defaultLeague !== DEFAULT_PROFILE.league) {
        requestVersion.current += 1;
        setProfile((current) => ({ ...current, league: catalog.defaultLeague, originalLeague: catalog.defaultLeague }));
        setGenerated(null);
        setBusy(false);
      }
    }).catch(() => {
      if (!controller.signal.aborted) setMarketError("暂时无法更新赛季列表，请稍后刷新重试。");
    }).finally(() => { if (!controller.signal.aborted) setLeaguesLoading(false); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const league = profile.league;
    setMarket({ ...FALLBACK_SNAPSHOT, league });
    setMarketLoading(true);
    setMarketError("");
    fetch("/api/market?league=" + encodeURIComponent(league), { signal: controller.signal }).then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "行情加载失败");
      if (payload.league !== league) throw new Error("返回的行情与所选赛季不一致");
      if (!controller.signal.aborted) {
        setMarket(payload);
        if (!payload.rates) setMarketError("该赛季暂无可用行情，物品将使用 NeverSink 原始规则。");
      }
    }).catch((cause) => {
      if (!controller.signal.aborted) setMarketError(cause instanceof Error ? cause.message : "行情加载失败");
    }).finally(() => { if (!controller.signal.aborted) setMarketLoading(false); });
    return () => controller.abort();
  }, [profile.league]);

  function selectLeague(league: string) {
    requestVersion.current += 1;
    setProfile((current) => ({ ...current, league, originalLeague: league }));
    setMarket({ ...FALLBACK_SNAPSHOT, league });
    setMarketLoading(true);
    setGenerated(null);
    setBusy(false);
    setError("");
    setMarketError("");
    setActiveTab("builder");
  }

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
    const version = requestVersion.current;
    const league = profile.league;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(profile) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "生成失败");
      if (version !== requestVersion.current) return;
      if (payload.market?.league !== league) throw new Error("生成结果与所选赛季不一致");
      setGenerated(payload);
      setActiveTab("preview");
    } catch (cause) {
      if (version === requestVersion.current) setError(cause instanceof Error ? cause.message : "生成失败");
    } finally {
      if (version === requestVersion.current) setBusy(false);
    }
  }

  function downloadFilter() {
    if (!generated) return;
    const url = URL.createObjectURL(new Blob([generated.filterFile], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = generated.fileName; anchor.click(); URL.revokeObjectURL(url);
  }

  async function downloadBundle() {
    const version = requestVersion.current;
    const form = new FormData();
    form.set("profile", JSON.stringify(profile));
    for (const [id, file] of Object.entries(customSounds)) form.set("sound:" + id, file);
    const response = await fetch("/api/export", { method: "POST", body: form });
    if (!response.ok) throw new Error("ZIP 导出失败");
    const blob = await response.blob();
    if (version !== requestVersion.current) return;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "poe2-filter.zip"; anchor.click(); URL.revokeObjectURL(url);
  }

  return (
    <AppShell>
      <div className="flex min-w-0 flex-col gap-4 pt-6">
        <SeasonSection
          profile={profile}
          leagueCatalog={leagueCatalog}
          leaguesLoading={leaguesLoading}
          marketLoading={marketLoading}
          marketError={marketError}
          selectedMarket={selectedMarket}
          onLeagueChange={selectLeague}
        />

        <SchemeManager
          profile={profile}
          sounds={customSounds}
          leagueCatalog={leagueCatalog}
          onOpen={(nextProfile, sounds) => {
            requestVersion.current += 1;
            setProfile(nextProfile);
            setCustomSounds(sounds);
            setGenerated(null);
            setActiveTab("builder");
          }}
        />

        <TabBar
          value={activeTab}
          onChange={setActiveTab}
          items={[
            { value: "builder", label: "配置过滤器" },
            { value: "preview", label: "预览与导出" },
          ]}
          trailing={<span className="font-mono text-[10px] uppercase tracking-[0.14em]">价格单位 D / C / E</span>}
        />

        {activeTab === "builder" ? (
          <div className="grid min-w-0 gap-4 pt-2 lg:grid-cols-[minmax(0,1fr)_minmax(15.5rem,17.5rem)]">
            <div className="flex min-w-0 flex-col gap-4">
              <BasicFilterSection
                profile={profile}
                onStrictnessChange={(level: Strictness) => update("strictness", level)}
                onStyleChange={(style: FilterStyle) => update("style", style)}
                onLocaleChange={(locale: Locale) => update("locale", locale)}
              />
              <WhitelistSection
                profile={profile}
                onHideEnabled={(enabled) => update("hideBelowEnabled", enabled)}
                onHideAmount={(amount) => update("hideBelowAmount", amount)}
                onHideCurrency={(currency: Currency) => update("hideBelowCurrency", currency)}
                onToggleItem={toggleWhitelist}
              />
              <PresetsSection
                profile={profile}
                market={selectedMarket}
                customSounds={customSounds}
                onPresetChange={updatePreset}
                onRemovePreset={removePreset}
                onAddPreset={addPreset}
                onSound={(id, file) => {
                  if (!file) return;
                  setCustomSounds((current) => ({ ...current, [id]: file }));
                  updatePreset(id, { sound: { type: "custom", fileName: safeSoundName(file.name) } });
                }}
              />
              <VisualsSection
                visuals={profile.visuals}
                itemLevelMin={profile.itemLevelMin}
                areaLevelMin={profile.areaLevelMin}
                onItemLevelMin={(value) => update("itemLevelMin", value)}
                onAreaLevelMin={(value) => update("areaLevelMin", value)}
                onFontSize={(value) => update("visuals", { ...profile.visuals, fontSize: value })}
                onShowBeams={(value) => update("visuals", { ...profile.visuals, showBeams: value })}
                onShowMinimapIcons={(value) => update("visuals", { ...profile.visuals, showMinimapIcons: value })}
              />
            </div>

            <SummarySidebar
              profile={profile}
              busy={busy}
              disabled={marketLoading || leaguesLoading}
              error={error}
              onGenerate={() => void generate()}
            />
          </div>
        ) : (
          <div className="pt-2">
            <PreviewView
              generated={generated}
              profile={profile}
              sounds={customSounds}
              onGenerate={() => void generate()}
              onDownload={downloadFilter}
              onBundle={downloadBundle}
              busy={busy}
            />
          </div>
        )}
      </div>
    </AppShell>
  );
}

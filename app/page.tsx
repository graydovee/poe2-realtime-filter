"use client";

import { listen } from "@tauri-apps/api/event";
import { explain, isDesktop, local } from "../lib/desktop";
import { useEffect, useRef, useState } from "react";

import { FALLBACK_SNAPSHOT } from "../lib/data";
import type { FilterProfile, FilterRule, FilterStyle, LeagueCatalog, Locale, MarketSnapshot, Strictness } from "../lib/types";

import { DEFAULT_PROFILE } from "../lib/default-profile";

import { AppShell } from "./components/app-shell";
import { PreviewView, type Generated } from "./components/preview-view";
import { SchemeManager } from "./components/scheme-manager";
import { BasicFilterSection } from "./components/sections/basic-filter-section";
import { ExcludedItemsSection } from "./components/sections/excluded-items-section";
import { RulesSection } from "./components/sections/rules-section";
import { SeasonSection } from "./components/sections/season-section";
import { SummarySidebar } from "./components/sections/summary-sidebar";
import type { ItemPickerToggle } from "./components/item-picker";
import { TabBar } from "./components/ui/nav";

const safeSoundName = (value: string) => value.replace(/[^a-zA-Z0-9._-]/g, "_");

export default function HomePage() {
  const [market, setMarket] = useState<MarketSnapshot>(FALLBACK_SNAPSHOT);
  const [schemeId, setSchemeId] = useState<string | null>(null);
  const [profile, setProfile] = useState<FilterProfile>(DEFAULT_PROFILE);
  const [customSounds, setCustomSounds] = useState<Record<string, File>>({});
  const [generated, setGenerated] = useState<Generated | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<"builder" | "preview">("builder");
  const [leagueCatalog, setLeagueCatalog] = useState<LeagueCatalog | null>(null);
  const leaguesLoading = false;
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketError, setMarketError] = useState("");
  const requestVersion = useRef(0);
  const leagueChosen = useRef(false);
  const selectedMarket: MarketSnapshot = market.league === profile.league && Date.parse(market.expiresAt) >= Date.now() ? market : { ...FALLBACK_SNAPSHOT, league: profile.league };

  useEffect(() => {
    if (!isDesktop()) return;
    let active = true;
    const load = async () => {
      const catalog = await local<LeagueCatalog>("local_catalog");
      if (!active) return;
      setLeagueCatalog(catalog);
      if (!leagueChosen.current) {
        setProfile((current) => catalog.defaultLeague === current.league ? current : { ...current, league: catalog.defaultLeague, originalLeague: catalog.defaultLeague });
      }
    };
    void load().catch(() => {});
    const listener = listen<string | null>("local-refresh", ({ payload }) => {
      void load().catch(() => {});
      if (active) setMarketError(payload || "");
    });
    return () => { active = false; void listener.then((unlisten) => unlisten()).catch(() => {}); };
  }, []);

  useEffect(() => {
    if (!isDesktop()) return;
    let active = true;
    const league = profile.league;
    const load = async () => {
      const cached = await local<MarketSnapshot | null>("local_market", { league });
      if (active) setMarket(cached ?? { ...FALLBACK_SNAPSHOT, league });
    };
    void load().catch(() => {});
    const listener = listen("local-refresh", () => { void load().catch(() => {}); });
    return () => { active = false; void listener.then((unlisten) => unlisten()).catch(() => {}); };
  }, [profile.league]);

  async function refreshMarket() {
    setMarketLoading(true);
    setMarketError("");
    try { await local("refresh_market", { league: profile.league }); }
    catch (error) { setMarketError(explain(error)); throw error; }
    finally { setMarketLoading(false); }
  }

  function selectLeague(league: string) {
    leagueChosen.current = true;
    requestVersion.current += 1;
    setProfile((current) => ({ ...current, league, originalLeague: league }));
    setMarket({ ...FALLBACK_SNAPSHOT, league });
    setMarketLoading(false);
    setGenerated(null);
    setBusy(false);
    setError("");
    setMarketError("");
    setActiveTab("builder");
  }

  function update<K extends keyof FilterProfile>(key: K, value: FilterProfile[K]) {
    setProfile((current) => ({ ...current, [key]: value }));
  }

  function updateRule(id: string, patch: Partial<FilterRule>) {
    setProfile((current) => ({
      ...current,
      rules: current.rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)),
    }));
  }

  function addRule() {
    setProfile((current) => ({
      ...current,
      rules: [
        ...current.rules,
        {
          id: "rule-" + Date.now().toString(36),
          name: "新规则 " + (current.rules.length + 1),
          enabled: true,
          hidden: false,
          target: { itemIds: [], itemEnabled: true, priceEnabled: true, range: { min: { amount: 1, currency: "exalted" } } },
          effects: {},
        },
      ],
    }));
  }

  function removeRule(id: string) {
    setProfile((current) => ({ ...current, rules: current.rules.filter((rule) => rule.id !== id) }));
    setCustomSounds((current) => {
      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  function moveRule(id: string, delta: number) {
    setProfile((current) => {
      const index = current.rules.findIndex((rule) => rule.id === id);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= current.rules.length) return current;
      const rules = [...current.rules];
      const [rule] = rules.splice(index, 1);
      rules.splice(target, 0, rule);
      return { ...current, rules };
    });
  }

  function toggleSkipped({ ids, checked }: ItemPickerToggle) {
    setProfile((current) => {
      const next = new Set(current.skippedItemIds);
      for (const id of ids) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return { ...current, skippedItemIds: [...next] };
    });
  }

  function clearSkipped() {
    update("skippedItemIds", []);
  }

  function setRuleSound(id: string, file: File | undefined) {
    if (!file) return;
    setCustomSounds((current) => ({ ...current, [id]: file }));
    updateRule(id, { effects: { ...(profile.rules.find((rule) => rule.id === id)?.effects ?? {}), sound: { type: "custom", fileName: safeSoundName(file.name) } } });
  }

  async function generate() {
    const version = requestVersion.current;
    const league = profile.league;
    setBusy(true);
    setError("");
    try {
      const payload = await local<Generated>("preview", { profile });
      if (version !== requestVersion.current) return;
      if (payload.market?.league !== league) throw new Error("生成结果与所选赛季不一致");
      setGenerated(payload);
      setActiveTab("preview");
    } catch (cause) {
      if (version === requestVersion.current) setError(explain(cause));
    } finally {
      if (version === requestVersion.current) setBusy(false);
    }
  }

  function downloadFilter() {
    if (generated) void local("export_filter", { name: generated.fileName, text: generated.filterFile }).catch((error) => setError(explain(error)));
  }

  async function downloadBundle() {
    if (!schemeId) { setError("请先保存方案再导出 ZIP"); return; }
    try { await local("export_bundle", { id: schemeId }); }
    catch (error) { setError(explain(error)); }
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
          selectedMarket={market.league === profile.league ? market : selectedMarket}
          onLeagueChange={selectLeague}
        />

        <SchemeManager
          profile={profile}
          sounds={customSounds}
          onRefresh={refreshMarket}
          onNew={() => {
            leagueChosen.current = true;
            requestVersion.current += 1;
            setBusy(false);
            setSchemeId(null);
            setCustomSounds({});
            setProfile({ ...DEFAULT_PROFILE, league: profile.league, originalLeague: profile.league });
            setGenerated(null);
            setError("");
            setActiveTab("builder");
          }}
          onOpen={(nextProfile, sounds, id) => {
            setSchemeId(id);
            leagueChosen.current = true;
            requestVersion.current += 1;
            setProfile(nextProfile);
            setCustomSounds(sounds);
            setGenerated(null);
            setBusy(false);
            setError("");
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
          trailing={<span className="text-xs">价格单位 D / C / E</span>}
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
              <ExcludedItemsSection profile={profile} onToggleItems={toggleSkipped} onClear={clearSkipped} />
              <RulesSection
                profile={profile}
                market={selectedMarket}
                customSounds={customSounds}
                onRuleChange={updateRule}
                onRemoveRule={removeRule}
                onAddRule={addRule}
                onMoveRule={moveRule}
                onSound={setRuleSound}
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
            {error && <p role="alert" className="mb-2 text-sm text-ember">{error}</p>}
            <PreviewView
              generated={generated}
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
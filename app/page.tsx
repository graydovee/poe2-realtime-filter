"use client";

import { listen } from "@tauri-apps/api/event";
import { explain, fileToBase64, isDesktop, local, readSound, type LocalScheme } from "../lib/desktop";
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
import { ConfirmDialog } from "./components/ui/confirm-dialog";
import { TextInput } from "./components/ui/controls";
import { TabBar } from "./components/ui/nav";
import { Button, Panel } from "./components/ui/primitives";

const safeSoundName = (value: string) => value.replace(/[^a-zA-Z0-9._-]/g, "_");

export default function HomePage() {
  const [market, setMarket] = useState<MarketSnapshot>(FALLBACK_SNAPSHOT);
  const [view, setView] = useState<"subscriptions" | "editor">("subscriptions");
  const [schemeId, setSchemeId] = useState<string | null>(null);
  const [schemeName, setSchemeName] = useState("");
  const [schemeBusy, setSchemeBusy] = useState(false);
  const [schemeRevision, setSchemeRevision] = useState(0);
  const [saveFeedback, setSaveFeedback] = useState("");
  const [saveError, setSaveError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [pendingScheme, setPendingScheme] = useState<LocalScheme | null>();
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
    const listener = listen("local-refresh", () => { void load().catch(() => {}); });
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
    catch (error) { setMarketError(explain(error)); }
    finally { setMarketLoading(false); }
  }

  function selectLeague(league: string) {
    setDirty(true);
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
    setDirty(true);
    setProfile((current) => ({ ...current, [key]: value }));
  }

  function updateRule(id: string, patch: Partial<FilterRule>) {
    setDirty(true);
    setProfile((current) => ({
      ...current,
      rules: current.rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)),
    }));
  }

  function addRule() {
    setDirty(true);
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
    setDirty(true);
    setProfile((current) => ({ ...current, rules: current.rules.filter((rule) => rule.id !== id) }));
    setCustomSounds((current) => {
      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  function moveRule(id: string, delta: number) {
    setDirty(true);
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
    setDirty(true);
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

  function requestDraft(scheme: LocalScheme | null) {
    if (scheme && scheme.id === schemeId) {
      setView("editor");
    } else if (dirty) {
      setPendingScheme(scheme);
    } else {
      void openDraft(scheme);
    }
  }

  async function openDraft(scheme: LocalScheme | null) {
    setSchemeBusy(true);
    const soundFiles: Record<string, File> = {};
    const missing = new Set<string>();
    if (scheme) {
      const reads = new Map<string, Promise<File>>();
      await Promise.all(scheme.profile.rules.map(async (rule) => {
        const sound = rule.effects.sound;
        if (sound?.type !== "custom") return;
        let file = reads.get(sound.fileName);
        if (!file) {
          file = readSound(sound.fileName, scheme.id, true);
          reads.set(sound.fileName, file);
        }
        try { soundFiles[rule.id] = await file; }
        catch { missing.add(sound.fileName); }
      }));
    }
    leagueChosen.current = true;
    requestVersion.current += 1;
    setSchemeId(scheme?.id ?? null);
    setSchemeName(scheme?.name ?? "");
    setProfile(scheme?.profile ?? { ...DEFAULT_PROFILE, league: profile.league, originalLeague: profile.league });
    setCustomSounds(soundFiles);
    setGenerated(null);
    setBusy(false);
    setError("");
    setMarketError("");
    setSaveFeedback("");
    setSaveError(missing.size ? `请在规则中补齐自定义音效：${[...missing].join("、")}` : "");
    setDirty(false);
    setActiveTab("builder");
    setView("editor");
    setSchemeBusy(false);
  }

  async function saveScheme(asNew = false, install = false) {
    setSchemeBusy(true);
    setSaveFeedback("");
    setSaveError("");
    let saved = false;
    try {
      const uploads: Record<string, string> = {};
      let bytes = 0;
      for (const rule of profile.rules) {
        const sound = rule.effects.sound;
        const file = customSounds[rule.id];
        if (sound?.type !== "custom" || !file || Object.prototype.hasOwnProperty.call(uploads, sound.fileName)) continue;
        bytes += file.size;
        if (bytes > 32 * 1024 * 1024) throw new Error("音效合计最多 32 MB");
        uploads[sound.fileName] = await fileToBase64(file);
      }
      const name = schemeName.trim();
      const id = await local<string>("scheme_save", { edit: { id: asNew ? null : schemeId, name, profile, sounds: uploads } });
      saved = true;
      leagueChosen.current = true;
      setSchemeId(id);
      setSchemeName(name);
      setDirty(false);
      if (install) await local("scheme_install", { id });
      setSaveFeedback(install ? "过滤器已保存到游戏目录" : "方案已保存，可在订阅管理中查看");
    } catch (cause) {
      setSaveError(saved ? `方案已保存，安装失败：${explain(cause)}` : explain(cause));
    } finally {
      if (saved) setSchemeRevision((current) => current + 1);
      setSchemeBusy(false);
    }
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
    <AppShell
      title={view === "subscriptions" ? "订阅管理" : "制作过滤器"}
      navigation={(
        <nav aria-label="客户端功能" className="flex flex-wrap items-center gap-1">
          <Button size="sm" variant={view === "subscriptions" ? "primary" : "ghost"} aria-pressed={view === "subscriptions"} disabled={schemeBusy} onClick={() => setView("subscriptions")}>订阅管理</Button>
          <Button size="sm" variant={view === "editor" ? "primary" : "ghost"} aria-pressed={view === "editor"} disabled={schemeBusy} onClick={() => setView("editor")}>制作过滤器</Button>
        </nav>
      )}
    >
      <div hidden={view !== "subscriptions"}>
        <SchemeManager
          revision={schemeRevision}
          busy={schemeBusy}
          onBusy={setSchemeBusy}
          onNew={() => requestDraft(null)}
          onOpen={requestDraft}
          onRemove={(id) => {
            if (id !== schemeId) return;
            setSchemeId(null);
            setDirty(true);
            setSaveError("");
            setSaveFeedback("原方案已删除，当前草稿可以另行保存");
          }}
        />
      </div>
      <div hidden={view !== "editor"}>
        <fieldset className="flex min-w-0 flex-col gap-4" disabled={schemeBusy}>
          <Panel title={schemeId ? "编辑本地方案" : "新建本地方案"} action={<Button size="sm" onClick={() => requestDraft(null)}>新建方案</Button>}>
            <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); void saveScheme(); }}>
              <label className="max-w-full text-xs text-ink-muted">方案名称
                <TextInput className="mt-1 w-64 max-w-full" value={schemeName} maxLength={80} onChange={(event) => {
                  setSchemeName(event.target.value);
                  setDirty(true);
                }} />
              </label>
              <Button type="submit" size="sm" variant="primary" disabled={!schemeName.trim()}>保存方案</Button>
              {schemeId && <Button size="sm" disabled={!schemeName.trim()} onClick={() => void saveScheme(true)}>另存为</Button>}
              <Button size="sm" disabled={!schemeName.trim()} onClick={() => void saveScheme(false, true)}>保存并安装到游戏</Button>
            </form>
            {saveError ? <p role="alert" className="mt-3 text-sm text-ember">{saveError}</p>
              : saveFeedback && <p role="status" className="mt-3 text-sm text-ink">{saveFeedback}</p>}
          </Panel>
          <SeasonSection
            profile={profile}
            leagueCatalog={leagueCatalog}
            leaguesLoading={leaguesLoading}
            marketLoading={marketLoading}
            marketError={marketError}
            selectedMarket={market.league === profile.league ? market : selectedMarket}
            onLeagueChange={selectLeague}
            onRefresh={() => void refreshMarket()}
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
        </fieldset>
      </div>
      {pendingScheme !== undefined && <ConfirmDialog title="放弃未保存的修改？" onCancel={() => setPendingScheme(undefined)}>
        <p>{pendingScheme ? `打开「${pendingScheme.name}」会替换当前草稿。` : "新建方案会替换当前草稿。"}</p>
        <div className="modal-actions">
          <Button size="sm" onClick={() => setPendingScheme(undefined)}>保留草稿</Button>
          <Button size="sm" variant="danger" onClick={() => {
            setPendingScheme(undefined);
            void openDraft(pendingScheme);
          }}>放弃修改</Button>
        </div>
      </ConfirmDialog>}
    </AppShell>
  );
}
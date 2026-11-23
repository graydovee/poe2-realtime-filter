"use client";

import { listen } from "@tauri-apps/api/event";
import { explain, fileToBase64, isDesktop, local, readSound, type LocalScheme } from "../lib/desktop";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Eye, Gauge, Layers2, Save, Sparkles } from "lucide-react";

import { FALLBACK_SNAPSHOT } from "../lib/data";
import type { FilterProfile, FilterRule, GameServer, LeagueCatalog, MarketSnapshot } from "../lib/types";

import type { BaseInspection } from "../lib/baseline-effects";
import { DEFAULT_PROFILE } from "../lib/default-profile";

import { AppShell } from "./components/app-shell";
import { PreviewView, type Generated } from "./components/preview-view";
import { SchemeManager } from "./components/scheme-manager";
import { BasicFilterSection } from "./components/sections/basic-filter-section";
import { ExcludedItemsSection } from "./components/sections/excluded-items-section";
import { RulesSection } from "./components/sections/rules-section";
import { SeasonSection } from "./components/sections/season-section";
import { SummarySidebar } from "./components/sections/summary-sidebar";
import { EditorActionBar, EditorNavigation, type EditorStep } from "./components/editor-navigation";
import type { ItemPickerToggle } from "./components/item-picker";
import { ConfirmDialog } from "./components/ui/confirm-dialog";
import { TextInput } from "./components/ui/controls";
import { Button } from "./components/ui/primitives";

const safeSoundName = (value: string) => value.replace(/[^a-zA-Z0-9._-]/g, "_");

export default function HomePage() {
  const [market, setMarket] = useState<MarketSnapshot>(FALLBACK_SNAPSHOT);
  const [view, setView] = useState<"manager" | "editor">("manager");
  const [editorStep, setEditorStep] = useState("season");
  const [schemeId, setSchemeId] = useState<string | null>(null);
  const [schemeName, setSchemeName] = useState("");
  const [schemeBusy, setSchemeBusy] = useState(false);
  const [schemeRevision, setSchemeRevision] = useState(0);
  const [saveFeedback, setSaveFeedback] = useState("");
  const [saveError, setSaveError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [nameDialog, setNameDialog] = useState(false);
  const [newName, setNewName] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [profile, setProfile] = useState<FilterProfile>(DEFAULT_PROFILE);
  const [baseInspection, setBaseInspection] = useState<BaseInspection>();
  const [baseRevision, setBaseRevision] = useState(0);
  const inspectionRequest = useRef(0);
  const [baseStylesError, setBaseStylesError] = useState("");
  const [customSounds, setCustomSounds] = useState<Record<string, File>>({});
  const [generated, setGenerated] = useState<Generated | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [leagueCatalog, setLeagueCatalog] = useState<LeagueCatalog | null>(null);
  const leaguesLoading = false;
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketError, setMarketError] = useState("");
  const requestVersion = useRef(0);
  const baseFilterChanged = useRef(false);
  useEffect(() => { window.scrollTo(0, 0); }, [view]);
  useEffect(() => {
    const saved = window.localStorage.getItem("poe2-filter.editor-step");
    if (saved === "excluded") {
      setEditorStep("base");
      return;
    }
    if (saved && ["season", "base", "rules"].includes(saved)) setEditorStep(saved);
  }, []);
  useEffect(() => {
    window.localStorage.setItem("poe2-filter.editor-step", editorStep);
  }, [editorStep]);

  const base = profile.baseFilter;
  useEffect(() => {
    setBaseInspection(undefined);
    setBaseStylesError("");
    if (view !== "editor" || !base) return;
    const request = ++inspectionRequest.current;
    void local<BaseInspection>("base_styles", { base })
      .then((inspection) => { if (request === inspectionRequest.current) setBaseInspection(inspection); })
      .catch((error) => { if (request === inspectionRequest.current) setBaseStylesError(explain(error)); });
    return () => { inspectionRequest.current += 1; };
  }, [view, base, baseRevision]);

  const server = profile.server ?? "international";
  const matchingMarket = (market.server ?? "international") === server && market.league === profile.league;
  const selectedMarket: MarketSnapshot = matchingMarket && Date.parse(market.expiresAt) >= Date.now() ? market : { ...FALLBACK_SNAPSHOT, league: profile.league };

  useEffect(() => {
    if (!isDesktop()) return;
    let active = true;
    const load = async () => {
      const catalog = await local<LeagueCatalog>("local_catalog", { server });
      if (!active) return;
      setLeagueCatalog(catalog);
    };
    void load().catch(() => {});
    const listener = listen("local-refresh", () => { void load().catch(() => {}); });
    return () => { active = false; void listener.then((unlisten) => unlisten()).catch(() => {}); };
  }, [server]);

  useEffect(() => {
    if (!isDesktop()) return;
    let active = true;
    const league = profile.league;
    const load = async () => {
      const cached = await local<MarketSnapshot | null>("local_market", { league, server });
      if (active) setMarket(cached ?? { ...FALLBACK_SNAPSHOT, league });
    };
    void load().catch(() => {});
    const listener = listen("local-refresh", () => { void load().catch(() => {}); });
    return () => { active = false; void listener.then((unlisten) => unlisten()).catch(() => {}); };
  }, [profile.league, server]);

  async function refreshMarket() {
    setMarketLoading(true);
    setMarketError("");
    try { await local("refresh_market", { server, league: profile.league || null }); }
    catch (error) { setMarketError(explain(error)); }
    finally { setMarketLoading(false); }
  }

  function selectLeague(league: string) {
    setDirty(true);
    requestVersion.current += 1;
    setProfile((current) => ({ ...current, league, originalLeague: league }));
    setMarket({ ...FALLBACK_SNAPSHOT, league });
    setMarketLoading(false);
    setGenerated(null);
    setBusy(false);
    setError("");
    setMarketError("");
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
    const id = `rule-${globalThis.crypto.randomUUID()}`;
    setDirty(true);
    setProfile((current) => ({
      ...current,
      rules: [...current.rules, {
        id,
        name: "新规则 " + (current.rules.length + 1),
        enabled: true,
        hidden: false,
        target: { itemIds: [], itemEnabled: true, priceEnabled: false },
        effects: {},
      }],
    }));
    return id;
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
    if (!file) {
      setCustomSounds((current) => {
        if (!(id in current)) return current;
        const next = { ...current };
        delete next[id];
        return next;
      });
      return;
    }
    setCustomSounds((current) => ({ ...current, [id]: file }));
    updateRule(id, { followBaseline: profile.rules.find((rule) => rule.id === id)?.followBaseline === undefined ? undefined : false, effects: { ...(profile.rules.find((rule) => rule.id === id)?.effects ?? {}), sound: { type: "custom", fileName: safeSoundName(file.name) } } });
  }

  async function openDraft(scheme: LocalScheme | null, target: GameServer) {
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
          file = readSound(sound.fileName, scheme.id);
          reads.set(sound.fileName, file);
        }
        try { soundFiles[rule.id] = await file; }
        catch { missing.add(sound.fileName); }
      }));
    }
    requestVersion.current += 1;
    baseFilterChanged.current = false;
    setBaseInspection(undefined);
    setBaseStylesError("");
    setSchemeId(scheme?.id ?? null);
    setSchemeName(scheme?.name ?? "");
    const catalog = await local<LeagueCatalog>("local_catalog", { server: target }).catch(() => null);
    setLeagueCatalog(catalog);
    const league = catalog?.defaultLeague ?? (target === "international" ? DEFAULT_PROFILE.league : "");
    setProfile(scheme ? { ...scheme.profile, server: target } : {
      ...structuredClone(DEFAULT_PROFILE), server: target, league, originalLeague: league,
    });
    setCustomSounds(soundFiles);
    setGenerated(null);
    setBusy(false);
    setError("");
    setMarketError("");
    setSaveError(missing.size ? `请在规则中补齐自定义音效：${[...missing].join("、")}` : "");
    setDirty(false);
    setView("editor");
    setEditorStep("season");
    setSchemeBusy(false);
  }

  async function saveScheme(name: string) {
    setSchemeBusy(true);
    setSaveError("");
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
      await local<string>("scheme_save", { edit: { id: schemeId, name: name.trim(), profile, sounds: uploads, baseFilterChanged: baseFilterChanged.current } });
      setNameDialog(false);
      setSaveFeedback(`「${name.trim()}」已保存`);
      setSchemeRevision((current) => current + 1);
      leaveEditor();
    } catch (cause) {
      setSaveError(explain(cause));
    } finally {
      setSchemeBusy(false);
    }
  }

  function closePreview() {
    requestVersion.current += 1;
    setBusy(false);
    setPreviewOpen(false);
  }

  function leaveEditor() {
    closePreview();
    setDirty(false);
    setConfirmCancel(false);
    setView("manager");
  }

  function requestSave() {
    setSaveError("");
    if (schemeId) {
      void saveScheme(schemeName);
    } else {
      setNewName("");
      setNameDialog(true);
    }
  }

  async function generate() {
    const version = requestVersion.current;
    const league = profile.league;
    setPreviewOpen(true);
    setGenerated(null);
    setBusy(true);
    setError("");
    try {
      const payload = await local<Generated>("preview", { profile });
      if (version !== requestVersion.current) return;
      if (payload.market?.league !== league) throw new Error("生成结果与所选赛季不一致");
      setGenerated(payload);
    } catch (cause) {
      if (version === requestVersion.current) setError(explain(cause));
    } finally {
      if (version === requestVersion.current) setBusy(false);
    }
  }

  const editorSteps: EditorStep[] = [
    { id: "season", label: "赛季与行情", description: "选择赛季并刷新报价", icon: Gauge, status: marketError ? "warning" : profile.league ? "ready" : "active" },
    { id: "base", label: "基础过滤器", description: "选择样式并整理跳过名单", icon: Layers2, status: baseStylesError || profile.baseFilterHint ? "warning" : base ? "ready" : "active", meta: base ? `${profile.skippedItemIds.length} 项跳过` : "" },
    { id: "rules", label: "自定义规则", description: "按优先级编辑掉落规则", icon: Sparkles, status: profile.rules.length ? "ready" : "warning", meta: `${profile.rules.length} 条` },
  ];
  const editorStepIndex = editorSteps.findIndex((step) => step.id === editorStep);
  const previousStep = editorSteps[Math.max(0, editorStepIndex - 1)]?.id;
  const nextStep = editorSteps[Math.min(editorSteps.length - 1, editorStepIndex + 1)]?.id;

  function goToEditorStep(id: string) {
    setEditorStep(id);
    window.requestAnimationFrame(() => {
      document.getElementById(`editor-step-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  return (
    <AppShell title={view === "manager" ? "方案管理" : schemeId ? `编辑过滤器：${schemeName}` : "制作过滤器"}>
      <div hidden={view !== "manager"}>
        <SchemeManager
          revision={schemeRevision}
          saveNotice={saveFeedback}
          busy={schemeBusy}
          onBusy={setSchemeBusy}
          onNew={(server) => void openDraft(null, server)}
          onOpen={(scheme, server) => void openDraft(scheme, server)}
        />
      </div>
      {view === "editor" && (
        <fieldset className="min-w-0" disabled={schemeBusy}>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface/80 px-4 py-3 shadow-panel">
            <div className="flex min-w-0 items-center gap-3">
              <button type="button" onClick={() => dirty ? setConfirmCancel(true) : leaveEditor()} className="grid size-9 shrink-0 place-items-center rounded-lg border border-line bg-surface-2 text-ink-muted transition hover:border-gold/60 hover:text-gold" aria-label="返回方案管理" title="返回方案管理">
                <ArrowLeft className="size-4" aria-hidden="true" />
              </button>
              <div className="min-w-0">
                <p className="truncate text-xs text-ink-muted">正在编辑</p>
                <h2 className="truncate text-sm font-semibold text-ink">{schemeName || "未命名方案"}</h2>
              </div>
              <span className={dirty ? "rounded-full border border-gold/35 bg-gold/10 px-2 py-0.5 text-[11px] text-gold" : "rounded-full border border-sage/35 bg-sage/10 px-2 py-0.5 text-[11px] text-sage"}>
                {dirty ? "有未保存修改" : "已保存"}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-muted">
              <span className="rounded-full border border-line px-2 py-1">{profile.league || "待选赛季"}</span>
              <span className="rounded-full border border-line px-2 py-1">{profile.rules.length} 条规则</span>
            </div>
          </div>

          <div className="min-w-0 space-y-5">
            <EditorNavigation steps={editorSteps} active={editorStep} onChange={goToEditorStep} />

            <div className="editor-workflow">
              <section id="editor-step-season" className="editor-section">
                <SeasonSection
                  profile={profile}
                  leagueCatalog={leagueCatalog}
                  leaguesLoading={leaguesLoading}
                  marketLoading={marketLoading}
                  marketError={marketError}
                  selectedMarket={matchingMarket ? market : selectedMarket}
                  onLeagueChange={selectLeague}
                  onRefresh={() => void refreshMarket()}
                />
              </section>

              <section id="editor-step-base" className="editor-section base-filter-workspace">
                <BasicFilterSection
                  profile={profile}
                  onBaseChange={(baseFilter) => {
                    baseFilterChanged.current = true;
                    inspectionRequest.current += 1;
                    setBaseInspection(undefined);
                    setBaseStylesError("");
                    setBaseRevision((revision) => revision + 1);
                    setDirty(true);
                    setProfile((current) => ({ ...current, baseFilter, baseFilterHint: undefined }));
                  }}
                />
                {baseStylesError && <p role="alert" className="mt-3 rounded-lg border border-ember/35 bg-ember/8 px-4 py-3 text-sm text-ember">{baseStylesError}</p>}
                {base && (
                  <div className="base-filter-dependent">
                    <div className="base-filter-dependent-heading">
                      <div>
                        <p className="eyebrow">OPTIONAL CLEANUP</p>
                        <h3>跳过物品</h3>
                      </div>
                      <span>{profile.skippedItemIds.length} 项已跳过</span>
                    </div>
                    <ExcludedItemsSection profile={profile} onToggleItems={toggleSkipped} onClear={clearSkipped} />
                  </div>
                )}
              </section>

              <section id="editor-step-rules" className="editor-section">
                <RulesSection
                  profile={profile}
                  market={selectedMarket}
                  customSounds={customSounds}
                  baseInspection={baseInspection}
                  onRuleChange={updateRule}
                  onRemoveRule={removeRule}
                  onAddRule={addRule}
                  onMoveRule={moveRule}
                  onSound={setRuleSound}
                />
              </section>

              <details className="summary-disclosure">
                <summary>查看配置摘要</summary>
                <div className="mt-4"><SummarySidebar profile={profile} saving={schemeBusy} previewing={busy} error={nameDialog ? "" : saveError} onSave={requestSave} onPreview={() => void generate()} onCancel={() => dirty ? setConfirmCancel(true) : leaveEditor()} showActions={false} /></div>
              </details>
            </div>
          </div>

          <EditorActionBar>
            <div className="flex min-w-0 items-center gap-2">
              <button type="button" className="grid size-9 place-items-center rounded-lg border border-line bg-surface-2 text-ink-muted transition hover:border-gold/60 hover:text-gold disabled:opacity-40" aria-label="上一步" title="上一步" disabled={editorStepIndex <= 0} onClick={() => goToEditorStep(previousStep)}><ArrowLeft className="size-4" aria-hidden="true" /></button>
              <span className="hidden text-xs text-ink-muted sm:inline">{editorSteps[editorStepIndex]?.label}</span>
              <button type="button" className="grid size-9 place-items-center rounded-lg border border-line bg-surface-2 text-ink-muted transition hover:border-gold/60 hover:text-gold disabled:opacity-40" aria-label="下一步" title="下一步" disabled={editorStepIndex >= editorSteps.length - 1} onClick={() => goToEditorStep(nextStep)}><ArrowRight className="size-4" aria-hidden="true" /></button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => void generate()} disabled={schemeBusy || busy}><Eye className="size-4" aria-hidden="true" />预览</Button>
              <Button variant="ghost" size="sm" onClick={() => dirty ? setConfirmCancel(true) : leaveEditor()} disabled={schemeBusy}>取消</Button>
              <Button variant="primary" size="sm" onClick={requestSave} disabled={schemeBusy}><Save className="size-4" aria-hidden="true" />{schemeBusy ? "保存中…" : "保存方案"}</Button>
            </div>
          </EditorActionBar>
        </fieldset>
      )}
      {previewOpen && (
        <ConfirmDialog title="预览过滤器" className="modal-wide" onCancel={closePreview}>
          {busy && <p role="status">正在生成预览…</p>}
          {error && <div role="alert" className="my-3 text-sm text-ember">{error}</div>}
          {generated && <PreviewView generated={generated} />}
          <div className="modal-actions"><Button onClick={closePreview}>关闭预览</Button></div>
        </ConfirmDialog>
      )}
      {nameDialog && (
        <ConfirmDialog title="保存新方案" busy={schemeBusy} onCancel={() => { setNameDialog(false); setSaveError(""); }}>
          <form onSubmit={(event) => {
            event.preventDefault();
            if (newName.trim() && !schemeBusy) void saveScheme(newName);
          }}>
            <label className="text-sm text-ink">方案名称
              <TextInput className="mt-1" required value={newName} maxLength={80} disabled={schemeBusy} onChange={(event) => setNewName(event.target.value)} />
            </label>
            {saveError && <div role="alert" className="mt-2 text-sm text-ember">{saveError}</div>}
            <div className="modal-actions">
              <Button size="sm" disabled={schemeBusy} onClick={() => { setNameDialog(false); setSaveError(""); }}>取消</Button>
              <Button type="submit" size="sm" variant="primary" disabled={schemeBusy || !newName.trim()}>{schemeBusy ? "保存中…" : "保存方案"}</Button>
            </div>
          </form>
        </ConfirmDialog>
      )}
      {confirmCancel && (
        <ConfirmDialog title="放弃未保存的修改？" onCancel={() => setConfirmCancel(false)}>
          <p>返回方案管理后，本次未保存的修改将丢失。</p>
          <div className="modal-actions">
            <Button size="sm" onClick={() => setConfirmCancel(false)}>继续编辑</Button>
            <Button size="sm" variant="danger" onClick={leaveEditor}>放弃修改</Button>
          </div>
        </ConfirmDialog>
      )}
    </AppShell>
  );

}

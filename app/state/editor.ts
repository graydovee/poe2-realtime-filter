import type { StateCreator } from "zustand";
import { toast } from "sonner";

import type { BaseInspection } from "../../lib/baseline-effects";
import { explain, fileToBase64, local, readSound, type LocalScheme } from "../../lib/desktop";
import { DEFAULT_PROFILE } from "../../lib/default-profile";
import { FALLBACK_SNAPSHOT, legacyEffectItemId } from "../../lib/data";
import { normalizeProfile } from "../../lib/profile";
import { newRuleId } from "../../lib/rule-id";
import type { BaseFilter, FilterProfile, FilterRule, GameServer, LeagueCatalog, MarketSnapshot, RuleEffects } from "../../lib/types";
import { counters } from "./counters";
import type { AppState } from "./store";
import type { EditorDialog, Generated, ItemPickerToggle, PickerTarget } from "./types";

type RemovedRule = { rule: FilterRule; index: number; sound?: File };
type RuleAppearance = { itemId: string } | { effects: RuleEffects; presetId?: string; file?: File };

const safeSoundName = (value: string) => value.replace(/[^a-zA-Z0-9._-]/g, "_");

export function shownRuleEffects(rule: FilterRule, inspection?: BaseInspection): RuleEffects {
  const itemId = rule.baselineEffectItemId;
  return itemId ? inspection?.styles[itemId]?.effects ?? {} : rule.effects;
}

export function ruleEffectsPending(rule: FilterRule, state: Pick<EditorState, "profile" | "baseInspection" | "baseStylesError">) {
  return Boolean(rule.baselineEffectItemId && state.profile.baseFilter && !state.baseInspection && !state.baseStylesError);
}

/** 打开已保存的方案时把旧写法（锚点价格点）读成当前格式；读不了就原样交给后续校验报错。 */
function readableProfile(profile: FilterProfile): FilterProfile {
  try {
    return normalizeProfile(profile);
  } catch {
    return profile;
  }
}

export type EditorState = {
  schemeId: string | null;
  schemeName: string;
  profile: FilterProfile;
  dirty: boolean;
  /** 保存或读取方案期间为真，此时整个编辑器不可操作。 */
  schemeBusy: boolean;
  /** 尚未保存的自定义音效文件，按规则 id 索引。 */
  customSounds: Record<string, File>;
  activeRuleId: string | undefined;
  baseInspection: BaseInspection | undefined;
  baseStylesError: string;
  /** 每次更换基础过滤器递增，用来触发重新读取基础样式。 */
  baseRevision: number;
  baseFilterOpen: boolean;
  market: MarketSnapshot;
  marketLoading: boolean;
  marketError: string;
  leagueCatalog: LeagueCatalog | null;
  generated: Generated | null;
  previewOpen: boolean;
  previewBusy: boolean;
  previewError: string;
  saveError: string;
  editorDialog: EditorDialog | null;
  newName: string;
  picker: PickerTarget | null;
  presetGalleryOpen: boolean;
  /** 最近删除的规则，供「撤销」恢复。 */
  lastRemoved: RemovedRule | null;
};

export type EditorActions = {
  selectLeague: (league: string) => void;
  update: <K extends keyof FilterProfile>(key: K, value: FilterProfile[K]) => void;
  updateRule: (id: string, patch: Partial<FilterRule>) => void;
  addRule: () => string;
  removeRule: (id: string) => void;
  undoRemoveRule: () => void;
  moveRule: (id: string, delta: number) => void;
  /** 把当前规则的选择向前（负数）或向后（正数）移动一位。 */
  selectRule: (delta: number) => void;
  setActiveRuleId: (id: string | undefined) => void;
  toggleSkipped: (toggle: ItemPickerToggle) => void;
  clearSkipped: () => void;
  setRuleAppearance: (id: string, appearance: RuleAppearance) => void;
  setRuleSound: (id: string, file: File | undefined) => void;
  setBaseFilter: (base?: BaseFilter) => void;
  setBaseFilterOpen: (open: boolean) => void;
  loadBaseInspection: () => Promise<void>;
  loadCatalog: (server: GameServer) => Promise<void>;
  loadMarket: (server: GameServer, league: string) => Promise<void>;
  refreshMarket: () => Promise<void>;
  openDraft: (scheme: LocalScheme | null, server: GameServer) => Promise<void>;
  saveScheme: (name: string) => Promise<void>;
  requestSave: () => void;
  generate: () => Promise<void>;
  closePreview: () => void;
  leaveEditor: () => void;
  setEditorDialog: (dialog: EditorDialog | null) => void;
  setSaveError: (error: string) => void;
  setNewName: (name: string) => void;
  openPicker: (target: PickerTarget) => void;
  closePicker: () => void;
  setPresetGalleryOpen: (open: boolean) => void;
};

export type EditorSlice = EditorState & EditorActions;

export const createEditorSlice: StateCreator<AppState, [], [], EditorSlice> = (set, get) => ({
  schemeId: null,
  schemeName: "",
  profile: DEFAULT_PROFILE,
  dirty: false,
  schemeBusy: false,
  customSounds: {},
  activeRuleId: undefined,
  baseInspection: undefined,
  baseStylesError: "",
  baseRevision: 0,
  baseFilterOpen: false,
  market: FALLBACK_SNAPSHOT,
  marketLoading: false,
  marketError: "",
  leagueCatalog: null,
  generated: null,
  previewOpen: false,
  previewBusy: false,
  previewError: "",
  saveError: "",
  editorDialog: null,
  newName: "",
  picker: null,
  presetGalleryOpen: false,
  lastRemoved: null,

  selectLeague: (league) => {
    counters.request += 1;
    set((state) => ({
      dirty: true,
      profile: { ...state.profile, league, originalLeague: league },
      market: { ...FALLBACK_SNAPSHOT, league },
      marketLoading: false,
      marketError: "",
      generated: null,
      previewBusy: false,
      previewError: "",
    }));
  },

  update: (key, value) =>
    set((state) => ({ dirty: true, profile: { ...state.profile, [key]: value } })),

  updateRule: (id, patch) =>
    set((state) => ({
      dirty: true,
      profile: {
        ...state.profile,
        rules: state.profile.rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)),
      },
    })),

  addRule: () => {
    const { profile, lastRemoved } = get();
    // 避开已有规则和「撤销删除」暂存的那一条，免得撤销之后出现重复 id。
    const id = newRuleId([...profile.rules.map((rule) => rule.id), ...(lastRemoved ? [lastRemoved.rule.id] : [])]);
    set((state) => ({
      dirty: true,
      activeRuleId: id,
      profile: {
        ...state.profile,
        rules: [
          ...state.profile.rules,
          {
            id,
            name: "新规则 " + (state.profile.rules.length + 1),
            enabled: true,
            hidden: false,
            target: { itemIds: [], itemEnabled: true, priceEnabled: false },
            effects: {},
          },
        ],
      },
    }));
    return id;
  },

  removeRule: (id) =>
    set((state) => {
      const index = state.profile.rules.findIndex((rule) => rule.id === id);
      if (index < 0) return state;
      const rules = state.profile.rules.filter((rule) => rule.id !== id);
      const customSounds = { ...state.customSounds };
      const sound = customSounds[id];
      delete customSounds[id];
      return {
        dirty: true,
        profile: { ...state.profile, rules },
        customSounds,
        activeRuleId: state.activeRuleId === id ? rules[index]?.id ?? rules[index - 1]?.id : state.activeRuleId,
        lastRemoved: { rule: state.profile.rules[index], index, sound },
      };
    }),

  undoRemoveRule: () =>
    set((state) => {
      const removed = state.lastRemoved;
      if (!removed) return state;
      const rules = [...state.profile.rules];
      rules.splice(Math.min(removed.index, rules.length), 0, removed.rule);
      return {
        dirty: true,
        profile: { ...state.profile, rules },
        customSounds: removed.sound ? { ...state.customSounds, [removed.rule.id]: removed.sound } : state.customSounds,
        activeRuleId: removed.rule.id,
        lastRemoved: null,
      };
    }),

  moveRule: (id, delta) =>
    set((state) => {
      const index = state.profile.rules.findIndex((rule) => rule.id === id);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= state.profile.rules.length) return state;
      const rules = [...state.profile.rules];
      const [rule] = rules.splice(index, 1);
      rules.splice(target, 0, rule);
      return { dirty: true, profile: { ...state.profile, rules } };
    }),

  selectRule: (delta) =>
    set((state) => {
      const index = state.profile.rules.findIndex((rule) => rule.id === state.activeRuleId);
      const next = state.profile.rules[index + delta];
      return next ? { activeRuleId: next.id } : state;
    }),

  setActiveRuleId: (activeRuleId) => set({ activeRuleId }),

  toggleSkipped: ({ ids, checked }) =>
    set((state) => {
      const next = new Set(state.profile.skippedItemIds);
      for (const id of ids) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return { dirty: true, profile: { ...state.profile, skippedItemIds: [...next] } };
    }),

  clearSkipped: () => get().update("skippedItemIds", []),

  setRuleAppearance: (id, appearance) =>
    set((state) => {
      const index = state.profile.rules.findIndex((rule) => rule.id === id);
      if (index < 0) return state;
      const rule = state.profile.rules[index];
      const fixed = "effects" in appearance ? appearance : undefined;
      const itemId = "itemId" in appearance ? appearance.itemId : undefined;
      if (itemId && itemId === rule.baselineEffectItemId) return state;
      const customSounds = { ...state.customSounds };
      if (fixed?.file && fixed.effects.sound?.type === "custom") customSounds[id] = fixed.file;
      else delete customSounds[id];
      const rules = [...state.profile.rules];
      rules[index] = {
        ...rule,
        baselineEffectItemId: itemId,
        // 旧版默认价格档的 ID 仍可用于兼容读取，显式固定后不能再据此迁移。
        followBaseline: fixed && legacyEffectItemId(id) ? false : undefined,
        effectPresetId: fixed?.presetId,
        effects: fixed?.effects ?? {},
      };
      return { dirty: true, customSounds, profile: { ...state.profile, rules } };
    }),

  setRuleSound: (id, file) => {
    const state = get();
    const rule = state.profile.rules.find((entry) => entry.id === id);
    if (!file || !rule || ruleEffectsPending(rule, state)) return;
    const effects = shownRuleEffects(rule, state.baseInspection);
    state.setRuleAppearance(id, { effects: { ...effects, sound: { type: "custom", fileName: safeSoundName(file.name) } }, file });
  },

  setBaseFilter: (base) => {
    counters.baseFilterChanged = true;
    counters.inspection += 1;
    set((state) => ({
      dirty: true,
      baseInspection: undefined,
      baseStylesError: "",
      baseRevision: state.baseRevision + 1,
      profile: { ...state.profile, baseFilter: base, baseFilterHint: undefined },
    }));
  },

  setBaseFilterOpen: (baseFilterOpen) => set({ baseFilterOpen }),

  loadBaseInspection: async () => {
    const { view, profile: { baseFilter: base } } = get();
    const request = ++counters.inspection;
    set({ baseInspection: undefined, baseStylesError: "" });
    if (view !== "editor" || !base) return;
    try {
      const inspection = await local<BaseInspection>("base_styles", { base });
      if (request === counters.inspection) set({ baseInspection: inspection });
    } catch (cause) {
      if (request === counters.inspection) set({ baseStylesError: explain(cause) || "无法读取基础过滤器特效。" });
    }
  },

  loadCatalog: async (server) => {
    const request = ++counters.catalog;
    try {
      const catalog = await local<LeagueCatalog>("local_catalog", { server });
      if (request === counters.catalog) set({ leagueCatalog: catalog });
    } catch {
      // 读取失败时保留现有赛季列表。
    }
  },

  loadMarket: async (server, league) => {
    const request = ++counters.market;
    try {
      const cached = await local<MarketSnapshot | null>("local_market", { league, server });
      if (request === counters.market) set({ market: cached ?? { ...FALLBACK_SNAPSHOT, league } });
    } catch {
      // 没有缓存行情时沿用当前数据。
    }
  },

  refreshMarket: async () => {
    const { profile } = get();
    const server = profile.server ?? "international";
    set({ marketLoading: true, marketError: "" });
    try {
      await local("refresh_market", { server, league: profile.league || null });
    } catch (cause) {
      set({ marketError: explain(cause) });
    } finally {
      set({ marketLoading: false });
    }
  },

  openDraft: async (scheme, target) => {
    set({ schemeBusy: true });
    const draft = scheme ? readableProfile(scheme.profile) : undefined;
    const soundFiles: Record<string, File> = {};
    const missing = new Set<string>();
    if (scheme && draft) {
      const reads = new Map<string, Promise<File>>();
      await Promise.all(
        draft.rules.map(async (rule) => {
          const sound = rule.baselineEffectItemId ? undefined : rule.effects.sound;
          if (sound?.type !== "custom") return;
          let file = reads.get(sound.fileName);
          if (!file) {
            file = readSound(sound.fileName, scheme.id);
            reads.set(sound.fileName, file);
          }
          try {
            soundFiles[rule.id] = await file;
          } catch {
            missing.add(sound.fileName);
          }
        }),
      );
    }
    counters.request += 1;
    counters.inspection += 1;
    counters.baseFilterChanged = false;
    const catalog = await local<LeagueCatalog>("local_catalog", { server: target }).catch(() => null);
    const league = catalog?.defaultLeague ?? (target === "international" ? DEFAULT_PROFILE.league : "");
    set({
      baseInspection: undefined,
      baseStylesError: "",
      schemeId: scheme?.id ?? null,
      schemeName: scheme?.name ?? "",
      leagueCatalog: catalog,
      profile: draft
        ? { ...draft, server: target }
        : { ...structuredClone(DEFAULT_PROFILE), server: target, league, originalLeague: league },
      customSounds: soundFiles,
      activeRuleId: undefined,
      lastRemoved: null,
      baseFilterOpen: false,
      generated: null,
      previewOpen: false,
      previewBusy: false,
      previewError: "",
      marketLoading: false,
      marketError: "",
      editorDialog: null,
      picker: null,
      presetGalleryOpen: false,
      saveError: missing.size ? `请在规则中补齐自定义音效：${[...missing].join("、")}` : "",
      dirty: false,
      view: "editor",
      schemeBusy: false,
    });
  },

  saveScheme: async (name) => {
    const { profile, customSounds, schemeId } = get();
    set({ schemeBusy: true, saveError: "" });
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
      await local<string>("scheme_save", {
        edit: { id: schemeId, name: name.trim(), profile, sounds: uploads, baseFilterChanged: counters.baseFilterChanged },
      });
      toast.success(`「${name.trim()}」已保存`);
      get().leaveEditor();
    } catch (cause) {
      set({ saveError: explain(cause) });
    } finally {
      set({ schemeBusy: false });
    }
  },

  requestSave: () => {
    const { schemeId, schemeName } = get();
    set({ saveError: "" });
    if (get().schemeBusy) return;
    if (schemeId) void get().saveScheme(schemeName);
    else set({ newName: "", editorDialog: "saveName" });
  },

  generate: async () => {
    const version = counters.request;
    const league = get().profile.league;
    set({ previewOpen: true, generated: null, previewBusy: true, previewError: "" });
    try {
      const payload = await local<Generated>("preview", { profile: get().profile });
      if (version !== counters.request) return;
      if (payload.market?.league !== league) throw new Error("生成结果与所选赛季不一致");
      set({ generated: payload });
    } catch (cause) {
      if (version === counters.request) set({ previewError: explain(cause) });
    } finally {
      if (version === counters.request) set({ previewBusy: false });
    }
  },

  closePreview: () => {
    counters.request += 1;
    set({ previewOpen: false, previewBusy: false });
  },

  leaveEditor: () => {
    counters.request += 1;
    set({
      previewOpen: false,
      previewBusy: false,
      dirty: false,
      editorDialog: null,
      picker: null,
      presetGalleryOpen: false,
      view: "manager",
    });
  },

  setEditorDialog: (editorDialog) => set({ editorDialog }),
  setSaveError: (saveError) => set({ saveError }),
  setNewName: (newName) => set({ newName }),
  openPicker: (target) => set({ picker: target }),
  closePicker: () => set({ picker: null }),
  setPresetGalleryOpen: (presetGalleryOpen) => set({ presetGalleryOpen }),
});

import type { StateCreator } from "zustand";
import { toast } from "sonner";

import type { BaseInspection } from "../../lib/baseline-effects";
import { blockKey, type BaseRules } from "../../lib/base-overlays";
import { explain, fileToBase64, local, readSound, type LocalScheme, type SavedScheme } from "../../lib/desktop";
import { DEFAULT_PROFILE } from "../../lib/default-profile";
import { FALLBACK_SNAPSHOT, legacyEffectItemId } from "../../lib/data";
import { normalizeProfile } from "../../lib/profile";
import { newRuleId } from "../../lib/rule-id";
import { customSoundFileName, customSoundOptions } from "../../lib/sound-library";
import type { BaseFilter, BaseOverlay, FilterProfile, FilterRule, GameServer, LeagueCatalog, MarketSnapshot, PresetSound, RuleEffects } from "../../lib/types";
import { counters } from "./counters";
import type { AppState } from "./store";
import type { BaseSelection, EditorDialog, Generated, ItemPickerToggle, PickerTarget } from "./types";

type RemovedRule = { rule: FilterRule; index: number; sound?: File };
type RemovedOverlay = { overlay: BaseOverlay; index: number; sound?: File };
/** 还原基础规则时去掉的修改，连同它们的自定义音效，供「撤销」恢复。 */
type RestoredOverlays = { overlays: BaseOverlay[]; sounds: Record<string, File> };
type RuleAppearance = { itemId: string } | { effects: RuleEffects; presetId?: string; file?: File };
/** 改一条基础规则时能改的部分。 */
export type OverlayPatch = Partial<Pick<BaseOverlay, "hidden" | "conditionLines" | "effects">>;

/** 方案里的规则和修改共用一个 ID 空间。 */
const takenIds = (profile: FilterProfile) => [...profile.rules.map((rule) => rule.id), ...profile.overlays.map((overlay) => overlay.id)];
/** 特效里写了东西；空对象不算。 */
const hasEffects = (effects: RuleEffects) => effects.beam !== undefined || effects.icon !== undefined || effects.sound !== undefined
  || Object.keys(effects.font ?? {}).length > 0;

export function shownRuleEffects(rule: FilterRule, inspection?: BaseInspection): RuleEffects {
  const itemId = rule.baselineEffectItemId;
  return itemId ? inspection?.styles[itemId]?.effects ?? {} : rule.effects;
}

export function ruleEffectsPending(rule: FilterRule, state: Pick<EditorState, "profile" | "baseInspection" | "baseStylesError">) {
  return Boolean(rule.baselineEffectItemId && state.profile.baseFilter && !state.baseInspection && !state.baseStylesError);
}

/** 打开已保存的方案时先规范化；读不了就原样交给后续校验报错。 */
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
  /** 已保存的描述；新建的方案在「保存新方案」里填写。 */
  schemeDescription: string;
  profile: FilterProfile;
  dirty: boolean;
  /** 保存或读取方案期间为真，此时整个编辑器不可操作。 */
  schemeBusy: boolean;
  /** 尚未保存的自定义音效文件，按规则和修改的 id 索引。 */
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
  picker: PickerTarget | null;
  presetGalleryOpen: boolean;
  /** 最近删除的规则，供「撤销」恢复。 */
  lastRemoved: RemovedRule | null;
  /** 选中的基础规则或失效的修改；选中自定义规则时为空。 */
  activeBase: BaseSelection | null;
  /** 基础过滤器里的规则表。打开开关或方案有修改时读取。 */
  baseRules: BaseRules | undefined;
  baseRulesError: string;
  /** 复制的基础规则修改。离开编辑器后仍保留，可以粘贴到别的方案。 */
  overlayClipboard: Array<{ overlay: BaseOverlay; file?: File }> | null;
  /** 最近删除的修改，供「撤销」恢复。 */
  lastRemovedOverlay: RemovedOverlay | null;
  /** 最近一次还原基础规则时去掉的修改，供「撤销」恢复。 */
  lastRestoredBaseRules: RestoredOverlays | null;
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
  setActiveBase: (selection: BaseSelection | null) => void;
  /** 把基础规则的选中向前（负数）或向后（正数）移动一条。 */
  selectBaseRule: (delta: number) => void;
  loadBaseRules: () => Promise<void>;
  /** 改一条基础规则：按它原有的条件找到或建立修改；所有改动都清掉时删除修改。 */
  editBaseRule: (index: number, patch: OverlayPatch) => void;
  updateOverlay: (id: string, patch: Partial<BaseOverlay>) => void;
  removeOverlay: (id: string) => void;
  undoRemoveOverlay: () => void;
  setOverlaySound: (id: string, file: File) => void;
  pickOverlaySound: (id: string, option: { fileName: string; file: File }) => void;
  copyOverlays: () => void;
  /** 同一条基础规则的修改覆盖本方案原有的，其余追加。返回粘贴的数量和其中在当前基础过滤器上不生效的数量。 */
  pasteOverlays: () => { pasted: number; invalid: number } | null;
  /** 基础规则修改的总开关：关闭时全部修改不生效，编辑器里基础规则只读。 */
  setEditsEnabled: (enabled: boolean) => void;
  /** 还原基础规则：去掉方案里对基础规则的全部修改，记下来供「撤销」恢复。返回去掉的数量。 */
  restoreBaseRules: () => number;
  undoRestoreBaseRules: () => void;
  toggleSkipped: (toggle: ItemPickerToggle) => void;
  clearSkipped: () => void;
  setRuleAppearance: (id: string, appearance: RuleAppearance) => void;
  setRuleSound: (id: string, file: File | undefined) => void;
  pickRuleSound: (id: string, option: { fileName: string; file: File }) => void;
  setBaseFilter: (base?: BaseFilter) => void;
  setBaseFilterOpen: (open: boolean) => void;
  loadBaseInspection: () => Promise<void>;
  loadCatalog: (server: GameServer) => Promise<void>;
  loadMarket: (server: GameServer, league: string) => Promise<void>;
  refreshMarket: () => Promise<void>;
  openDraft: (scheme: LocalScheme | null, server: GameServer) => Promise<void>;
  /** 保存方案。名称和描述随方案一起保存；失败时抛出错误信息。 */
  saveScheme: (name: string, description: string) => Promise<void>;
  requestSave: () => void;
  generate: () => Promise<void>;
  closePreview: () => void;
  leaveEditor: () => void;
  setEditorDialog: (dialog: EditorDialog | null) => void;
  setSaveError: (error: string) => void;
  openPicker: (target: PickerTarget) => void;
  closePicker: () => void;
  setPresetGalleryOpen: (open: boolean) => void;
};

export type EditorSlice = EditorState & EditorActions;

export const createEditorSlice: StateCreator<AppState, [], [], EditorSlice> = (set, get) => ({
  schemeId: null,
  schemeName: "",
  schemeDescription: "",
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
  picker: null,
  presetGalleryOpen: false,
  lastRemoved: null,
  activeBase: null,
  baseRules: undefined,
  baseRulesError: "",
  overlayClipboard: null,
  lastRemovedOverlay: null,
  lastRestoredBaseRules: null,

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
      activeBase: null,
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
        activeBase: null,
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

  setActiveRuleId: (activeRuleId) => set({ activeRuleId, activeBase: null }),

  setActiveBase: (activeBase) => set({ activeBase }),

  selectBaseRule: (delta) =>
    set((state) => {
      if (state.activeBase?.kind !== "rule") return state;
      const next = state.activeBase.index + delta;
      return next >= 0 && next < (state.baseRules?.rules.length ?? 0) ? { activeBase: { kind: "rule", index: next } } : state;
    }),

  loadBaseRules: async () => {
    const base = get().profile.baseFilter;
    const request = ++counters.baseRules;
    set({ baseRules: undefined, baseRulesError: "" });
    if (!base) return;
    try {
      const rules = await local<BaseRules>("base_rules", { base, profile: get().profile });
      if (request !== counters.baseRules) return;
      // 重新读取后原来的序号可能已经不存在。
      const activeBase = get().activeBase;
      set({
        baseRules: rules,
        activeBase: activeBase?.kind === "rule" && !rules.rules[activeBase.index] ? null : activeBase,
      });
    } catch (cause) {
      if (request === counters.baseRules) set({ baseRulesError: explain(cause) || "无法读取基础过滤器的规则。" });
    }
  },

  editBaseRule: (index, patch) =>
    set((state) => {
      const rule = state.baseRules?.rules[index];
      const base = state.profile.baseFilter;
      if (!rule || !base || state.profile.editsEnabled === false) return state;
      const overlays = state.profile.overlays;
      // 规则表是读取时的快照，修改按规则原有的条件来找，不靠快照里记的对应关系。
      const key = blockKey(rule.conditions);
      const existing = overlays.find((overlay) => blockKey(overlay.conditions) === key);
      const edit: BaseOverlay = {
        id: existing?.id ?? newRuleId(takenIds(state.profile)),
        baseName: existing?.baseName ?? base.name,
        conditions: existing?.conditions ?? [...rule.conditions],
        enabled: existing?.enabled ?? true,
        hidden: existing?.hidden,
        conditionLines: existing?.conditionLines,
        effects: existing?.effects ?? {},
        ...patch,
      };
      // 和基础规则原样相同的项不算修改。
      if (edit.hidden === rule.hidden) delete edit.hidden;
      if (edit.conditionLines && blockKey(edit.conditionLines) === key) delete edit.conditionLines;
      const changed = edit.hidden !== undefined || edit.conditionLines !== undefined || hasEffects(edit.effects);
      const customSounds = { ...state.customSounds };
      if (existing && !changed) delete customSounds[existing.id];
      return {
        dirty: true,
        customSounds,
        profile: {
          ...state.profile,
          overlays: [...overlays.filter((overlay) => overlay !== existing), ...(changed ? [edit] : [])],
        },
      };
    }),

  updateOverlay: (id, patch) =>
    set((state) => ({
      dirty: true,
      profile: { ...state.profile, overlays: state.profile.overlays.map((overlay) => overlay.id === id ? { ...overlay, ...patch } : overlay) },
    })),

  removeOverlay: (id) =>
    set((state) => {
      const index = state.profile.overlays.findIndex((overlay) => overlay.id === id);
      if (index < 0) return state;
      const customSounds = { ...state.customSounds };
      const sound = customSounds[id];
      delete customSounds[id];
      return {
        dirty: true,
        profile: { ...state.profile, overlays: state.profile.overlays.filter((overlay) => overlay.id !== id) },
        customSounds,
        activeBase: state.activeBase?.kind === "edit" && state.activeBase.id === id ? null : state.activeBase,
        lastRemovedOverlay: { overlay: state.profile.overlays[index], index, sound },
      };
    }),

  undoRemoveOverlay: () =>
    set((state) => {
      const removed = state.lastRemovedOverlay;
      if (!removed) return state;
      const overlays = [...state.profile.overlays];
      overlays.splice(Math.min(removed.index, overlays.length), 0, removed.overlay);
      return {
        dirty: true,
        profile: { ...state.profile, overlays },
        customSounds: removed.sound ? { ...state.customSounds, [removed.overlay.id]: removed.sound } : state.customSounds,
        lastRemovedOverlay: null,
      };
    }),

  setOverlaySound: (id, file) => {
    const state = get();
    const overlay = state.profile.overlays.find((entry) => entry.id === id);
    if (!file || !overlay || state.profile.editsEnabled === false) return;
    const existing = customSoundOptions(state.profile.rules, state.customSounds, state.profile.overlays.filter((entry) => entry.id !== id));
    const fileName = customSoundFileName(file, existing);
    const picked = existing.find((option) => option.fileName === fileName)?.file ?? file;
    set({
      dirty: true,
      customSounds: { ...state.customSounds, [id]: picked },
      profile: {
        ...state.profile,
        overlays: state.profile.overlays.map((entry) =>
          entry.id === id ? { ...entry, effects: { ...entry.effects, sound: { type: "custom", fileName } } } : entry),
      },
    });
  },

  /** 在下拉里选一个方案里已有的自定义音效，给一处修改用，名字和文件都照原样用。 */
  pickOverlaySound: (id, option) =>
    set((state) => ({
      dirty: true,
      customSounds: { ...state.customSounds, [id]: option.file },
      profile: {
        ...state.profile,
        overlays: state.profile.overlays.map((entry) =>
          entry.id === id ? { ...entry, effects: { ...entry.effects, sound: { type: "custom", fileName: option.fileName } } } : entry),
      },
    })),

  copyOverlays: () =>
    set((state) => ({
      overlayClipboard: state.profile.overlays.map((overlay) => ({
        overlay: structuredClone(overlay),
        file: overlay.effects.sound?.type === "custom" ? state.customSounds[overlay.id] : undefined,
      })),
    })),

  pasteOverlays: () => {
    const state = get();
    const clipboard = state.overlayClipboard;
    if (!clipboard?.length || state.profile.editsEnabled === false) return null;
    const overlays = [...state.profile.overlays];
    const customSounds = { ...state.customSounds };
    for (const { overlay, file } of clipboard) {
      const index = overlays.findIndex((entry) => blockKey(entry.conditions) === blockKey(overlay.conditions));
      const id = newRuleId([...state.profile.rules.map((rule) => rule.id), ...overlays.map((entry) => entry.id)]);
      if (index >= 0) delete customSounds[overlays[index].id];
      const pasted = { ...structuredClone(overlay), id };
      if (file) {
        // 方案里已经有同名但内容不同的音效时，粘贴来的另起名字，两边的音效互不覆盖。
        const fileName = customSoundFileName(file, customSoundOptions(state.profile.rules, customSounds, overlays.filter((_, at) => at !== index)));
        if (pasted.effects.sound?.type === "custom") pasted.effects.sound.fileName = fileName;
        customSounds[id] = file;
      }
      if (index >= 0) overlays[index] = pasted;
      else overlays.push(pasted);
    }
    set({ dirty: true, customSounds, profile: { ...state.profile, overlays } });
    const base = state.profile.baseFilter;
    const known = state.baseRules && new Set(state.baseRules.rules.map((rule) => blockKey(rule.conditions)));
    const invalid = clipboard.filter(({ overlay }) =>
      !base || overlay.baseName !== base.name || Boolean(known && !known.has(blockKey(overlay.conditions)))).length;
    if (base) void get().loadBaseRules();
    return { pasted: clipboard.length, invalid };
  },

  setEditsEnabled: (enabled) => get().update("editsEnabled", enabled),

  restoreBaseRules: () => {
    const state = get();
    const overlays = state.profile.overlays;
    if (!overlays.length) return 0;
    const customSounds = { ...state.customSounds };
    const sounds: Record<string, File> = {};
    for (const overlay of overlays) {
      const file = customSounds[overlay.id];
      if (file) sounds[overlay.id] = file;
      delete customSounds[overlay.id];
    }
    set({
      dirty: true,
      customSounds,
      profile: { ...state.profile, overlays: [] },
      // 选中的失效修改已经不在了。
      activeBase: state.activeBase?.kind === "edit" ? null : state.activeBase,
      lastRestoredBaseRules: { overlays, sounds },
      lastRemovedOverlay: null,
    });
    return overlays.length;
  },

  undoRestoreBaseRules: () => {
    const state = get();
    const restored = state.lastRestoredBaseRules;
    if (!restored) return;
    // 还原之后又给同一条规则建了修改的，保留新的。
    const current = state.profile.overlays;
    const overlays = restored.overlays.filter((overlay) => !current.some((entry) => blockKey(entry.conditions) === blockKey(overlay.conditions)));
    const customSounds = { ...state.customSounds };
    for (const overlay of overlays) {
      const file = restored.sounds[overlay.id];
      if (file) customSounds[overlay.id] = file;
    }
    set({
      dirty: true,
      profile: { ...state.profile, overlays: [...current, ...overlays] },
      customSounds,
      lastRestoredBaseRules: null,
    });
  },

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
        // 规则 ID 隐式跟随的四个价格档，显式固定后记下 false，读取时保留自己的样式。
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
    // 和方案里别的规则、修改已经在用的音效同名时：内容相同就共用那一份，内容不同就另起一个名字，两边的音效互不覆盖。
    const existing = customSoundOptions(
      state.profile.rules.filter((entry) => entry.id !== id),
      state.customSounds,
      state.profile.overlays,
    );
    const fileName = customSoundFileName(file, existing);
    const picked = existing.find((option) => option.fileName === fileName)?.file ?? file;
    state.setRuleAppearance(id, { effects: { ...effects, sound: { type: "custom", fileName } }, file: picked });
  },

  /** 在下拉里选一个方案里已有的自定义音效，名字和文件都照原样用。 */
  pickRuleSound: (id, option) => {
    const state = get();
    const rule = state.profile.rules.find((entry) => entry.id === id);
    if (!rule || ruleEffectsPending(rule, state)) return;
    const effects = shownRuleEffects(rule, state.baseInspection);
    state.setRuleAppearance(id, { effects: { ...effects, sound: { type: "custom", fileName: option.fileName } }, file: option.file });
  },

  setBaseFilter: (base) => {
    counters.baseFilterChanged = true;
    counters.inspection += 1;
    set((state) => ({
      dirty: true,
      baseInspection: undefined,
      baseStylesError: "",
      baseRules: undefined,
      baseRulesError: "",
      baseRevision: state.baseRevision + 1,
      activeBase: null,
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
      const read = async (id: string, sound: PresetSound | undefined) => {
        if (sound?.type !== "custom") return;
        let file = reads.get(sound.fileName);
        if (!file) {
          file = readSound(sound.fileName, scheme.id);
          reads.set(sound.fileName, file);
        }
        try {
          soundFiles[id] = await file;
        } catch {
          missing.add(sound.fileName);
        }
      };
      await Promise.all([
        ...draft.rules.map((rule) => read(rule.id, rule.baselineEffectItemId ? undefined : rule.effects.sound)),
        ...draft.overlays.map((overlay) => read(overlay.id, overlay.effects.sound)),
      ]);
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
      schemeDescription: scheme?.description ?? "",
      leagueCatalog: catalog,
      profile: draft
        ? { ...draft, server: target }
        : { ...structuredClone(DEFAULT_PROFILE), server: target, league, originalLeague: league },
      customSounds: soundFiles,
      activeRuleId: undefined,
      activeBase: null,
      lastRemoved: null,
      lastRemovedOverlay: null,
      lastRestoredBaseRules: null,
      baseRules: undefined,
      baseRulesError: "",
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

  saveScheme: async (name, description) => {
    const { profile, customSounds, schemeId } = get();
    set({ schemeBusy: true, saveError: "" });
    let saved: SavedScheme;
    try {
      const uploads: Record<string, string> = {};
      let bytes = 0;
      for (const { id, sound } of [
        ...profile.rules.filter((rule) => !rule.baselineEffectItemId).map((rule) => ({ id: rule.id, sound: rule.effects.sound })),
        ...profile.overlays.map((overlay) => ({ id: overlay.id, sound: overlay.effects.sound })),
      ]) {
        const file = customSounds[id];
        if (sound?.type !== "custom" || !file || Object.prototype.hasOwnProperty.call(uploads, sound.fileName)) continue;
        bytes += file.size;
        if (bytes > 32 * 1024 * 1024) throw new Error("音效合计最多 32 MB");
        uploads[sound.fileName] = await fileToBase64(file);
      }
      saved = await local<SavedScheme>("scheme_save", {
        edit: { id: schemeId, name, description, profile, sounds: uploads, baseFilterChanged: counters.baseFilterChanged },
      });
    } catch (cause) {
      throw explain(cause);
    } finally {
      set({ schemeBusy: false });
    }
    get().leaveEditor();
    // 已安装的方案保存后马上重新生成。没能重新生成时，原因显示在方案库顶部，和方案卡片上的一样。
    if (saved.error) set({ managerError: `「${name}」${saved.error}` });
    else toast.success(saved.regenerated ? `「${name}」已保存，游戏里的过滤器已更新` : `「${name}」已保存`);
  },

  requestSave: () => {
    const { schemeId, schemeName, schemeDescription } = get();
    set({ saveError: "" });
    if (get().schemeBusy) return;
    if (schemeId) void get().saveScheme(schemeName, schemeDescription).catch((cause) => set({ saveError: explain(cause) }));
    else set({ editorDialog: "saveName" });
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
      activeBase: null,
      editorDialog: null,
      picker: null,
      presetGalleryOpen: false,
      view: "manager",
    });
  },

  setEditorDialog: (editorDialog) => set({ editorDialog }),
  setSaveError: (saveError) => set({ saveError }),
  openPicker: (target) => set({ picker: target }),
  closePicker: () => set({ picker: null }),
  setPresetGalleryOpen: (presetGalleryOpen) => set({ presetGalleryOpen }),
});

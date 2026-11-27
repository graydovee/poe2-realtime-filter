import type { StateCreator } from "zustand";
import { toast } from "sonner";

import { explain, local, type Library, type LocalScheme } from "../../lib/desktop";
import type { GameServer } from "../../lib/types";
import { counters } from "./counters";
import type { AppState } from "./store";
import type {
  DownloadOffer, ManagerDialog, ManagerDialogKind, PackageDecisions, PackageImport, PickedPackage, ShareDetails,
} from "./types";

export type ManagerState = {
  library: Library | undefined;
  managerBusy: boolean;
  managerError: string;
  selectedSchemeId: string | null;
  managerDialog: ManagerDialog | null;
  /** 基础过滤器缺失时的下载来源，按提示名索引。 */
  baseOffers: Record<string, DownloadOffer[]>;
  importOpen: boolean;
  shareCode: string;
  importName: string;
  importTarget: ShareDetails | null;
  importLeague: string;
  /** 剪贴板不可用时，把分享码显示在这里供手动复制。 */
  shareOutput: string;
  directoryDraft: string | undefined;
  directoryError: string;
  intervalDraft: string | undefined;
  removeFile: boolean;
  /** 每次收到 `local-refresh` 递增，用来重新读取下载来源。 */
  refreshTick: number;
  /** 导出方案包的对话框：选中的方案和可选的包名称。 */
  exportOpen: boolean;
  exportIds: string[];
  exportTitle: string;
  /** 待确认的方案包导入。 */
  packageImport: PackageImport | null;
};

export type ManagerActions = {
  reloadLibrary: () => Promise<void>;
  /** 包一层统一的忙碌态与错误处理，结束后重新读取方案库。 */
  runManager: (action: () => Promise<void>) => Promise<void>;
  selectServer: (server: GameServer) => Promise<void>;
  saveDirectory: (path: string | null) => Promise<void>;
  updateSettings: (intervalMinutes: number, paused: boolean) => Promise<void>;
  setAutostart: (enabled: boolean) => Promise<void>;
  setSelectedSchemeId: (id: string | null) => void;
  openManagerDialog: (kind: ManagerDialogKind, scheme: LocalScheme) => void;
  setManagerDialog: (dialog: ManagerDialog | null) => void;
  confirmManagerDialog: () => Promise<void>;
  /** 保存方案的名称和描述，成功后刷新方案库并同步编辑器里的名称。失败时抛出错误信息。 */
  updateSchemeInfo: (id: string, name: string, description: string) => Promise<void>;
  installScheme: (scheme: LocalScheme) => Promise<void>;
  copyScheme: (id: string) => Promise<void>;
  shareScheme: (scheme: LocalScheme) => Promise<void>;
  downloadZip: (scheme: LocalScheme) => Promise<void>;
  pickFilterDirectory: (current: string) => Promise<void>;
  refreshLeagueMarket: (league: string) => Promise<void>;
  /** 解析导入框里的分享码；服务器或赛季不一致时先进入确认对话框。 */
  inspectShare: () => Promise<void>;
  importShare: (server: GameServer, league?: string) => Promise<void>;
  downloadBase: (scheme: LocalScheme, hint: string, source: string, label: string) => Promise<void>;
  /** 打开导出方案包的对话框；带方案时预先选中它。 */
  openExport: (scheme?: LocalScheme) => void;
  exportSelected: () => Promise<void>;
  /** 直接导出一个方案。 */
  exportPackage: (scheme: LocalScheme) => Promise<void>;
  /** 选择方案包；没有需要决定的事项时直接导入。 */
  pickPackage: () => Promise<void>;
  importPackage: () => Promise<void>;
  patchManager: (patch: Partial<ManagerState>) => void;
};

export type ManagerSlice = ManagerState & ManagerActions;

/** 导入前的默认选择：重名的新方案用后端给的空闲名称，其余按默认动作。 */
function packageImportFrom(picked: PickedPackage): PackageImport {
  const names: Record<number, string> = {};
  for (const scheme of picked.plan.schemes) {
    if (scheme.state === "new" && scheme.conflict) names[scheme.index] = scheme.conflict;
  }
  return {
    path: picked.path,
    title: picked.title ?? "",
    current: picked.current,
    plan: picked.plan,
    catalog: picked.catalog,
    league: picked.catalog.defaultLeague,
    names,
    skips: [],
    copies: [],
    keeps: [],
    baseCopies: [],
  };
}

function decisionsFrom(state: PackageImport): PackageDecisions {
  return {
    league: state.plan.needsLeague ? state.league || undefined : undefined,
    names: state.names,
    schemeSkips: state.skips,
    schemeCopies: state.copies,
    baseKeeps: state.keeps,
    baseCopies: state.baseCopies,
  };
}

function toastOutcome(state: PackageImport) {
  let added = 0;
  let updated = 0;
  let stored = 0;
  for (const scheme of state.plan.schemes) {
    if (state.copies.includes(scheme.index) || scheme.state === "new") added += 1;
    else if (scheme.state === "update" && !scheme.blocked && !state.skips.includes(scheme.index)) updated += 1;
  }
  for (const base of state.plan.bases) {
    const copy =
      base.state === "copy" ||
      (base.state === "choose" && state.baseCopies.includes(base.index)) ||
      (base.state === "updateCopy" && !state.keeps.includes(base.index));
    if (copy) stored += 1;
  }
  const parts = [
    added ? `导入 ${added} 个方案` : "",
    updated ? `更新 ${updated} 个方案` : "",
    stored ? `存入 ${stored} 份基础过滤器` : "",
  ].filter(Boolean);
  toast.success(parts.length ? `已${parts.join("，")}` : "包里的方案都已是最新");
}

export const createManagerSlice: StateCreator<AppState, [], [], ManagerSlice> = (set, get) => {
  /** 确认后的分享码导入。直接导入和从确认框导入共用。 */
  const importConfirmed = async (server: GameServer, league?: string) => {
    const { shareCode, importName } = get();
    const { missing } = await local<{ missing: string[] }>("scheme_import", {
      code: shareCode,
      name: importName.trim() || null,
      server,
      league: league || null,
    });
    set({ shareCode: "", importName: "", importTarget: null, importOpen: false, intervalDraft: undefined });
    toast.success(missing.length ? `已导入方案，请在编辑器里补齐自定义音效：${missing.join("、")}` : "方案已导入到方案库");
  };

  return {
  library: undefined,
  managerBusy: false,
  managerError: "",
  selectedSchemeId: null,
  managerDialog: null,
  baseOffers: {},
  importOpen: false,
  shareCode: "",
  importName: "",
  importTarget: null,
  importLeague: "",
  shareOutput: "",
  directoryDraft: undefined,
  directoryError: "",
  intervalDraft: undefined,
  removeFile: false,
  refreshTick: 0,
  exportOpen: false,
  exportIds: [],
  exportTitle: "",
  packageImport: null,

  reloadLibrary: async () => {
    const version = ++counters.library;
    try {
      const value = await local<Library>("library");
      if (version === counters.library) set({ library: value });
    } catch (cause) {
      if (version === counters.library) set({ managerError: explain(cause) });
    }
  },

  runManager: async (action) => {
    set({ managerBusy: true, managerError: "" });
    try {
      await action();
    } catch (cause) {
      set({ managerError: explain(cause) });
    } finally {
      await get().reloadLibrary();
      set({ managerBusy: false });
    }
  },

  selectServer: async (server) => {
    await get().runManager(async () => {
      await local("select_server", { server });
      set({ intervalDraft: undefined });
    });
  },

  saveDirectory: async (path) => {
    await get().runManager(async () => {
      set({ directoryError: "" });
      try {
        await local("save_filter_directory", { directory: path });
        set({ directoryDraft: undefined });
        toast.success(path === null ? "已恢复自动检测的目录" : "过滤器目录已保存");
      } catch (cause) {
        set({ directoryError: explain(cause) });
      }
    });
  },

  updateSettings: async (intervalMinutes, paused) => {
    const { library } = get();
    if (!library) return;
    await get().runManager(async () => {
      await local("save_settings", { server: library.server, intervalMinutes, paused });
      set({ intervalDraft: undefined });
      toast.success("刷新设置已保存");
    });
  },

  setAutostart: async (enabled) => {
    await get().runManager(async () => {
      await local("set_autostart", { enabled });
      toast.success(enabled ? "已开启开机启动" : "已关闭开机启动");
    });
  },

  setSelectedSchemeId: (selectedSchemeId) => set({ selectedSchemeId }),

  openManagerDialog: (kind, scheme) =>
    set({ managerDialog: { kind, scheme }, managerError: "", removeFile: false }),

  setManagerDialog: (managerDialog) => set({ managerDialog }),

  updateSchemeInfo: async (id, name, description) => {
    set({ managerBusy: true, managerError: "" });
    try {
      await local("scheme_update_info", { id, name, description });
    } catch (cause) {
      await get().reloadLibrary();
      set({ managerBusy: false });
      throw new Error(explain(cause));
    }
    await get().reloadLibrary();
    set({ managerBusy: false, managerDialog: null });
    const saved = get().library?.schemes.find((scheme) => scheme.id === id);
    if (saved && get().schemeId === id) set({ schemeName: saved.name, schemeDescription: saved.description });
    toast.success("名称和描述已更新");
  },

  confirmManagerDialog: async () => {
    const dialog = get().managerDialog;
    if (!dialog) return;
    const { kind, scheme } = dialog;
    await get().runManager(async () => {
      if (kind === "uninstall") {
        await local("scheme_uninstall", { id: scheme.id });
        toast.success("过滤器已卸载，方案已保留");
      } else if (kind === "remove") {
        const removeFile = get().removeFile;
        await local("scheme_remove", { id: scheme.id, removeFile });
        toast.success(scheme.installed && !removeFile ? "方案已删除，游戏过滤器已保留" : "方案已删除");
        if (get().selectedSchemeId === scheme.id) set({ selectedSchemeId: null });
      }
      set({ managerDialog: null });
    });
  },

  installScheme: async (scheme) => {
    await get().runManager(() => local("scheme_install", { id: scheme.id }));
  },

  copyScheme: async (id) => {
    await get().runManager(async () => {
      await local("scheme_copy", { id });
      toast.success("方案已复制");
    });
  },

  /** 优先复制到剪贴板；剪贴板不可用时把分享码显示出来供手动复制。 */
  shareScheme: async (scheme) => {
    await get().runManager(async () => {
      const code = await local<string>("scheme_share", { id: scheme.id });
      try {
        await navigator.clipboard.writeText(code);
        set({ shareOutput: "" });
        toast.success("分享码已复制");
      } catch {
        set({ shareOutput: code });
      }
    });
  },

  downloadZip: async (scheme) => {
    await get().runManager(async () => {
      if (await local<boolean>("scheme_download", { id: scheme.id })) toast.success(`「${scheme.name}」 ZIP 已保存`);
    });
  },

  /** 打开系统目录选择框，选中的目录先填进输入框，保存后才生效。 */
  pickFilterDirectory: async (current) => {
    await get().runManager(async () => {
      set({ directoryError: "" });
      const picked = await local<string | null>("pick_filter_directory", { current });
      if (picked) set({ directoryDraft: picked });
    });
  },

  refreshLeagueMarket: async (league) => {
    await get().runManager(async () => {
      await local("refresh_market", { server: get().library?.server, league: league || null });
      toast.success("行情已刷新");
    });
  },

  inspectShare: async () => {
    const { library, shareCode } = get();
    if (!library) return;
    await get().runManager(async () => {
      const target = await local<ShareDetails>("inspect_share", { code: shareCode, server: library.server });
      const matching = target.catalog.leagues.some((season) => season.id === target.league);
      if (target.server !== library.server || (!target.hasServer && !matching)) {
        set({ importLeague: !target.hasServer ? target.catalog.defaultLeague : "", importTarget: target });
      } else {
        await importConfirmed(target.server);
      }
    });
  },

  /** 从确认框发起的导入也走统一的忙碌态和错误提示。 */
  importShare: (server, league) => get().runManager(() => importConfirmed(server, league)),

  downloadBase: async (scheme, hint, source, label) => {
    await get().runManager(async () => {
      toast.info(`正在下载并校验 ${label} 基础过滤器…`);
      try {
        await local("scheme_download_base", { id: scheme.id, source });
        toast.success(`「${scheme.name}」已选用下载的基础过滤器`);
      } catch (cause) {
        throw new Error(`${hint}：${explain(cause)}`);
      }
    });
  },

  openExport: (scheme) =>
    set({ exportOpen: true, exportIds: scheme ? [scheme.id] : [], exportTitle: "", managerError: "" }),

  exportSelected: async () => {
    const { exportIds: ids, exportTitle } = get();
    if (!ids.length) return;
    await get().runManager(async () => {
      if (await local<boolean>("scheme_export_package", { ids, title: exportTitle.trim() || null })) {
        set({ exportOpen: false });
        toast.success("方案包已保存");
      }
    });
  },

  exportPackage: (scheme) =>
    get().runManager(async () => {
      if (await local<boolean>("scheme_export_package", { ids: [scheme.id], title: null })) {
        toast.success(`「${scheme.name}」方案包已保存`);
      }
    }),

  pickPackage: () =>
    get().runManager(async () => {
      const picked = await local<PickedPackage | null>("pick_scheme_package");
      if (!picked) return;
      // 导入到另一个服务器也要确认一次。
      if (picked.plan.review || picked.plan.server !== picked.current) {
        set({ packageImport: packageImportFrom(picked) });
        return;
      }
      const state = packageImportFrom(picked);
      await local("scheme_import_package", { path: state.path, decisions: decisionsFrom(state) });
      toastOutcome(state);
    }),

  importPackage: async () => {
    const state = get().packageImport;
    if (!state) return;
    await get().runManager(async () => {
      await local("scheme_import_package", { path: state.path, decisions: decisionsFrom(state) });
      set({ packageImport: null, intervalDraft: undefined });
      toastOutcome(state);
    });
  },

  patchManager: (patch) => set(patch),
  };
};

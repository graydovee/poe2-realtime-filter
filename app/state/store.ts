import { useMemo, useSyncExternalStore } from "react";
import type { StateCreator } from "zustand";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { FALLBACK_SNAPSHOT } from "../../lib/data";
import type { MarketSnapshot } from "../../lib/types";
import { createEditorSlice, type EditorSlice } from "./editor";
import { createManagerSlice, type ManagerSlice } from "./manager";
import type { View } from "./types";

type UiSlice = {
  view: View;
  setView: (view: View) => void;
  /** 停靠在右侧时的展开状态，会记住。 */
  inspectorOpen: boolean;
  /** 停靠时的检查器宽度（像素）。 */
  inspectorWidth: number;
  /** 窗口较窄时检查器改为侧滑层；只在用户主动唤出时打开，不记忆。 */
  inspectorPeek: boolean;
  setInspectorOpen: (open: boolean) => void;
  setInspectorPeek: (open: boolean) => void;
  toggleInspector: () => void;
  setInspectorWidth: (width: number) => void;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  /** 规则列表里是否列出基础过滤器的规则，会记住。 */
  showBaseRules: boolean;
  setShowBaseRules: (open: boolean) => void;
};

/** 窗口不窄于这个宽度时，检查器停靠在右侧；否则从侧边滑出。 */
export const INSPECTOR_DOCK_QUERY = "(min-width: 1180px)";

const createUiSlice: StateCreator<AppState, [], [], UiSlice> = (set, get) => ({
  view: "manager",
  setView: (view) => set({ view }),
  inspectorOpen: true,
  inspectorWidth: 320,
  inspectorPeek: false,
  setInspectorOpen: (inspectorOpen) => set({ inspectorOpen }),
  setInspectorPeek: (inspectorPeek) => set({ inspectorPeek }),
  toggleInspector: () => set({ inspectorOpen: !get().inspectorOpen }),
  setInspectorWidth: (inspectorWidth) => set({ inspectorWidth }),
  paletteOpen: false,
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  showBaseRules: false,
  setShowBaseRules: (showBaseRules) => set({ showBaseRules }),
});

export type AppState = UiSlice & EditorSlice & ManagerSlice;

export const useAppStore = create<AppState>()(
  persist(
    (...a) => ({
      ...createUiSlice(...a),
      ...createManagerSlice(...a),
      ...createEditorSlice(...a),
    }),
    {
      name: "poe2-filter.ui",
      storage: createJSONStorage(() => localStorage),
      // 首屏服务端渲染与本地恢复可能不一致，挂载后再恢复。
      skipHydration: true,
      partialize: (state) => ({
        inspectorOpen: state.inspectorOpen,
        inspectorWidth: state.inspectorWidth,
        showBaseRules: state.showBaseRules,
      }),
    },
  ),
);

const subscribe = (listener: () => void) => {
  const query = window.matchMedia(INSPECTOR_DOCK_QUERY);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
};

/** 窗口足够宽时检查器停靠在右侧，否则从侧边滑出。 */
export function useDockedInspector(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(INSPECTOR_DOCK_QUERY).matches, () => true);
}

const dockedNow = () => typeof window !== "undefined" && window.matchMedia(INSPECTOR_DOCK_QUERY).matches;

/** 检查器在当前窗口形态下是否显示。 */
export function inspectorShownForViewport() {
  const state = useAppStore.getState();
  return dockedNow() ? state.inspectorOpen : state.inspectorPeek;
}

/** 按当前窗口形态切换检查器：停靠时切换展开状态，侧滑时切换唤出状态。 */
export function toggleInspectorForViewport() {
  const state = useAppStore.getState();
  if (dockedNow()) state.toggleInspector();
  else state.setInspectorPeek(!state.inspectorPeek);
}

/** 选中方案后让检查器可见：停靠时展开，窄窗口时唤出侧滑层。 */
export function revealInspector() {
  if (!inspectorShownForViewport()) toggleInspectorForViewport();
}

/** 与当前服务器、赛季匹配且未过期的行情；否则是带当前赛季名的回退数据。 */
export function useEditorMarket(): { matching: boolean; selected: MarketSnapshot } {
  const league = useAppStore((state) => state.profile.league);
  const server = useAppStore((state) => state.profile.server) ?? "international";
  const market = useAppStore((state) => state.market);
  return useMemo(() => {
    const matching = (market.server ?? "international") === server && market.league === league;
    const selected =
      matching && Date.parse(market.expiresAt) >= Date.now() ? market : { ...FALLBACK_SNAPSHOT, league };
    return { matching, selected };
  }, [league, server, market]);
}

"use client";

import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";

import { isDesktop, isTauri } from "../../lib/desktop";
import { useAppStore } from "./store";

/** 订阅后端事件；浏览器预览没有 Tauri 运行时，不订阅。返回取消订阅函数。 */
function subscribe(event: string, handler: () => void) {
  if (!isTauri()) return () => {};
  const listener = listen(event, handler);
  return () => void listener.then((unlisten) => unlisten()).catch(() => {});
}

/**
 * 把后端事件接到 store：
 * - 进入方案库时读取方案列表；
 * - 进入编辑器后按服务器读取赛季列表、按赛季读取行情；
 * - 更换基础过滤器后重新读取它的特效样式；
 * - `local-refresh` 到达时刷新当前视图依赖的数据。
 */
export function useAppBridge() {
  const view = useAppStore((state) => state.view);
  const base = useAppStore((state) => state.profile.baseFilter);
  const baseRevision = useAppStore((state) => state.baseRevision);
  const server = useAppStore((state) => state.profile.server) ?? "international";
  const league = useAppStore((state) => state.profile.league);

  useEffect(() => {
    void useAppStore.persist.rehydrate();
  }, []);

  useEffect(() => {
    void useAppStore.getState().loadBaseInspection();
  }, [view, base, baseRevision]);

  useEffect(() => {
    if (!isDesktop() || view !== "manager") return;
    void useAppStore.getState().reloadLibrary();
    return subscribe("local-refresh", () => {
      const state = useAppStore.getState();
      void state.reloadLibrary();
      state.patchManager({ refreshTick: state.refreshTick + 1 });
    });
  }, [view]);

  useEffect(() => {
    if (!isDesktop() || view !== "editor") return;
    const load = () => {
      void useAppStore.getState().loadCatalog(server).catch(() => {});
      void useAppStore.getState().loadMarket(server, league).catch(() => {});
    };
    load();
    return subscribe("local-refresh", load);
  }, [view, server, league]);
}

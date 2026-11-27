"use client";

import { listen } from "@tauri-apps/api/event";

import { isTauri } from "../../lib/desktop";

/** 下载来源的一个阶段：检查新版本、下载压缩包（已收到的字节数和总字节数）、解压。 */
export type DownloadProgress =
  | { state: "checking" }
  | { state: "downloading"; received: number; total: number | null }
  | { state: "extracting" };

/** 后端停止下载时返回的错误信息。 */
export const DOWNLOAD_CANCELLED = "已取消下载";

type Listener = (source: string, progress: DownloadProgress) => void;

const listeners = new Set<Listener>();
let listening = false;

/** 桌面壳用 `base-download` 事件推送进度；演示模式由 mock-bridge 调用 `reportDownloadProgress`。 */
export function subscribeDownloadProgress(listener: Listener): () => void {
  listeners.add(listener);
  if (!listening && isTauri()) {
    listening = true;
    void listen<{ source: string; progress: DownloadProgress }>("base-download", ({ payload }) => {
      reportDownloadProgress(payload.source, payload.progress);
    }).catch(() => {
      listening = false;
    });
  }
  return () => {
    listeners.delete(listener);
  };
}

export function reportDownloadProgress(source: string, progress: DownloadProgress) {
  for (const listener of listeners) listener(source, progress);
}

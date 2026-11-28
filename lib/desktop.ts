import { invoke, type InvokeArgs, type InvokeOptions } from "@tauri-apps/api/core";
import type { BaseFilter, FilterProfile, GameServer } from "./types";

export type LocalScheme = {
  id: string;
  name: string;
  /** 一行说明，显示在方案库的卡片上。 */
  description: string;
  profile: FilterProfile;
  autoRefresh: boolean;
  installed: {
    name: string;
    directory: string;
    /** 已安装的过滤器所用行情的抓取时间（ISO）。升级前安装的方案和当时没有行情的方案为空。 */
    marketCapturedAt?: string | null;
  } | null;
  status: string;
};

export type Settings = { intervalMinutes: number; paused: boolean };
/** 保存方案的结果。已安装的方案保存后马上重新生成；没能重新生成时 `error` 是写进方案状态的说明。 */
export type SavedScheme = { id: string; regenerated: boolean; error: string | null };
export type Library = {
  server: GameServer;
  settings: Settings;
  schemes: LocalScheme[];
  filterDirectory: string;
  customDirectory: boolean;
  /** 开机启动项是否指向本客户端；读不到启动项时为 null，开关不可用。 */
  autostart: boolean | null;
};
export const SERVER_LABELS: Record<GameServer, string> = { international: "国际服 POE2", tencent: "腾讯服 POE2" };
export function displayDirectory(path: string): string {
  if (path.startsWith("\\\\?\\UNC\\")) return "\\\\" + path.slice(8);
  if (/^\\\\\?\\[A-Za-z]:/.test(path)) return path.slice(4);
  return path;
}

export const explain = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);

/**
 * 开发构建下用 ?mock=1 打开时，Tauri 命令交给演示数据（app/dev/mock-bridge.ts），
 * 这样不启动桌面壳也能在浏览器里走完整套界面。生产构建里这段逻辑会被整体剔除。
 */
const mockEnabled = () =>
  typeof window !== "undefined" && new URLSearchParams(window.location.search).has("mock");

export const isDesktop = () => typeof window !== "undefined" && ("__TAURI_INTERNALS__" in window || (process.env.NODE_ENV === "development" && mockEnabled()));

/** 是否真的运行在桌面壳里。事件订阅只能用它判断：浏览器预览没有 Tauri 运行时，订阅会直接抛错。 */
export const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function local<T>(cmd: string, args?: InvokeArgs, options?: InvokeOptions): Promise<T> {
  if (process.env.NODE_ENV === "development" && mockEnabled()) {
    const { mockInvoke } = await import("../app/dev/mock-bridge");
    return mockInvoke<T>(cmd, args as Record<string, unknown> | undefined);
  }
  return invoke<T>(cmd, args, options);
}

export async function fileToBase64(file: File): Promise<string> {
  if (file.size <= 0 || file.size > 8 * 1024 * 1024) throw new Error("单个音效应为 1 字节至 8 MB");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("无法读取音效"));
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1]);
    reader.readAsDataURL(file);
  });
}

export async function readSound(name: string, id?: string, base?: BaseFilter): Promise<File> {
  const encoded = await invoke<string>("local_sound", { id: id ?? null, name, base: base ?? null });
  const bytes = Uint8Array.from(atob(encoded), (byte) => byte.charCodeAt(0));
  const ext = name.split(".").at(-1)?.toLowerCase();
  const type = ext === "mp3" ? "audio/mpeg" : ext === "wav" ? "audio/wav" : "audio/ogg";
  return new File([bytes], name, { type });
}

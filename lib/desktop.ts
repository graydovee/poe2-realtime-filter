import { invoke } from "@tauri-apps/api/core";
import type { BaseFilter, FilterProfile } from "./types";

export type LocalScheme = {
  id: string;
  name: string;
  profile: FilterProfile;
  autoRefresh: boolean;
  installed: { name: string; directory: string } | null;
  status: string;
};

export type Settings = { intervalMinutes: number; paused: boolean; filterDirectory: string | null };
export type Library = { settings: Settings; schemes: LocalScheme[]; filterDirectory: string };
export function displayDirectory(path: string): string {
  if (path.startsWith("\\\\?\\UNC\\")) return "\\\\" + path.slice(8);
  if (/^\\\\\?\\[A-Za-z]:/.test(path)) return path.slice(4);
  return path;
}

export const explain = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);
export const isDesktop = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
export const local = invoke;

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

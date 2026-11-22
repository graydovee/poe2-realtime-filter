"use client";

import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { explain, isDesktop, local } from "../../lib/desktop";
import { Button } from "./ui/primitives";

type Update = { phase: string; version?: string; error?: string; receivedBytes?: number; totalBytes?: number };

function size(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.floor(bytes / 1024)} KB`;
}

export function DesktopUpdate() {
  const [update, setUpdate] = useState<Update>();
  const [checkedManually, setCheckedManually] = useState(false);
  useEffect(() => {
    if (!isDesktop()) return;
    let active = true;
    const listener = listen<Update>("app-update", ({ payload }) => { if (active) setUpdate(payload); });
    void listener.catch(() => {}).then(() => local<Update>("update_status")).then((status) => {
      if (active) setUpdate(status);
    }).catch((error) => {
      if (active) setUpdate({ phase: "error", error: explain(error) });
    });
    return () => { active = false; void listener.then((unlisten) => unlisten()).catch(() => {}); };
  }, []);

  async function check() {
    setCheckedManually(true);
    setUpdate({ ...update, phase: "checking", error: undefined });
    try {
      setUpdate(await local<Update>("check_update"));
    } catch (error) {
      setUpdate({ ...update, phase: update?.phase ?? "error", error: explain(error) });
    }
  }

  async function act() {
    const install = update?.phase === "ready";
    setUpdate({ phase: install ? "installing" : "downloading", version: update?.version });
    try { setUpdate(await local<Update>(install ? "update_install" : "update_download")); }
    catch (error) { setUpdate({ ...update, phase: install ? "ready" : "available", error: explain(error) }); }
  }

  if (!update) return null;
  const checking = update.phase === "checking";
  const ready = update.phase === "ready";
  const working = ["downloading", "verifying", "installing"].includes(update.phase);
  const received = update.receivedBytes ?? 0;
  const total = update.totalBytes || undefined;
  const percent = total ? Math.min(100, Math.floor(received / total * 100)) : undefined;
  return <div className="flex flex-wrap items-center gap-2">
    <Button variant="secondary" size="sm" disabled={checking || working || ready} onClick={() => void check()}>
      {checking ? "正在检查…" : "检查更新"}
    </Button>
    {(ready || working || update.phase === "available") && <Button variant="primary" size="sm" disabled={working} onClick={() => void act()} title={update.version}>
      {ready ? "安装并重启" : update.phase === "downloading" ? "正在下载…" : update.phase === "verifying" ? "正在校验…" : update.phase === "installing" ? "正在安装…" : "更新"}
    </Button>}
    {update.phase === "downloading" && <div className="grid gap-1 font-mono text-xs text-ink-muted">
      <progress aria-label="更新下载进度" className="h-1.5 w-full min-w-24 accent-gold" value={total ? received : undefined} max={total} />
      <span>{size(received)}{total ? ` / ${size(total)} · ${percent}%` : ""}</span>
    </div>}
    {(update.error || (checkedManually && update.phase === "current")) && (
      <span className="max-w-full text-xs text-ink-muted sm:max-w-sm sm:truncate" role="status" title={update.error}>
        {update.error || "已是最新版本"}
      </span>
    )}
  </div>;
}

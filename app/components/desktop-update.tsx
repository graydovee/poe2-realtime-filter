"use client";

import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { explain, isDesktop, local } from "../../lib/desktop";
import { Button } from "./ui/primitives";

type Update = { phase: string; version?: string; error?: string };

export function DesktopUpdate() {
  const [update, setUpdate] = useState<Update>();
  useEffect(() => {
    if (!isDesktop()) return;
    let active = true;
    const listener = listen<Update>("app-update", ({ payload }) => { if (active) setUpdate(payload); });
    void listener.then(() => local<Update>("update_status")).then((status) => { if (active) setUpdate(status); }).catch(() => {});
    return () => { active = false; void listener.then((unlisten) => unlisten()).catch(() => {}); };
  }, []);

  async function act() {
    const install = update?.phase === "ready";
    setUpdate({ phase: install ? "installing" : "downloading", version: update?.version });
    try { setUpdate(await local<Update>(install ? "update_install" : "update_download")); }
    catch (error) { setUpdate({ ...update, phase: install ? "ready" : "available", error: explain(error) }); }
  }

  if (!update) return null;
  const ready = update.phase === "ready";
  const working = ["downloading", "installing"].includes(update.phase);
  return <div className="flex flex-wrap items-center gap-2">
    {(ready || working || update.phase === "available") && <Button variant="primary" size="sm" disabled={working} onClick={() => void act()} title={update.version}>
      {ready ? "安装并重启" : update.phase === "downloading" ? "正在下载…" : update.phase === "installing" ? "正在安装…" : "更新"}
    </Button>}
    {update.error && <span className="max-w-sm text-xs text-ink-muted" role="status" title={update.error}>
      {update.phase === "error" ? "无法检查更新" : update.error}
    </span>}
  </div>;
}

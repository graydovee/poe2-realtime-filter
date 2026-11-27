"use client";

import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Download, Loader2, RefreshCw } from "lucide-react";

import { explain, isDesktop, local } from "../../lib/desktop";
import { Button } from "./ui/button";
import { ProgressBar } from "./ui/progress";
import { toast } from "./ui/toast";
import { Tooltip } from "./ui/tooltip";

type Update = { phase: string; version?: string; error?: string; receivedBytes?: number; totalBytes?: number };

function size(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.floor(bytes / 1024)} KB`;
}

const CHECK_EVENT = "poe2:check-update";

/** 顶栏里的更新入口：一个检查按钮，有新版本时旁边出现更新按钮。结果通过提示反馈。 */
export function DesktopUpdate() {
  const [update, setUpdate] = useState<Update>();
  useEffect(() => {
    if (!isDesktop()) return;
    let active = true;
    const listener = listen<Update>("app-update", ({ payload }) => { if (active) setUpdate(payload); });
    void listener.catch(() => {}).then(() => local<Update>("update_status")).then((status) => {
      if (active) setUpdate(status);
    }).catch((error) => {
      if (active) setUpdate({ phase: "error", error: explain(error) });
    });
    const onCheck = () => void check();
    window.addEventListener(CHECK_EVENT, onCheck);
    return () => {
      active = false;
      window.removeEventListener(CHECK_EVENT, onCheck);
      void listener.then((unlisten) => unlisten()).catch(() => {});
    };
  }, []);

  async function check() {
    setUpdate((current) => ({ ...current, phase: "checking", error: undefined }));
    try {
      const status = await local<Update>("check_update");
      setUpdate(status);
      if (status.phase === "current") toast.success("已是最新版本");
      else if (status.error) toast.error(status.error);
    } catch (error) {
      setUpdate((current) => ({
        ...current,
        phase: current?.phase === "checking" ? "idle" : (current?.phase ?? "idle"),
        error: explain(error),
      }));
      toast.error(explain(error));
    }
  }

  async function act() {
    const install = update?.phase === "ready";
    setUpdate({ phase: install ? "installing" : "downloading", version: update?.version });
    try {
      setUpdate(await local<Update>(install ? "update_install" : "update_download"));
    } catch (error) {
      setUpdate({ phase: install ? "ready" : "available", version: update?.version, error: explain(error) });
      toast.error(explain(error));
    }
  }

  if (!update) return null;
  const checking = update.phase === "checking";
  const ready = update.phase === "ready";
  const working = ["downloading", "verifying", "installing"].includes(update.phase);
  const available = ready || working || update.phase === "available";
  const received = update.receivedBytes ?? 0;
  const total = update.totalBytes || undefined;

  return (
    <div className="flex items-center gap-1.5">
      {available && (
        <Button variant="primary" size="sm" disabled={working} onClick={() => void act()} title={update.version}>
          {ready ? (
            <>
              <Download aria-hidden="true" />
              安装并重启
            </>
          ) : working ? (
            <>
              <Loader2 className="animate-spin" aria-hidden="true" />
              {update.phase === "downloading" ? "正在下载…" : update.phase === "verifying" ? "正在校验…" : "正在安装…"}
            </>
          ) : (
            <>
              <Download aria-hidden="true" />
              更新{update.version ? ` ${update.version}` : ""}
            </>
          )}
        </Button>
      )}
      {update.phase === "downloading" && (
        <ProgressBar label="更新下载进度" className="h-1 w-20" value={total ? (received / total) * 100 : undefined} />
      )}
      <Tooltip label={ready ? `新版本 ${update.version ?? ""} 已就绪` : working ? "正在更新…" : "检查更新"}>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="检查更新"
          disabled={checking || working || ready}
          onClick={() => void check()}
          className="text-ink-muted"
        >
          {checking || working ? <Loader2 className="animate-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
        </Button>
      </Tooltip>
    </div>
  );
}

"use client";

import { useAppStore, useEditorMarket } from "../../state/store";
import { StatusDot } from "../ui/badge";
import { Kbd } from "../ui/kbd";

function ManagerStatus() {
  const library = useAppStore((state) => state.library);
  if (!library) return <span>正在读取本地方案…</span>;
  const installed = library.schemes.filter((scheme) => scheme.installed).length;
  return (
    <span className="truncate">
      {library.schemes.length} 个方案 · 已安装 {installed} · 刷新间隔 {library.settings.intervalMinutes} 分钟
      {library.settings.paused ? "（已暂停）" : ""}
    </span>
  );
}

function EditorStatus() {
  const { selected } = useEditorMarket();
  const usable = Boolean(selected.rates);
  return (
    <span className="flex min-w-0 items-center gap-2">
      <StatusDot tone={usable ? "sage" : "muted"} />
      <span className="truncate">
        {usable
          ? `行情 ${selected.source} · ${new Date(selected.capturedAt).toLocaleString("zh-CN")}`
          : "暂无可用行情"}
      </span>
    </span>
  );
}

export function StatusBar() {
  const view = useAppStore((state) => state.view);
  return (
    <footer className="flex h-(--status-bar-height) shrink-0 items-center gap-3 border-t border-line bg-bg pr-3 pl-4 text-xs whitespace-nowrap text-ink-faint">
      <div className="min-w-0 flex-1">{view === "editor" ? <EditorStatus /> : <ManagerStatus />}</div>
      {view === "editor" && (
        <div className="hidden shrink-0 items-center gap-4 lg:flex">
          <span className="flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
            切换规则
          </span>
          <span className="flex items-center gap-1">
            <Kbd>Ctrl</Kbd>
            <Kbd>S</Kbd>
            保存
          </span>
          <span className="flex items-center gap-1">
            <Kbd>Ctrl</Kbd>
            <Kbd>Enter</Kbd>
            预览
          </span>
        </div>
      )}
    </footer>
  );
}

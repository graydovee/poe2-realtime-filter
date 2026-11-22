"use client";

import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import { displayDirectory, explain, isDesktop, local, type Library, type LocalScheme } from "../../lib/desktop";
import { Switch, TextInput } from "./ui/controls";
import { ConfirmDialog } from "./ui/confirm-dialog";
import { Badge, Button, Panel } from "./ui/primitives";

type Props = {
  revision: number;
  saveNotice: string;
  busy: boolean;
  onBusy: (busy: boolean) => void;
  onOpen: (scheme: LocalScheme) => void;
  onNew: () => void;
};

type SchemeDialog = { kind: "rename" | "remove" | "uninstall"; scheme: LocalScheme };

export function SchemeManager({ revision, saveNotice, busy, onBusy, onOpen, onNew }: Props) {
  const [library, setLibrary] = useState<Library>();
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [interval, setInterval] = useState<string>();
  const [directory, setDirectory] = useState<string>();
  const [directoryError, setDirectoryError] = useState("");
  const [shareCode, setShareCode] = useState("");
  const [importName, setImportName] = useState("");
  const [shareOutput, setShareOutput] = useState("");
  const [expandedMenu, setExpandedMenu] = useState<string>();
  const [dialog, setDialog] = useState<SchemeDialog>();
  const [renameValue, setRenameValue] = useState("");
  const [removeFile, setRemoveFile] = useState(false);
  const requestVersion = useRef(0);

  const reload = useCallback(async () => {
    const version = ++requestVersion.current;
    try {
      const value = await local<Library>("library");
      if (version === requestVersion.current) setLibrary(value);
    } catch (cause) {
      if (version === requestVersion.current) setError(explain(cause));
    }
  }, []);

  useEffect(() => {
    if (!isDesktop()) return;
    void reload();
    const listener = listen("local-refresh", () => { void reload(); });
    return () => { void listener.then((unlisten) => unlisten()).catch(() => {}); };
  }, [reload]);

  useEffect(() => {
    if (revision === 0) return;
    setFeedback(saveNotice);
    setError("");
    void reload();
  }, [reload, revision, saveNotice]);

  async function run(action: () => Promise<void>) {
    setExpandedMenu(undefined);
    onBusy(true);
    setError("");
    setFeedback("");
    try {
      await action();
    } catch (cause) {
      setError(explain(cause));
    } finally {
      await reload();
      onBusy(false);
    }
  }

  function saveDirectory(path: string | null) {
    void run(async () => {
      setDirectoryError("");
      try {
        await local("save_filter_directory", { directory: path });
        setDirectory(undefined);
        setFeedback(path === null ? "已恢复自动检测的目录" : "过滤器目录已保存");
      } catch (cause) {
        setDirectoryError(explain(cause));
      }
    });
  }

  async function updateSettings(intervalMinutes: number, paused: boolean) {
    await local("save_settings", { intervalMinutes, paused });
    setFeedback("刷新设置已保存");
  }

  function openDialog(kind: SchemeDialog["kind"], scheme: LocalScheme) {
    setExpandedMenu(undefined);
    setError("");
    setRenameValue(scheme.name);
    setRemoveFile(false);
    setDialog({ kind, scheme });
  }

  function confirmAction(action: SchemeDialog) {
    const { kind, scheme } = action;
    void run(async () => {
      if (kind === "rename") {
        await local("scheme_rename", { id: scheme.id, name: renameValue });
        setFeedback("方案已重命名");
      } else if (kind === "uninstall") {
        await local("scheme_uninstall", { id: scheme.id });
        setFeedback("过滤器已卸载，方案已保留");
      } else {
        await local("scheme_remove", { id: scheme.id, removeFile });
        setFeedback(scheme.installed && !removeFile ? "方案已删除，游戏过滤器已保留" : "方案已删除");
      }
      setDialog(undefined);
    });
  }

  function install(scheme: LocalScheme) {
    void run(async () => {
      await local("scheme_install", { id: scheme.id });
      setFeedback(scheme.installed ? `「${scheme.name}」已完成重新生成` : `「${scheme.name}」已安装到游戏目录`);
    });
  }

  const byLeague = new Map<string, LocalScheme[]>();
  for (const scheme of library?.schemes ?? []) {
    const league = scheme.profile.league;
    const group = byLeague.get(league);
    if (group) group.push(scheme);
    else byLeague.set(league, [scheme]);
  }
  const effectiveDirectory = library?.filterDirectory ?? "";
  const directoryValue = directory ?? effectiveDirectory;

  return (
    <div className="grid min-w-0 gap-4">
      <Panel title="导入分享码">
        <form className="grid gap-3" onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            const { missing } = await local<{ missing: string[] }>("scheme_import", { code: shareCode, name: importName.trim() || null });
            setShareCode("");
            setImportName("");
            setFeedback(missing.length
              ? `已导入方案。请打开编辑补齐自定义音效：${missing.join("、")}`
              : "方案已导入到下方列表");
          });
        }}>
          <textarea aria-label="分享码" className="min-h-24 w-full rounded border border-line bg-surface-2 px-3 py-2 font-mono text-sm text-ink placeholder:text-ink-muted" placeholder="粘贴 POE2F1. 开头的分享码" value={shareCode} maxLength={1404096} onChange={(event) => setShareCode(event.target.value)} />
          <div className="flex flex-wrap items-end gap-2">
            <label className="max-w-full text-xs text-ink-muted">导入名称
              <TextInput className="mt-1 w-64 max-w-full" placeholder="默认使用分享码中的名称" value={importName} maxLength={80} onChange={(event) => setImportName(event.target.value)} />
            </label>
            <Button type="submit" size="sm" variant="primary" disabled={busy || !library || !shareCode.trim()}>导入方案</Button>
          </div>
        </form>
      </Panel>

      <div aria-live="polite" className="empty:hidden">
        {error && !dialog ? <p className="rounded border border-ember/45 bg-surface px-4 py-3 text-sm text-ember" role="alert">{error}</p>
          : feedback && <p className="rounded border border-line bg-surface px-4 py-3 text-sm text-ink" role="status">{feedback}</p>}
      </div>

      <Panel title="我的方案" action={<Button size="sm" variant="primary" disabled={busy || !library} onClick={onNew}>新建方案</Button>}>
        {!library && !error && <p className="text-sm text-ink-muted">正在读取本地方案…</p>}
        {library && !library.schemes.length && <p className="text-sm text-ink-muted">新建方案，或粘贴分享码导入。</p>}
        {shareOutput && (
          <div className="mb-4 grid gap-2">
            <label className="text-sm text-ink">手动复制分享码
              <textarea className="mt-1 min-h-24 w-full rounded border border-line bg-surface-2 px-3 py-2 font-mono text-sm" value={shareOutput} readOnly onFocus={(event) => event.currentTarget.select()} />
            </label>
            <Button className="justify-self-start" size="sm" onClick={() => setShareOutput("")}>收起分享码</Button>
          </div>
        )}
        {[...byLeague].map(([league, schemes]) => (
          <section key={league} className="mb-5 last:mb-0" aria-label={league}>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-ink">{league}</h3>
              <Button size="sm" disabled={busy} onClick={() => void run(async () => {
                await local("refresh_market", { league });
                setFeedback(`${league} 行情已刷新。过滤器更新结果见方案状态。`);
              })}>刷新行情</Button>
            </div>
            <ul className="grid gap-2">
              {schemes.map((scheme) => (
                <li key={scheme.id} className="grid min-w-0 gap-3 rounded border border-line bg-surface-2 p-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="min-w-0 break-words text-sm text-ink">{scheme.name}</strong>
                      <Badge tone={scheme.installed ? "sage" : "muted"}>{scheme.installed ? "已安装" : "未安装"}</Badge>
                    </div>
                    {scheme.installed && <p className="mt-1 truncate text-xs text-ink-muted" title={displayDirectory(scheme.installed.directory)}>{displayDirectory(scheme.installed.directory)}</p>}
                    {scheme.status && <p className="mt-1 break-words text-xs text-ink-muted">{scheme.status}</p>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {scheme.installed && <Switch label="自动刷新" checked={scheme.autoRefresh} disabled={busy} onCheckedChange={(enabled) => {
                      void run(() => local("scheme_auto", { id: scheme.id, enabled }));
                    }} />}
                    <Button size="sm" disabled={busy} onClick={() => onOpen(scheme)}>编辑</Button>
                    {scheme.installed
                      ? <Button size="sm" disabled={busy} onClick={() => openDialog("uninstall", scheme)}>卸载过滤器</Button>
                      : <Button size="sm" variant="primary" disabled={busy} onClick={() => install(scheme)}>安装到游戏</Button>}
                    <div className="relative" onBlur={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget)) setExpandedMenu(undefined);
                    }} onKeyDown={(event) => {
                      if (event.key === "Escape" && expandedMenu === scheme.id) {
                        event.preventDefault();
                        event.currentTarget.querySelector("button")?.focus();
                        setExpandedMenu(undefined);
                      }
                    }}>
                      <Button size="sm" variant="ghost" disabled={busy} aria-expanded={expandedMenu === scheme.id} onClick={() => setExpandedMenu(expandedMenu === scheme.id ? undefined : scheme.id)}>更多</Button>
                      {expandedMenu === scheme.id && (
                        <div className="absolute right-0 top-full z-20 mt-1 grid w-32 rounded border border-line-strong bg-surface-2 p-1 shadow-panel">
                          <Button size="sm" variant="ghost" onClick={() => openDialog("rename", scheme)}>重命名</Button>
                          <Button size="sm" variant="ghost" onClick={() => void run(async () => {
                            const downloaded = await local<boolean>("scheme_download", { id: scheme.id });
                            if (downloaded) setFeedback(`「${scheme.name}」ZIP 已保存`);
                          })}>下载</Button>
                          <Button size="sm" variant="ghost" onClick={() => void run(async () => {
                            const code = await local<string>("scheme_share", { id: scheme.id });
                            try {
                              await navigator.clipboard.writeText(code);
                              setShareOutput("");
                              setFeedback("分享码已复制");
                            } catch {
                              setShareOutput(code);
                            }
                          })}>分享码</Button>
                          <Button size="sm" variant="ghost" onClick={() => void run(async () => {
                            await local("scheme_copy", { id: scheme.id });
                            setFeedback("方案已复制");
                          })}>复制</Button>
                          {scheme.installed && <Button size="sm" variant="ghost" onClick={() => install(scheme)}>重新生成</Button>}
                          <Button size="sm" variant="ghost" className="text-ember" onClick={() => openDialog("remove", scheme)}>删除</Button>
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </Panel>

      <Panel title="过滤器目录" description="此设置用于新安装。已安装方案继续使用各自的原目录。">
        <form className="flex min-w-0 flex-wrap items-end gap-2" onSubmit={(event) => {
          event.preventDefault();
          saveDirectory(directoryValue);
        }}>
          <label className="min-w-[min(100%,18rem)] flex-1 text-xs text-ink-muted">新安装目录
            <TextInput className="mt-1" value={directoryValue} disabled={!library || busy} aria-invalid={Boolean(directoryError)} aria-describedby={directoryError ? "filter-directory-error" : undefined} onChange={(event) => { setDirectory(event.target.value); setDirectoryError(""); }} />
          </label>
          <Button size="sm" disabled={!library || busy} onClick={() => void run(async () => {
            const picked = await local<string | null>("pick_filter_directory", { current: directoryValue });
            if (picked) { setDirectory(picked); setDirectoryError(""); }
          })}>浏览</Button>
          <Button type="submit" size="sm" variant="primary" disabled={!library || busy || !directoryValue.trim() || directoryValue === effectiveDirectory}>保存目录</Button>
          <Button size="sm" disabled={busy || !library || (!library.settings.filterDirectory && directory === undefined)} onClick={() => saveDirectory(null)}>恢复默认</Button>
        </form>
        {directoryError && <p id="filter-directory-error" role="alert" className="mt-3 break-words text-sm text-ember">{directoryError}</p>}
      </Panel>

      <Panel title="刷新设置" description="托盘会定时更新已安装且开启自动刷新的方案。刷新行情也会更新同赛季开启自动刷新的方案。">
        <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => {
          event.preventDefault();
          if (library) void run(async () => {
            await updateSettings(Number(interval ?? library.settings.intervalMinutes), library.settings.paused);
            setInterval(undefined);
          });
        }}>
          <label className="text-xs text-ink-muted">刷新间隔（分钟）
            <TextInput className="mt-1 w-28" type="number" min="1" max="1440" required disabled={!library || busy} value={interval ?? library?.settings.intervalMinutes ?? ""} onChange={(event) => setInterval(event.target.value)} />
          </label>
          <Button type="submit" size="sm" disabled={!library || busy}>应用间隔</Button>
          <Switch label="暂停后台刷新" checked={library?.settings.paused ?? false} disabled={!library || busy} onCheckedChange={(paused) => {
            if (library) void run(() => updateSettings(library.settings.intervalMinutes, paused));
          }} />
        </form>
      </Panel>

      {dialog && (
        <ConfirmDialog
          title={dialog.kind === "rename" ? "重命名方案" : dialog.kind === "uninstall" ? `卸载「${dialog.scheme.name}」的过滤器？` : `删除「${dialog.scheme.name}」？`}
          busy={busy}
          onCancel={() => setDialog(undefined)}
        >
          <form onSubmit={(event) => { event.preventDefault(); if (!busy) confirmAction(dialog); }}>
            {dialog.kind === "rename" && <label className="text-sm text-ink">方案名称
              <TextInput className="mt-1" required maxLength={80} value={renameValue} disabled={busy} onChange={(event) => setRenameValue(event.target.value)} />
            </label>}
            {dialog.kind === "uninstall" && <p>卸载后可在方案列表里重新安装。</p>}
            {dialog.kind === "remove" && dialog.scheme.installed && <Switch label="同时删除游戏里的过滤器文件" checked={removeFile} disabled={busy} onCheckedChange={setRemoveFile} />}
            {error && <div role="alert" className="mt-2 text-sm text-ember">{error}</div>}
            <div className="modal-actions">
              <Button size="sm" disabled={busy} onClick={() => setDialog(undefined)}>取消</Button>
              <Button type="submit" size="sm" variant={dialog.kind === "rename" ? "primary" : "danger"} disabled={busy || (dialog.kind === "rename" && !renameValue.trim())}>
                {dialog.kind === "rename" ? "保存名称" : dialog.kind === "uninstall" ? "确认卸载" : "确认删除"}
              </Button>
            </div>
          </form>
        </ConfirmDialog>
      )}
    </div>
  );
}

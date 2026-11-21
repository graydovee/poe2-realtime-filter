"use client";

import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import { explain, isDesktop, local, type Library, type LocalScheme, type Settings } from "../../lib/desktop";
import { TextInput } from "./ui/controls";
import { ConfirmDialog } from "./ui/confirm-dialog";
import { Badge, Button, Panel } from "./ui/primitives";

type Props = {
  revision: number;
  busy: boolean;
  onBusy: (busy: boolean) => void;
  onOpen: (scheme: LocalScheme) => void;
  onNew: () => void;
  onRemove: (id: string) => void;
};

export function SchemeManager({ revision, busy, onBusy, onOpen, onNew, onRemove }: Props) {
  const [library, setLibrary] = useState<Library>();
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [interval, setInterval] = useState<string>();
  const [shareCode, setShareCode] = useState("");
  const [importName, setImportName] = useState("");
  const [shareOutput, setShareOutput] = useState("");
  const [remove, setRemove] = useState<LocalScheme>();
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
    if (isDesktop()) void reload();
  }, [reload, revision]);

  useEffect(() => {
    if (!isDesktop()) return;
    const listener = listen("local-refresh", () => { void reload(); });
    return () => { void listener.then((unlisten) => unlisten()).catch(() => {}); };
  }, [reload]);

  async function run(action: () => Promise<void>) {
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

  async function updateSettings(settings: Settings) {
    await local("save_settings", { settings });
    setInterval(undefined);
    setFeedback("刷新设置已保存");
  }

  const byLeague = new Map<string, LocalScheme[]>();
  for (const scheme of library?.schemes ?? []) {
    const league = scheme.profile.league;
    const group = byLeague.get(league);
    if (group) group.push(scheme);
    else byLeague.set(league, [scheme]);
  }

  return (
    <div className="grid min-w-0 gap-4">
      <Panel title="导入分享码" description="导入后可直接安装到游戏，也可以打开方案修改规则。">
        <form className="grid gap-3" onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            const { missing } = await local<{ id: string; missing: string[] }>("scheme_import", { code: shareCode, name: importName.trim() || null });
            setShareCode("");
            setImportName("");
            setFeedback(missing.length
              ? `已导入方案。请打开编辑补齐自定义音效：${missing.join("、")}`
              : "方案已导入到下方列表");
          });
        }}>
          <textarea aria-label="分享码" className="min-h-24 w-full rounded border border-line bg-surface-2 px-3 py-2 font-mono text-sm text-ink placeholder:text-ink-muted" placeholder="粘贴 POE2F1. 开头的分享码" value={shareCode} maxLength={1400000} onChange={(event) => setShareCode(event.target.value)} />
          <div className="flex flex-wrap items-end gap-2">
            <label className="max-w-full text-xs text-ink-muted">导入名称（可选）
              <TextInput className="mt-1 w-64 max-w-full" placeholder="留空使用原名称" value={importName} maxLength={80} onChange={(event) => setImportName(event.target.value)} />
            </label>
            <Button type="submit" size="sm" variant="primary" disabled={busy || !library || !shareCode.trim()}>导入方案</Button>
          </div>
        </form>
      </Panel>

      <div aria-live="polite" className="empty:hidden">
        {error ? <p className="rounded border border-ember/45 bg-surface px-4 py-3 text-sm text-ember" role="alert">{error}</p>
          : feedback && <p className="rounded border border-line bg-surface px-4 py-3 text-sm text-ink" role="status">{feedback}</p>}
      </div>

      <Panel title="我的方案" action={<Button size="sm" disabled={busy} onClick={onNew}>新建方案</Button>}>
        {!library && !error && <p className="text-sm text-ink-muted">正在读取本地方案…</p>}
        {library && !library.schemes.length && <p className="text-sm text-ink-muted">还没有方案。可以导入分享码，或在制作页新建方案。</p>}
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
                <li key={scheme.id} className="grid min-w-0 gap-3 rounded border border-line bg-surface-2 p-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="min-w-0 break-words text-sm text-ink">{scheme.name}</strong>
                      <Badge tone={scheme.installed ? "sage" : "muted"}>{scheme.installed ? "已安装" : "未安装"}</Badge>
                    </div>
                    {scheme.status && <p className="mt-1 break-words text-xs text-ink-muted">{scheme.status}</p>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {scheme.installed && <label className="mr-1 flex items-center gap-1.5 text-xs text-ink">
                      <input type="checkbox" checked={scheme.autoRefresh} disabled={busy} onChange={(event) => {
                        const enabled = event.target.checked;
                        void run(() => local("scheme_auto", { id: scheme.id, enabled }));
                      }} />自动刷新
                    </label>}
                    <Button size="sm" variant={scheme.installed ? "secondary" : "primary"} disabled={busy} onClick={() => void run(async () => {
                      await local("scheme_install", { id: scheme.id });
                      setFeedback(scheme.installed ? `「${scheme.name}」已完成重新生成` : `「${scheme.name}」已安装到游戏目录`);
                    })}>{scheme.installed ? "重新生成" : "安装到游戏"}</Button>
                    <Button size="sm" disabled={busy} onClick={() => onOpen(scheme)}>打开编辑</Button>
                    <Button size="sm" disabled={busy} onClick={() => void run(async () => {
                      const code = await local<string>("scheme_share", { id: scheme.id });
                      try {
                        await navigator.clipboard.writeText(code);
                        setShareOutput("");
                        setFeedback("分享码已复制");
                      } catch {
                        setShareOutput(code);
                      }
                    })}>分享码</Button>
                    <Button size="sm" disabled={busy} onClick={() => void run(async () => {
                      await local("scheme_copy", { id: scheme.id });
                      setFeedback("方案已复制");
                    })}>复制</Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setRemove(scheme); setRemoveFile(false); }}>删除</Button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </Panel>

      <Panel title="刷新设置" description="托盘会定时更新已安装且开启自动刷新的方案。刷新行情也会更新同赛季开启自动刷新的方案。">
        <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => {
          event.preventDefault();
          if (library) void run(() => updateSettings({ ...library.settings, intervalMinutes: Number(interval ?? library.settings.intervalMinutes) }));
        }}>
          <label className="text-xs text-ink-muted">刷新间隔（分钟）
            <TextInput className="mt-1 w-28" type="number" min="1" max="1440" required disabled={!library || busy} value={interval ?? library?.settings.intervalMinutes ?? ""} onChange={(event) => setInterval(event.target.value)} />
          </label>
          <Button type="submit" size="sm" disabled={!library || busy}>应用间隔</Button>
          <label className="flex min-h-9 items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={library?.settings.paused ?? false} disabled={!library || busy} onChange={(event) => {
              const paused = event.target.checked;
              if (library) void run(() => updateSettings({ ...library.settings, paused }));
            }} />暂停后台刷新
          </label>
        </form>
      </Panel>

      {remove && <ConfirmDialog title={`删除「${remove.name}」？`} busy={busy} onCancel={() => setRemove(undefined)}>
        {remove.installed && <label className="flex items-center gap-2">
          <input type="checkbox" checked={removeFile} disabled={busy} onChange={(event) => setRemoveFile(event.target.checked)} />同时删除游戏里的过滤器文件
        </label>}
        <div className="modal-actions">
          <Button size="sm" disabled={busy} onClick={() => setRemove(undefined)}>取消</Button>
          <Button size="sm" variant="danger" disabled={busy} onClick={() => void run(async () => {
            await local("scheme_remove", { id: remove.id, removeFile });
            onRemove(remove.id);
            setRemove(undefined);
            setFeedback(remove.installed && !removeFile ? "方案已删除，游戏过滤器已保留" : "方案已删除");
          })}>确认删除</Button>
        </div>
        {error && <p className="mt-2 text-sm text-ember">{error}</p>}
      </ConfirmDialog>}
    </div>
  );
}

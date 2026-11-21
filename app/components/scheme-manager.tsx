"use client";

import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { explain, fileToBase64, isDesktop, local, readSound, type Library, type LocalScheme } from "../../lib/desktop";
import type { FilterProfile } from "../../lib/types";
import { TextInput } from "./ui/controls";
import { Button, Panel } from "./ui/primitives";

type Props = {
  profile: FilterProfile;
  sounds: Record<string, File>;
  onOpen: (profile: FilterProfile, sounds: Record<string, File>, id: string | null) => void;
  onRefresh: () => Promise<void>;
  onNew: () => void;
};

export function SchemeManager({ profile, sounds, onOpen, onRefresh, onNew }: Props) {
  const [library, setLibrary] = useState<Library>();
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [interval, setIntervalValue] = useState("30");
  const [shareCode, setShareCode] = useState("");
  const [importName, setImportName] = useState("");
  const [openShare, setOpenShare] = useState(false);
  const [remove, setRemove] = useState<LocalScheme>();
  const [removeFile, setRemoveFile] = useState(false);

  useEffect(() => {
    if (!isDesktop()) return;
    let active = true;
    const update = () => local<Library>("library").then((value) => { if (active) setLibrary(value); });
    void update().then(() => local<Library>("library")).then((value) => { if (active) setIntervalValue(String(value.settings.intervalMinutes)); }).catch((error) => { if (active) setFeedback(explain(error)); });
    const listener = listen("local-refresh", () => { void update().catch(() => {}); });
    return () => { active = false; void listener.then((unlisten) => unlisten()).catch(() => {}); };
  }, []);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setFeedback("");
    try { await action(); }
    catch (error) { setFeedback(explain(error)); }
    finally {
      try { setLibrary(await local<Library>("library")); }
      catch (error) { setFeedback(explain(error)); }
      setBusy(false);
    }
  }

  async function open(scheme: LocalScheme) {
    const cached = new Map<string, Promise<File>>();
    const files = await Promise.all(scheme.profile.rules.map(async (rule) => {
      const sound = rule.effects.sound;
      if (sound?.type !== "custom") return undefined;
      if (!cached.has(sound.fileName)) cached.set(sound.fileName, readSound(sound.fileName, scheme.id, true));
      try { return [rule.id, await cached.get(sound.fileName)!] as const; }
      catch { return undefined; }
    }));
    setEditing(scheme.id);
    setName(scheme.name);
    onOpen(scheme.profile, Object.fromEntries(files.filter((file) => file !== undefined)), scheme.id);
  }

  async function save(asNew = false) {
    const uploads: Record<string, string> = {};
    let bytes = 0;
    for (const rule of profile.rules) {
      const sound = rule.effects.sound;
      const file = sounds[rule.id];
      if (sound?.type !== "custom" || !file || uploads[sound.fileName] !== undefined) continue;
      bytes += file.size;
      if (bytes > 32 * 1024 * 1024) throw new Error("音效合计最多 32 MB");
      uploads[sound.fileName] = await fileToBase64(file);
    }
    const id = await local<string>("scheme_save", { edit: { id: asNew ? null : editing, name, profile, sounds: uploads } });
    const saved = (await local<Library>("library")).schemes.find((item) => item.id === id);
    setEditing(id);
    if (saved) { setName(saved.name); onOpen(saved.profile, sounds, id); }
    setFeedback("方案已保存");
    return id;
  }

  return <Panel>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-sm font-semibold text-ink">本地方案</h2>
      <Button size="sm" disabled={busy} onClick={() => { setEditing(null); setName(""); setFeedback(""); onNew(); }}>新建方案</Button>
    </div>
    <form className="my-3 flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); void run(async () => { await save(); }); }}>
      <label className="min-w-48 text-xs text-ink-muted">{editing ? "方案名称（可改名）" : "新方案名称"}
        <TextInput className="mt-1" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
      </label>
      <Button type="submit" size="sm" variant="primary" disabled={busy || !library || !name.trim()}>保存方案</Button>
      {editing && <Button type="button" size="sm" disabled={busy || !name.trim()} onClick={() => void run(async () => { await save(true); })}>另存为</Button>}
      <Button type="button" size="sm" disabled={busy || !library || !name.trim()} onClick={() => void run(async () => {
        const id = await save();
        await local("scheme_install", { id });
        setFeedback("过滤器已保存到游戏目录");
      })}>保存并安装到游戏</Button>
      <Button type="button" size="sm" disabled={!library} aria-expanded={openShare} onClick={() => setOpenShare(!openShare)}>导入分享码</Button>
    </form>
    {openShare && <form className="my-3 grid gap-2 rounded border border-line p-3" onSubmit={(event) => {
      event.preventDefault();
      void run(async () => {
        const result = await local<{ id: string; missing: string[] }>("scheme_import", { code: shareCode, name: importName.trim() || null });
        const imported = (await local<Library>("library")).schemes.find((item) => item.id === result.id);
        if (imported) await open(imported);
        setFeedback(result.missing.length ? `已导入。请在规则中补齐音效：${result.missing.join("、")}` : "已导入方案");
        setShareCode("");
        setImportName("");
        setOpenShare(false);
      });
    }}>
      <textarea aria-label="分享码" className="min-h-24 rounded border border-line bg-surface px-3 py-2 font-mono text-sm" placeholder="粘贴 POE2F1. 开头的分享码" value={shareCode} maxLength={1400000} onChange={(event) => setShareCode(event.target.value)} />
      <div className="flex flex-wrap gap-2">
        <TextInput aria-label="导入名称" className="max-w-xs" placeholder="可选：指定新名称" value={importName} maxLength={80} onChange={(event) => setImportName(event.target.value)} />
        <Button type="submit" size="sm" disabled={busy || !shareCode.trim()}>导入</Button>
      </div>
    </form>}
    <ul className="grid gap-2">
      {library?.schemes.map((scheme) => <li key={scheme.id} className="flex flex-wrap justify-between gap-2 rounded border border-line bg-surface px-3 py-2">
        <div className="min-w-0">
          <strong className="block break-words text-sm text-ink">{scheme.name}</strong>
          <span className="break-words text-xs text-ink-muted">{scheme.profile.league} · {scheme.installed ? (scheme.status || "已安装") : (scheme.status || "未安装")}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {scheme.installed && <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={scheme.autoRefresh} disabled={busy} onChange={(event) => {
            const enabled = event.target.checked;
            void run(() => local("scheme_auto", { id: scheme.id, enabled }));
          }} />自动刷新</label>}
          <Button size="sm" disabled={busy} onClick={() => void run(() => open(scheme))}>编辑</Button>
          <Button size="sm" disabled={busy} onClick={() => void run(async () => { await local("scheme_copy", { id: scheme.id }); setFeedback("已复制方案"); })}>复制</Button>
          <Button size="sm" disabled={busy} onClick={() => void run(async () => {
            const code = await local<string>("scheme_share", { id: scheme.id });
            try { await navigator.clipboard.writeText(code); setFeedback("分享码已复制"); }
            catch { setShareCode(code); setOpenShare(true); setFeedback("请手动复制分享码"); }
          })}>分享码</Button>
          <Button size="sm" disabled={busy} onClick={() => { setRemove(scheme); setRemoveFile(false); }}>删除</Button>
        </div>
      </li>)}
    </ul>
    {remove && <div className="modal-backdrop" role="presentation"><div className="modal-card" role="dialog" aria-modal="true" aria-label="删除方案">
      <h3>删除「{remove.name}」？</h3>
      {remove.installed && <label className="flex items-center gap-2"><input type="checkbox" checked={removeFile} onChange={(event) => setRemoveFile(event.target.checked)} />同时删除游戏里的过滤器文件</label>}
      <div className="modal-actions"><Button size="sm" onClick={() => setRemove(undefined)}>取消</Button><Button size="sm" disabled={busy} onClick={() => void run(async () => {
        await local("scheme_remove", { id: remove.id, removeFile });
        if (editing === remove.id) { setEditing(null); setName(""); onNew(); }
        setRemove(undefined);
        setFeedback("方案已删除");
      })}>确认删除</Button></div>
    </div></div>}
    {feedback && <p role="status" className="my-2 text-sm text-ink">{feedback}</p>}
    <form className="mt-3 flex flex-wrap items-end gap-3 border-t border-line pt-3" onSubmit={(event) => {
      event.preventDefault();
      if (!library) return;
      void run(() => local("save_settings", { settings: { ...library.settings, intervalMinutes: Number(interval) } }));
    }}>
      <label className="text-xs text-ink-muted">刷新间隔（分钟）<TextInput className="mt-1 w-28" type="number" min="1" max="1440" value={interval} onChange={(event) => setIntervalValue(event.target.value)} /></label>
      <Button type="submit" size="sm" disabled={!library || busy}>应用间隔</Button>
      <label className="flex items-center gap-2 py-1 text-sm"><input type="checkbox" checked={library?.settings.paused ?? false} disabled={!library || busy} onChange={(event) => {
        const paused = event.target.checked;
        if (library) void run(() => local("save_settings", { settings: { ...library.settings, paused } }));
      }} />暂停后台刷新</label>
      <Button type="button" size="sm" disabled={!library || busy} onClick={() => void run(async () => { await onRefresh(); setFeedback("行情已刷新"); })}>刷新当前赛季</Button>
    </form>
  </Panel>;
}

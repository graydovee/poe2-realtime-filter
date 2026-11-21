"use client";

import { useCallback, useEffect, useState } from "react";
import type { FilterProfile, LeagueCatalog } from "../../lib/types";
import { SchemeSaveControls } from "./scheme-save-controls";

type Scheme = { id: string; name: string; profile: FilterProfile; version: number; updatedAt: string; subscriptionEnabled: boolean; subscriberCount: number };
type EditingScheme = Pick<Scheme, "id" | "name" | "version">;
type Modal = { title: string; message: string; confirmLabel: string; danger?: boolean; action: () => Promise<void> };

export function SchemeManager({ profile, sounds, leagueCatalog, onOpen }: { profile: FilterProfile; sounds: Record<string, File>; leagueCatalog: LeagueCatalog | null; onOpen: (p: FilterProfile, sounds: Record<string, File>) => void }) {
  const [account, setAccount] = useState<{ name: string } | null>(null);
  const [configured, setConfigured] = useState(true);
  const [items, setItems] = useState<Scheme[]>([]);
  const [editing, setEditing] = useState<EditingScheme | null>(null);
  const [saveFeedback, setSaveFeedback] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [link, setLink] = useState("");
  const [filterLeague, setFilterLeague] = useState("all");
  const [importUrl, setImportUrl] = useState("");
  const [menuId, setMenuId] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const call = async (url: string, init?: RequestInit) => {
    const response = await fetch(url, init);
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload) throw new Error(payload?.error || `请求失败（HTTP ${response.status}）`);
    return payload;
  };

  const refresh = useCallback(async () => {
    const response = await fetch("/api/auth/session");
    const session = await response.json();
    setAccount(session.user);
    setConfigured(session.configured);
    if (!session.user) { setItems([]); setEditing(null); return; }
    const profiles = await fetch("/api/profiles");
    if (profiles.ok) setItems((await profiles.json()).profiles);
  }, []);

  useEffect(() => { void refresh().catch(() => setMessage("无法读取账号状态")); }, [refresh]);

  async function run(work: () => Promise<void>) {
    setBusy(true); setMessage(""); setMenuId(null);
    try { await work(); await refresh(); } catch (error) { setMessage(error instanceof Error ? error.message : "请求失败"); }
    finally { setBusy(false); }
  }

  async function open(id: string) {
    const item: Scheme = await call(`/api/profiles/${id}`, { cache: "no-store" });
    const files: Record<string, File> = {};
    for (const rule of item.profile.rules ?? []) if (rule.effects.sound?.type === "custom") {
      const response = await fetch(`/api/profiles/${item.id}/sounds/${encodeURIComponent(rule.effects.sound.fileName)}`);
      if (!response.ok) throw new Error("音效读取失败");
      files[rule.id] = new File([await response.blob()], rule.effects.sound.fileName);
    }
    setEditing({ id: item.id, name: item.name, version: item.version });
    setSaveFeedback(null);
    onOpen(item.profile, files);
    setLink("");
    setMessage(item.profile.originalLeague && item.profile.originalLeague !== item.profile.league ? `原始赛季 ${item.profile.originalLeague} 已结束，当前使用 ${item.profile.league}。` : "已打开方案，可在配置页切换赛季。");
  }

  async function save(name?: string) {
    if (busy) return false;
    const target = name === undefined ? editing : null;
    if (!target && !name) return false;
    setBusy(true);
    setMenuId(null);
    setSaveFeedback({ text: "正在保存…" });
    try {
      const form = new FormData();
      form.set("profile", JSON.stringify(profile));
      if (target) form.set("version", String(target.version));
      else if (name) form.set("name", name);
      for (const rule of profile.rules) {
        const file = sounds[rule.id];
        const sound = rule.effects.sound;
        if (file && sound?.type === "custom" && file.name.replace(/[^a-zA-Z0-9._-]/g, "_") === sound.fileName) {
          form.set(`sound:${rule.id}`, file);
        }
      }
      const saved: Scheme = await call(target ? `/api/profiles/${target.id}` : "/api/profiles", {
        method: target ? "PUT" : "POST",
        body: form,
      });
      setEditing({ id: saved.id, name: saved.name, version: saved.version });
      setItems((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
      setSaveFeedback({ text: `已保存「${saved.name}」。` });
      return true;
    } catch (error) {
      setSaveFeedback({ text: error instanceof Error ? error.message : "保存失败", error: true });
      return false;
    } finally {
      setBusy(false);
    }
  }

  function ask(modalValue: Modal) { setMenuId(null); setModal(modalValue); }
  function startRename(item: Scheme) { setRenameId(item.id); setRenameValue(item.name); setMenuId(null); }
  const visibleItems = items.filter((item) => filterLeague === "all" || item.profile.league === filterLeague || item.profile.originalLeague === filterLeague);
  const leagueLabel = (id: string) => leagueCatalog?.leagues.find((league) => league.id === id)?.label || id;
  const filterOptions = [...new Set([...((leagueCatalog?.leagues || []).map((league) => league.id)), ...items.map((item) => item.profile.originalLeague || item.profile.league)])];

  return <><section className="panel schemes-panel">
    <div className="scheme-heading"><div><h2>我的方案</h2><p>{account ? account.name : "未登录的修改只在当前页面保留，关闭后不保存。"}</p></div>{account ? <button disabled={busy} onClick={() => void run(async () => { await call("/api/auth/logout", { method: "POST" }); setAccount(null); setItems([]); setEditing(null); setSaveFeedback(null); setLink(""); })}>退出登录</button> : configured ? <a href="/api/auth/login">登录管理方案</a> : <button disabled title="Casdoor OIDC 尚未配置">登录管理方案（待配置）</button>}</div>
    {!configured && !account && <p className="field-help">账号登录正在配置中，仍可生成和下载过滤器。</p>}
    {account && <>
      <div className="scheme-import-row"><label>导入订阅链接<input value={importUrl} onChange={(event) => setImportUrl(event.target.value)} placeholder="粘贴 poe2-filter 订阅链接" /></label><button className="secondary-button" disabled={busy || !importUrl.trim()} onClick={() => void run(async () => { const item = await call("/api/profiles/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: importUrl }) }); setImportUrl(""); setMessage(`已导入方案“${item.name}”。`); })}>导入方案</button></div>
      <div className="scheme-toolbar"><span>已保存方案</span><label>按赛季筛选<select value={filterLeague} onChange={(event) => setFilterLeague(event.target.value)}><option value="all">全部赛季</option>{filterOptions.map((id) => <option key={id} value={id}>{leagueCatalog?.leagues.some((league) => league.id === id) ? leagueLabel(id) : `${id}（已结束）`}</option>)}</select></label></div>
      <div className="scheme-list">{visibleItems.length === 0 ? <p>{items.length ? "当前赛季没有方案。" : "还没有保存的方案。"}</p> : visibleItems.map((item) => <div key={item.id} className="scheme-row"><div><strong>{item.name}</strong><small>{item.profile.originalLeague && item.profile.originalLeague !== item.profile.league ? `${leagueLabel(item.profile.originalLeague)} → ${leagueLabel(item.profile.league)}` : leagueLabel(item.profile.league)} · {new Date(item.updatedAt).toLocaleString("zh-CN")} · 累计订阅设备 {item.subscriberCount ?? 0} 台</small></div><div className="scheme-row-actions"><button disabled={busy} onClick={() => void run(() => open(item.id))}>打开编辑</button><button disabled={busy} onClick={() => void run(async () => { let key = await call(`/api/profiles/${item.id}/subscription`); if (!key.enabled) key = await call(`/api/profiles/${item.id}/subscription`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "create" }) }); setLink(`${location.origin}/sync/${item.id}#key=${key.key}`); setMessage("订阅链接已生成。"); })}>订阅链接</button><div className="more-menu"><button aria-expanded={menuId === item.id} disabled={busy} onClick={() => setMenuId(menuId === item.id ? null : item.id)}>更多</button>{menuId === item.id && <div className="more-menu-popover" role="menu"><button role="menuitem" onClick={() => void run(async () => { await call(`/api/profiles/${item.id}/copy`, { method: "POST" }); setMessage("方案已复制。"); })}>复制方案</button><button role="menuitem" onClick={() => startRename(item)}>重命名</button>{item.subscriptionEnabled && <><button role="menuitem" onClick={() => ask({ title: "停用订阅", message: "停用后客户端会停止更新，但已安装文件会保留。", confirmLabel: "停用", action: async () => { await call(`/api/profiles/${item.id}/subscription`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "disable" }) }); setLink(""); } })}>停用订阅</button><button role="menuitem" onClick={() => ask({ title: "重置订阅密钥", message: "重置后现有客户端链接会立即失效，需要重新添加。", confirmLabel: "重置", action: async () => { const key = await call(`/api/profiles/${item.id}/subscription`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "reset" }) }); setLink(`${location.origin}/sync/${item.id}#key=${key.key}`); } })}>重置密钥</button></>}<button role="menuitem" onClick={() => ask({ title: "删除方案", message: "删除后客户端会停止更新，但已安装文件会保留。", confirmLabel: "删除", danger: true, action: async () => { await call(`/api/profiles/${item.id}`, { method: "DELETE" }); if (editing?.id === item.id) { setEditing(null); setSaveFeedback(null); } setLink(""); } })}>删除方案</button></div>}</div></div></div>)}</div>
      {link && <div className="sync-link"><label>只读订阅链接<input readOnly value={link} onFocus={(event) => event.target.select()} /></label><button onClick={() => void navigator.clipboard.writeText(link).then(() => setMessage("订阅链接已复制。")).catch(() => setMessage("请手动复制链接。"))}>复制链接</button><p>在 Windows 客户端中添加此链接，即可定时更新。</p></div>}
    </>}
    {message && <p role="status" className="field-help">{message}</p>}
    {renameId && <div className="modal-backdrop" role="presentation"><div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="rename-title"><h3 id="rename-title">重命名方案</h3><label>方案名称<input autoFocus maxLength={80} value={renameValue} onChange={(event) => setRenameValue(event.target.value)} /></label><div className="modal-actions"><button onClick={() => setRenameId(null)}>取消</button><button disabled={!renameValue.trim() || busy} onClick={() => void run(async () => { await call(`/api/profiles/${renameId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: renameValue }) }); setRenameId(null); setMessage("方案已重命名。"); })}>保存</button></div></div></div>}
    {modal && <div className="modal-backdrop" role="presentation"><div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="confirm-title"><h3 id="confirm-title">{modal.title}</h3><p>{modal.message}</p><div className="modal-actions"><button onClick={() => setModal(null)}>取消</button><button className={modal.danger ? "danger-button" : ""} disabled={busy} onClick={() => void run(async () => { await modal.action(); setModal(null); })}>{modal.confirmLabel}</button></div></div></div>}
  </section>
    {account && <SchemeSaveControls
      key={editing?.id ?? "draft"}
      schemeName={editing ? items.find((item) => item.id === editing.id)?.name ?? editing.name : null}
      busy={busy}
      feedback={saveFeedback}
      onSave={() => save()}
      onSaveAs={save}
    />}
  </>;
}

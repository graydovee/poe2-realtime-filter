"use client";

import { useEffect, useState } from "react";
import { Save } from "lucide-react";

import type { FilterProfile } from "../../lib/types";
import { TextInput } from "./ui/controls";
import { Button } from "./ui/primitives";

export function SaveAsScheme({ profile, sounds }: { profile: FilterProfile; sounds: Record<string, File> }) {
  const [configured, setConfigured] = useState(false);
  const [account, setAccount] = useState(false);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch("/api/auth/session")
      .then((response) => response.json())
      .then((payload) => {
        setConfigured(payload.configured);
        setAccount(Boolean(payload.user));
      })
      .catch(() => undefined);
  }, []);

  async function save() {
    setBusy(true);
    setMessage("");
    try {
      const form = new FormData();
      form.set("name", name.trim());
      form.set("profile", JSON.stringify(profile));
      for (const [id, file] of Object.entries(sounds)) form.set("sound:" + id, file);
      const response = await fetch("/api/profiles", { method: "POST", body: form });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "保存失败");
      setOpen(false);
      setName("");
      setMessage("方案已保存。");
      window.dispatchEvent(new Event("poe2:schemes-changed"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  if (!configured || !account) {
    return (
      <a
        href={configured ? "/api/auth/login" : undefined}
        className="inline-flex h-8 items-center rounded-sm border border-line bg-transparent px-3 text-xs text-ink-muted transition hover:border-line-strong hover:text-ink"
      >
        {configured ? "登录后保存方案" : "保存方案"}
      </a>
    );
  }

  return (
    <div className="relative">
      <Button variant="secondary" size="sm" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <Save aria-hidden="true" className="size-3.5" />
        保存为方案
      </Button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-2 w-72 rounded-sm border border-line bg-surface-2 p-3 shadow-panel">
          <label className="block text-[11px] text-ink-muted">
            方案名称
            <TextInput
              autoFocus
              maxLength={80}
              value={name}
              className="mt-1.5 h-9"
              placeholder="例如：赛季·极限严格"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <div className="mt-2 flex items-center justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button size="sm" variant="primary" disabled={!name.trim() || busy} onClick={() => void save()}>
              {busy ? "保存中…" : "保存"}
            </Button>
          </div>
          {message && <p className="mt-2 text-[11px] text-gold/90">{message}</p>}
        </div>
      )}
    </div>
  );
}

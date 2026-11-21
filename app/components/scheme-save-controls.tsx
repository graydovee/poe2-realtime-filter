"use client";

import { useState } from "react";
import { Save } from "lucide-react";

import { TextInput } from "./ui/controls";
import { Button } from "./ui/primitives";

type Props = {
  schemeName: string | null;
  busy: boolean;
  feedback: { text: string; error?: boolean } | null;
  onSave: () => Promise<boolean>;
  onSaveAs: (name: string) => Promise<boolean>;
};

export function SchemeSaveControls({ schemeName, busy, feedback, onSave, onSaveAs }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  return (
    <div className="rounded border border-line bg-surface px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="min-w-0 break-words text-sm font-semibold text-ink">
          {schemeName ? `正在编辑「${schemeName}」` : "未保存的方案"}
        </span>
        <div className="flex flex-wrap gap-2">
          {schemeName && (
            <Button variant="primary" size="sm" disabled={busy} onClick={() => void onSave()}>
              <Save aria-hidden="true" className="size-3.5" />
              保存修改
            </Button>
          )}
          <Button variant={schemeName ? "secondary" : "primary"} size="sm" disabled={busy} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
            {schemeName ? "另存为方案" : "保存为方案"}
          </Button>
        </div>
      </div>
      {open && (
        <form className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3" onSubmit={async (event) => {
          event.preventDefault();
          if (busy || !name.trim()) return;
          if (await onSaveAs(name.trim())) {
            setOpen(false);
            setName("");
          }
        }}>
          <label className="w-full text-xs text-ink-muted sm:w-64">
            方案名称
            <TextInput autoFocus maxLength={80} value={name} className="mt-1.5" onChange={(event) => setName(event.target.value)} />
          </label>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>取消</Button>
          <Button type="submit" size="sm" variant="primary" disabled={busy || !name.trim()}>保存</Button>
        </form>
      )}
      {feedback && <p role={feedback.error ? "alert" : "status"} className={`mt-2 text-sm ${feedback.error ? "text-ember" : "text-ink-muted"}`}>{feedback.text}</p>}
    </div>
  );
}

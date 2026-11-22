"use client";

import { Download, FileSearch, FolderOpen } from "lucide-react";
import { useState } from "react";
import { LOCALE_LABELS } from "../../../lib/data";
import { displayDirectory, explain, local } from "../../../lib/desktop";
import type { BaseFilter, FilterProfile, Locale } from "../../../lib/types";
import { Alert, Button, Field, Panel } from "../ui/primitives";
import { Select } from "../ui/controls";
import { ConfirmDialog } from "../ui/confirm-dialog";

const sources = [{ id: "neversink", name: "NeverSink" }] as const;
type Source = (typeof sources)[number];
type Picker = { kind: "scan" } | { kind: "source" } | { kind: "versions"; source: Source };

export function BasicFilterSection({ profile, onBaseChange, onLocaleChange }: {
  profile: FilterProfile;
  onBaseChange: (base: BaseFilter) => void;
  onLocaleChange: (locale: Locale) => void;
}) {
  const [picker, setPicker] = useState<Picker>();
  const [options, setOptions] = useState<BaseFilter[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const base = profile.baseFilter;

  function choose(selected: BaseFilter) {
    onBaseChange(selected);
    setPicker(undefined);
    setError("");
  }

  async function pickFile() {
    setBusy(true);
    setError("");
    try {
      const selected = await local<BaseFilter | null>("pick_base_filter");
      if (selected) choose(selected);
    } catch (error) { setError(explain(error)); }
    finally { setBusy(false); }
  }

  async function scan() {
    setPicker({ kind: "scan" });
    setOptions([]);
    setError("");
    setBusy(true);
    try { setOptions(await local<BaseFilter[]>("scan_base_filters")); }
    catch (error) { setError(explain(error)); }
    finally { setBusy(false); }
  }

  async function loadSource(source: Source, cachedOnly: boolean) {
    setPicker({ kind: "versions", source });
    setOptions([]);
    setError("");
    setNotice("");
    setBusy(true);
    try { setOptions(await local<BaseFilter[]>("source_filters", { source: source.id, cachedOnly })); }
    catch (error) {
      setError(explain(error));
      if (!cachedOnly) {
        try {
          const cached = await local<BaseFilter[]>("source_filters", { source: source.id, cachedOnly: true });
          setOptions(cached);
          if (cached.length) setNotice("可继续选择已下载的版本。");
        } catch { /* Preserve the download error. */ }
      }
    } finally { setBusy(false); }
  }

  return (
    <Panel title="基础过滤器">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(9rem,13rem)] sm:items-start">
        <div className="min-w-0">
          <p className="break-all text-sm font-medium text-ink">{base?.name ?? "尚未选择基础过滤器"}</p>
          {base && <p className="mt-1 break-all text-xs text-ink-muted">
            {base.kind === "local" ? displayDirectory(base.path) : `${sources.find((source) => source.id === base.source)?.name ?? base.source} · ${base.version}`}
          </p>}
          {!base && profile.baseFilterHint && <p className="mt-1 break-all text-xs text-ink-muted">分享方案原用 {profile.baseFilterHint}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" disabled={busy} onClick={() => void scan()}><FileSearch aria-hidden="true" className="size-4" />扫描游戏目录</Button>
            <Button size="sm" disabled={busy} onClick={() => void pickFile()}><FolderOpen aria-hidden="true" className="size-4" />选择本地文件</Button>
            <Button size="sm" disabled={busy} onClick={() => { setOptions([]); setError(""); setNotice(""); setPicker({ kind: "source" }); }}>
              <Download aria-hidden="true" className="size-4" />下载过滤器
            </Button>
          </div>
        </div>
        <Field label="客户端语言">
          <Select value={profile.locale} onValueChange={(value) => onLocaleChange(value as Locale)}
            options={Object.entries(LOCALE_LABELS).map(([value, label]) => ({ value, label }))} ariaLabel="选择客户端语言" />
        </Field>
      </div>
      {!picker && error && <div className="mt-3"><Alert tone="ember">{error}</Alert></div>}
      {picker && (
        <ConfirmDialog title={picker.kind === "scan" ? "游戏目录中的过滤器" : picker.kind === "source" ? "选择下载来源" : picker.source.name}
          className="modal-base-picker" busy={busy} onCancel={() => setPicker(undefined)}>
          {picker.kind === "source" ? (
            <div className="my-4 grid gap-2">
              {sources.map((source) => <Button key={source.id} className="justify-start" onClick={() => void loadSource(source, false)}>{source.name}</Button>)}
            </div>
          ) : (
            <div className="my-4 grid gap-2">
              {busy && <p role="status" className="text-sm text-ink-muted">{picker.kind === "scan" ? "正在扫描…" : "正在读取来源…"}</p>}
              {error && <Alert tone="ember">{error}</Alert>}
              {notice && <p className="text-xs text-ink-muted">{notice}</p>}
              {!busy && !error && !options.length && <p className="text-sm text-ink-muted">{picker.kind === "scan" ? "目录中没有可用的基础过滤器。" : "暂无已下载的过滤器。"}</p>}
              {!busy && <div className="grid max-h-[45vh] gap-2 overflow-y-auto">
                {options.map((option) => <Button key={option.kind === "local" ? option.path : `${option.source}/${option.version}/${option.entry}`}
                  size="sm" className="base-filter-option" onClick={() => choose(option)}>
                  <span className="min-w-0 break-words">{option.name}</span>
                  {option.kind === "downloaded" && <span className="font-mono text-xs text-ink-muted">{option.version}</span>}
                </Button>)}
              </div>}
            </div>
          )}
          <div className="modal-actions">
            {picker.kind === "versions" && <Button disabled={busy} onClick={() => void loadSource(picker.source, true)}>查看已下载版本</Button>}
            <Button disabled={busy} onClick={() => { setError(""); setPicker(undefined); }}>关闭</Button>
          </div>
        </ConfirmDialog>
      )}
    </Panel>
  );
}

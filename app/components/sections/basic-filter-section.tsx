"use client";

import { Download, FileSearch, FolderOpen } from "lucide-react";
import { useState } from "react";
import { displayDirectory, explain, local } from "../../../lib/desktop";
import type { BaseFilter, FilterProfile } from "../../../lib/types";
import { Alert, Button, Panel } from "../ui/primitives";
import { Switch } from "../ui/controls";
import { ConfirmDialog } from "../ui/confirm-dialog";

const sources = [{ id: "neversink", name: "NeverSink" }] as const;
type Source = (typeof sources)[number];
type Picker = { kind: "scan" } | { kind: "source" } | { kind: "versions"; source: Source };

function locationLabel(base: BaseFilter) {
  switch (base.kind) {
    case "local": return displayDirectory(base.path);
    case "subscribed": return `${base.source === "online" ? "国际服订阅" : "WeGame 订阅"} · ${base.entry}`;
    case "downloaded": return `${sources.find((source) => source.id === base.source)?.name ?? base.source} · ${base.version} · ${base.entry}`;
  }
}

export function BasicFilterSection({ profile, onBaseChange }: {
  profile: FilterProfile;
  onBaseChange: (base?: BaseFilter) => void;
}) {
  const [picker, setPicker] = useState<Picker>();
  const [options, setOptions] = useState<BaseFilter[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [hideSubscriptions, setHideSubscriptions] = useState(true);
  const base = profile.baseFilter;
  const visibleOptions = picker?.kind === "scan" && hideSubscriptions
    ? options.filter((option) => option.kind !== "subscribed")
    : options;
  const optionGroups = new Map<string, BaseFilter[]>();
  for (const option of visibleOptions) {
    const version = option.kind === "downloaded" ? option.version : "";
    const group = optionGroups.get(version);
    if (group) group.push(option);
    else optionGroups.set(version, [option]);
  }

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
    setNotice("");
    setHideSubscriptions(true);
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
          if (cached.length) setNotice("请从下方列表选择已下载的版本。");
        } catch { /* Preserve the download error. */ }
      }
    } finally { setBusy(false); }
  }

  return (
    <Panel title="基础过滤器">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(9rem,13rem)] sm:items-start">
        <div className="min-w-0">
          <p className="break-all text-sm font-medium text-ink">{base?.name ?? (profile.baseFilterHint ? "选择基础过滤器" : "仅自定义规则")}</p>
          {base && <p className="mt-1 break-all text-xs text-ink-muted">
            {locationLabel(base)}
          </p>}
          {!base && profile.baseFilterHint && <p className="mt-1 break-all text-xs text-ink-muted">分享方案引用「{profile.baseFilterHint}」</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" disabled={busy} onClick={() => void scan()}><FileSearch aria-hidden="true" className="size-4" />选择游戏内过滤器</Button>
            <Button size="sm" disabled={busy} onClick={() => void pickFile()}><FolderOpen aria-hidden="true" className="size-4" />选择本地文件</Button>
            <Button size="sm" disabled={busy} onClick={() => { setOptions([]); setError(""); setNotice(""); setPicker({ kind: "source" }); }}>
              <Download aria-hidden="true" className="size-4" />下载过滤器
            </Button>
            {(base || profile.baseFilterHint) && <Button size="sm" disabled={busy} onClick={() => {
              onBaseChange();
              setError("");
            }}>清除基础过滤器</Button>}
          </div>
        </div>
      </div>
      {!picker && error && <div className="mt-3"><Alert tone="ember">{error}</Alert></div>}
      {picker && (
        <ConfirmDialog title={picker.kind === "scan" ? "选择游戏内过滤器" : picker.kind === "source" ? "选择下载来源" : picker.source.name}
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
              {picker.kind === "scan" && <Switch label="隐藏订阅过滤器" checked={hideSubscriptions} onCheckedChange={setHideSubscriptions} />}
              {!busy && !error && !visibleOptions.length && <p className="text-sm text-ink-muted">{
                picker.kind === "scan"
                  ? options.length ? "关闭「隐藏订阅过滤器」以查看订阅文件。" : "可选择本地文件或下载过滤器。"
                  : "关闭列表后，点击「下载过滤器」并选择来源。"
              }</p>}
              {!busy && optionGroups.size > 0 && (
                <div className="max-h-[45dvh] space-y-4 overflow-y-auto overscroll-contain py-1 pr-2 [scrollbar-gutter:stable]">
                  {[...optionGroups].map(([version, group]) => {
                    const names = new Map<string, number>();
                    for (const option of group) names.set(option.name, (names.get(option.name) ?? 0) + 1);
                    return (
                      <div key={version}>
                        {version && <h4 className="mb-2 text-xs font-medium text-ink-muted">版本 {version}</h4>}
                        <ul className="space-y-2" role="list">
                          {group.map((option) => {
                            const detail = option.kind === "subscribed"
                              ? option.source === "online" ? "国际服订阅" : "WeGame 订阅"
                              : option.kind === "downloaded" && (names.get(option.name) ?? 0) > 1
                                ? option.entry.split("/").slice(0, -1).join("/") || "默认目录"
                                : undefined;
                            return (
                              <li key={locationLabel(option)}>
                                <Button size="sm" className="h-auto w-full flex-col items-start gap-0.5 py-2 text-left" onClick={() => choose(option)}>
                                  <span className="max-w-full [overflow-wrap:anywhere]">{option.name}</span>
                                  {detail && <span className="max-w-full text-xs font-normal text-ink-muted [overflow-wrap:anywhere]">{detail}</span>}
                                </Button>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              )}
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

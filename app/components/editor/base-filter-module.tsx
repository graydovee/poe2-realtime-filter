"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, Download, FileSearch, FolderOpen, PackageSearch, Trash2 } from "lucide-react";

import { itemLabel as itemName } from "../../../lib/catalog";
import { displayDirectory, explain, local } from "../../../lib/desktop";
import { FILTER_ITEMS_BY_ID } from "../../../lib/data";
import type { BaseFilter } from "../../../lib/types";
import { useAppStore } from "../../state/store";
import { Alert } from "../ui/alert";
import { Badge, Chip } from "../ui/badge";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader } from "../ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../ui/dropdown-menu";
import { CollapsiblePanel } from "../ui/panel";
import { Switch } from "../ui/switch";

const sources = [{ id: "neversink", name: "NeverSink" }] as const;
type Source = (typeof sources)[number];
type Picker = { kind: "scan" } | { kind: "source" } | { kind: "versions"; source: Source };
/** 方案包导入的副本在这一组里列出。版本名只含字母、数字和 `-._`，不会和它重名。 */
const IMPORTED_GROUP = "方案包导入";
/** 扫描结果比方案里存的来源多一个登记时间，只有副本带。 */
type ScannedFilter = BaseFilter & { registeredAt?: number };

function registeredDate(seconds: number) {
  return new Date(seconds * 1000).toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

/** 收起时最多展示多少个跳过的物品。 */
const PREVIEW_LIMIT = 12;

/** 基础过滤器的完整位置。只用作列表项的键和悬停提示，不直接显示在界面上。 */
function filterLocation(base: BaseFilter) {
  switch (base.kind) {
    case "local":
      return displayDirectory(base.path);
    case "subscribed":
      return `${base.directory}\\${base.entry}`;
    case "downloaded":
      return `${base.source} · ${base.version} · ${base.entry}`;
    case "imported":
      return `${base.id.slice(0, 8)} · ${base.entry}`;
  }
}

/** 基础过滤器的来源，一行简短说明，不含路径。 */
function filterSource(base: BaseFilter) {
  switch (base.kind) {
    case "local":
      return "本地文件";
    case "subscribed":
      return base.source === "online" ? "国际服订阅" : "WeGame 订阅";
    case "downloaded":
      return `${sources.find((source) => source.id === base.source)?.name ?? base.source} · ${base.version}`;
    case "imported":
      return "来自方案包";
  }
}

function itemLabel(id: string) {
  const item = FILTER_ITEMS_BY_ID.get(id);
  return item ? itemName(item, "cn") : id;
}

/** 选择基础过滤器的对话框：列出游戏目录和方案包导入的过滤器，或选一个下载来源再选版本。 */
function BaseFilterDialog({ initial, onClose }: { initial: Picker; onClose: () => void }) {
  const setBaseFilter = useAppStore((state) => state.setBaseFilter);
  const [picker, setPicker] = useState<Picker>(initial);
  const [options, setOptions] = useState<ScannedFilter[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [hideSubscriptions, setHideSubscriptions] = useState(true);

  const scan = useCallback(async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      setOptions(await local<ScannedFilter[]>("scan_base_filters"));
    } catch (cause) {
      setError(explain(cause));
    } finally {
      setBusy(false);
    }
  }, []);

  const loadSource = useCallback(async (source: Source, cachedOnly: boolean) => {
    setBusy(true);
    setError("");
    setNotice("");
    setOptions([]);
    try {
      setOptions(await local<BaseFilter[]>("source_filters", { source: source.id, cachedOnly }));
    } catch (cause) {
      setError(explain(cause));
      if (!cachedOnly) {
        // 下载失败时退回到已下载的版本。
        try {
          const cached = await local<BaseFilter[]>("source_filters", { source: source.id, cachedOnly: true });
          setOptions(cached);
          if (cached.length) setNotice("请从下方列表选择已下载的版本。");
        } catch {
          // 保留下载失败的错误信息。
        }
      }
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (initial.kind === "scan") void scan();
    else if (initial.kind === "versions") void loadSource(initial.source, false);
  }, [initial, scan, loadSource]);

  const visibleOptions: ScannedFilter[] =
    picker.kind === "scan" && hideSubscriptions ? options.filter((option) => option.kind !== "subscribed") : options;
  const optionGroups = new Map<string, ScannedFilter[]>();
  for (const option of visibleOptions) {
    const version =
      option.kind === "imported" ? IMPORTED_GROUP : option.kind === "downloaded" ? option.version : "";
    const group = optionGroups.get(version);
    if (group) group.push(option);
    else optionGroups.set(version, [option]);
  }

  const title = picker.kind === "scan" ? "选择已有过滤器" : picker.kind === "source" ? "选择下载来源" : picker.source.name;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent aria-busy={busy || undefined}>
        <DialogHeader
          title={title}
          description={
            picker.kind === "scan" ? "列出游戏目录里和方案包导入的过滤器。选中后替换当前的。" : undefined
          }
        />
        {picker.kind === "source" ? (
          <div className="grid gap-2">
            {sources.map((source) => (
              <Button key={source.id} size="lg" className="justify-start" onClick={() => {
                setPicker({ kind: "versions", source });
                void loadSource(source, false);
              }}>
                <Download aria-hidden="true" />
                从 {source.name} 下载
              </Button>
            ))}
          </div>
        ) : (
          <div className="grid gap-3">
            {picker.kind === "scan" && (
              <Switch label="隐藏订阅过滤器" checked={hideSubscriptions} onCheckedChange={setHideSubscriptions} />
            )}
            {busy && (
              <p role="status" className="text-sm text-ink-muted">
                {picker.kind === "scan" ? "正在扫描…" : "正在读取来源…"}
              </p>
            )}
            {error && <Alert tone="ember">{error}</Alert>}
            {notice && <Alert tone="gold">{notice}</Alert>}
            {!busy && !error && !visibleOptions.length && (
              <p className="text-sm text-ink-muted">
                {picker.kind === "scan"
                  ? options.length
                    ? "关闭「隐藏订阅过滤器」以查看订阅文件。"
                    : "没有找到可用的过滤器。可以选择本地文件，或下载过滤器。"
                  : "关闭列表后，点击「其他来源 › 下载过滤器」并选择来源。"}
              </p>
            )}
            {!busy && optionGroups.size > 0 && (
              <div className="max-h-[50dvh] space-y-4 overflow-y-auto overscroll-contain py-1 pr-2 [scrollbar-gutter:stable]">
                {[...optionGroups].map(([group, options]) => {
                  const names = new Map<string, number>();
                  for (const option of options) names.set(option.name, (names.get(option.name) ?? 0) + 1);
                  return (
                    <div key={group}>
                      {group && (
                        <h4 className="mb-2 text-xs font-medium text-ink-muted">
                          {group === IMPORTED_GROUP ? group : `版本 ${group}`}
                        </h4>
                      )}
                      <ul className="space-y-1" role="list">
                        {options.map((option) => {
                          const repeated = (names.get(option.name) ?? 0) > 1;
                          const detail =
                            option.kind === "subscribed"
                              ? option.source === "online" ? "国际服订阅" : "WeGame 订阅"
                              : option.kind === "downloaded" && repeated
                                ? option.entry.split("/").slice(0, -1).join("/") || "默认目录"
                                // 同名的两份副本用登记日期区分。
                                : option.kind === "imported" && repeated && option.registeredAt
                                  ? `导入于 ${registeredDate(option.registeredAt)}`
                                : undefined;
                          return (
                            <li key={filterLocation(option)}>
                              <button
                                type="button"
                                onClick={() => {
                                  // 登记时间只用于显示，方案里只存来源。
                                  const { registeredAt: _registered, ...base } = option;
                                  setBaseFilter(base);
                                  onClose();
                                }}
                                className="flex w-full cursor-pointer flex-col items-start gap-0.5 rounded-md border border-line bg-surface-2 px-3 py-2 text-left transition-colors duration-150 hover:border-gold/50 hover:bg-surface-3"
                              >
                                <span className="max-w-full text-sm font-medium text-ink [overflow-wrap:anywhere]">{option.name}</span>
                                {detail && <span className="max-w-full text-xs text-ink-muted [overflow-wrap:anywhere]">{detail}</span>}
                              </button>
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
        <DialogFooter>
          {picker.kind === "versions" && (
            <Button disabled={busy} onClick={() => void loadSource(picker.source, true)}>
              查看已下载版本
            </Button>
          )}
          <Button disabled={busy} onClick={onClose}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 模块 ②：基础过滤器 + 跳过物品。不常用，默认折叠；需要处理时自动展开。 */
export function BaseFilterModule() {
  const base = useAppStore((state) => state.profile.baseFilter);
  const hint = useAppStore((state) => state.profile.baseFilterHint);
  const skipped = useAppStore((state) => state.profile.skippedItemIds);
  const baseStylesError = useAppStore((state) => state.baseStylesError);
  const open = useAppStore((state) => state.baseFilterOpen);
  const setBaseFilterOpen = useAppStore((state) => state.setBaseFilterOpen);
  const setBaseFilter = useAppStore((state) => state.setBaseFilter);
  const openPicker = useAppStore((state) => state.openPicker);
  const clearSkipped = useAppStore((state) => state.clearSkipped);
  const [picker, setPicker] = useState<Picker>();
  const [fileBusy, setFileBusy] = useState(false);
  const [fileError, setFileError] = useState("");

  useEffect(() => {
    if (baseStylesError || (!base && hint)) setBaseFilterOpen(true);
  }, [baseStylesError, base, hint, setBaseFilterOpen]);

  const pickFile = async () => {
    setFileBusy(true);
    setFileError("");
    try {
      const selected = await local<BaseFilter | null>("pick_base_filter");
      if (selected) setBaseFilter(selected);
    } catch (cause) {
      setFileError(explain(cause));
    } finally {
      setFileBusy(false);
    }
  };

  return (
    <>
      <CollapsiblePanel
        id="module-base"
        open={open}
        onOpenChange={setBaseFilterOpen}
        title="基础过滤器"
        summary={
          <span className={hint && !base ? "text-ember" : undefined} title={base ? filterLocation(base) : undefined}>
            {base ? base.name : hint ? "待选择" : "仅自定义规则"}
          </span>
        }
        actions={base ? <Badge tone="muted">跳过 {skipped.length} 项</Badge> : undefined}
        bodyClassName="space-y-4"
      >
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1 basis-80">
            <p className="text-sm font-medium break-all text-ink" title={base ? filterLocation(base) : undefined}>
              {base?.name ?? (hint ? "选择基础过滤器" : "仅自定义规则")}
            </p>
            <p className="mt-0.5 text-xs break-all text-ink-muted">
              {base
                ? filterSource(base)
                : hint
                  ? `分享方案引用「${hint}」。请在下方重新选择。`
                  : "自定义规则会叠加在游戏默认显示之上。"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" size="sm" onClick={() => setPicker({ kind: "scan" })}>
              <FileSearch aria-hidden="true" />
              选择已有过滤器
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm">
                  <FolderOpen aria-hidden="true" />
                  其他来源
                  <ChevronDown aria-hidden="true" className="text-ink-muted" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem disabled={fileBusy} onSelect={() => void pickFile()}>
                  <FolderOpen aria-hidden="true" />
                  选择本地文件…
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setPicker({ kind: "source" })}>
                  <Download aria-hidden="true" />
                  下载过滤器…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {(base || hint) && (
              <Button size="sm" variant="ghost" onClick={() => setBaseFilter()}>
                <Trash2 aria-hidden="true" />
                清除基础过滤器
              </Button>
            )}
          </div>
        </div>
        {(fileError || baseStylesError) && <Alert tone="ember">{fileError || baseStylesError}</Alert>}

        {base && (
          <div className="border-t border-line pt-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1 basis-72">
                <h3 className="text-sm font-semibold text-ink">跳过物品</h3>
                <p className="mt-0.5 text-sm leading-relaxed text-ink-muted">
                  名单中的物品沿用基础过滤器的规则和特效，常用于不想被自定义规则覆盖的基础通货、任务物品或材料。
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge tone="muted">已跳过 {skipped.length} 项</Badge>
                <Button size="sm" onClick={() => openPicker("skipped")}>
                  <PackageSearch aria-hidden="true" />
                  编辑名单
                </Button>
                {skipped.length > 0 && (
                  <Button size="sm" variant="ghost" onClick={clearSkipped}>
                    清空名单
                  </Button>
                )}
              </div>
            </div>
            {skipped.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5" aria-label="已跳过的物品">
                {skipped.slice(0, PREVIEW_LIMIT).map((id) => (
                  <Chip key={id} className="max-w-56">
                    {itemLabel(id)}
                  </Chip>
                ))}
                {skipped.length > PREVIEW_LIMIT && <Chip>另有 {skipped.length - PREVIEW_LIMIT} 项</Chip>}
              </div>
            )}
          </div>
        )}
      </CollapsiblePanel>
      {picker && <BaseFilterDialog initial={picker} onClose={() => setPicker(undefined)} />}
    </>
  );
}

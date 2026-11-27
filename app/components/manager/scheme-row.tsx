"use client";

import { FileArchive, FilePen, MoreHorizontal, Pencil, RefreshCw, Share2, Trash2, Copy, Download } from "lucide-react";

import { cn } from "../../../lib/cn";
import type { LocalScheme } from "../../../lib/desktop";
import { formatMarketTime, formatMarketTimeFull } from "../../../lib/time";
import type { GameServer } from "../../../lib/types";
import { revealInspector, useAppStore } from "../../state/store";
import type { DownloadOffer } from "../../state/types";
import { Badge, StatusDot } from "../ui/badge";
import { Button, IconButton } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Tooltip } from "../ui/tooltip";
import { baseLabel, missingBaseHint, schemeIssue, schemeTone } from "./scheme-meta";

const toneLabels = { sage: "已安装，运行正常", ember: "需要处理", muted: "未安装" } as const;

/** 方案库里的一行：名称、描述、状态和常用操作。点名称区域在检查器里查看详情。 */
export function SchemeRow({
  scheme,
  server,
  selected,
  busy,
  offers,
}: {
  scheme: LocalScheme;
  server: GameServer;
  selected: boolean;
  busy: boolean;
  offers?: DownloadOffer[];
}) {
  const setSelectedSchemeId = useAppStore((state) => state.setSelectedSchemeId);
  const installScheme = useAppStore((state) => state.installScheme);
  const openManagerDialog = useAppStore((state) => state.openManagerDialog);
  const openDraft = useAppStore((state) => state.openDraft);
  const copyScheme = useAppStore((state) => state.copyScheme);
  const shareScheme = useAppStore((state) => state.shareScheme);
  const downloadZip = useAppStore((state) => state.downloadZip);
  const downloadBase = useAppStore((state) => state.downloadBase);
  const exportPackage = useAppStore((state) => state.exportPackage);

  const tone = schemeTone(scheme);
  const issue = schemeIssue(scheme.status);
  const missingBase = missingBaseHint(scheme);
  const meta = `${baseLabel(scheme.profile.baseFilter, scheme.profile.baseFilterHint)} · ${(scheme.profile.rules ?? []).length} 条规则`;
  const marketTime = formatMarketTime(scheme.installed?.marketCapturedAt);
  const marketTimeFull = formatMarketTimeFull(scheme.installed?.marketCapturedAt);

  return (
    <li
      // min-w-0 必须有：否则计算这一行的最小宽度时，不换行的摘要文字会被整个算进去，把行撑到比容器还宽。
      className={cn(
        "min-w-0 overflow-hidden rounded-lg border transition-colors duration-150",
        selected ? "border-gold/55 bg-gold/6 shadow-gold-ring" : "border-line bg-surface hover:border-line-strong",
      )}
    >
      <div className="flex min-w-0 items-center gap-3 px-3 py-2">
        <Tooltip label={toneLabels[tone]}>
          <span className="grid size-5 shrink-0 place-items-center rounded-full">
            <StatusDot tone={tone} />
          </span>
        </Tooltip>

        <div className="min-w-0 flex-1">
          <button
            type="button"
            aria-pressed={selected}
            aria-label={`查看方案 ${scheme.name} 的详情`}
            // 检查器收起或窗口较窄时，选中后要把它显示出来，否则点了没有任何反应。
            onClick={() => {
              setSelectedSchemeId(scheme.id);
              revealInspector();
            }}
            className="flex w-full min-w-0 cursor-pointer flex-col items-start gap-1 rounded-sm py-1 text-left"
          >
            <span className="flex min-w-0 max-w-full flex-wrap items-center gap-x-2 gap-y-1">
              <span className="min-w-0 truncate text-sm font-semibold text-ink">{scheme.name}</span>
              <Badge tone={scheme.installed ? "sage" : "muted"}>{scheme.installed ? "已安装" : "未安装"}</Badge>
              {scheme.installed && scheme.autoRefresh && <Badge tone="gold">自动刷新</Badge>}
            </span>
            {scheme.description && (
              <span className="block w-full truncate text-xs text-ink-muted" title={scheme.description}>
                {scheme.description}
              </span>
            )}
            {!missingBase && (
              // 摘要和行情时间同行：放不下时行情时间折到下一行，摘要本身过长时才截断。
              <span className="flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
                <span className={cn("min-w-0 grow truncate", issue ? "text-ink-muted" : "text-ink-faint")} title={issue || undefined}>
                  {issue || meta}
                </span>
                {marketTime && (
                  <span className="shrink-0 whitespace-nowrap text-ink-faint" title={marketTimeFull ?? undefined}>
                    行情时间 {marketTime}
                  </span>
                )}
              </span>
            )}
          </button>
          {missingBase && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pb-1 text-xs">
              <span className="break-words text-ember">未能匹配基础过滤器「{missingBase}」。</span>
              {offers?.map((offer) => (
                <button
                  key={offer.source}
                  type="button"
                  disabled={busy}
                  onClick={() => void downloadBase(scheme, missingBase, offer.source, offer.label)}
                  className="cursor-pointer rounded-sm text-gold-bright underline underline-offset-4 hover:text-gold-press disabled:opacity-50"
                >
                  从 {offer.label} 下载
                </button>
              ))}
              {offers?.length === 0 && <span className="text-ink-muted">打开方案后可以重新选择。</span>}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <Button size="sm" disabled={busy} onClick={() => void openDraft(scheme, server)}>
            <FilePen aria-hidden="true" />
            编辑
          </Button>
          {scheme.installed ? (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => openManagerDialog("uninstall", scheme)}>
              卸载
            </Button>
          ) : (
            <Button size="sm" variant="primary" disabled={busy} onClick={() => void installScheme(scheme)}>
              安装到游戏
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton label={`方案 ${scheme.name} 的更多操作`} size="icon-sm" disabled={busy}>
                <MoreHorizontal aria-hidden="true" />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={() => void exportPackage(scheme)}>
                <FileArchive aria-hidden="true" />
                导出方案包
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => openManagerDialog("nameDescription", scheme)}>
                <Pencil aria-hidden="true" />
                编辑名称和描述
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void copyScheme(scheme.id)}>
                <Copy aria-hidden="true" />
                复制
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void shareScheme(scheme)}>
                <Share2 aria-hidden="true" />
                分享码
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void downloadZip(scheme)}>
                <Download aria-hidden="true" />
                下载 ZIP
              </DropdownMenuItem>
              {scheme.installed && (
                <DropdownMenuItem onSelect={() => void installScheme(scheme)}>
                  <RefreshCw aria-hidden="true" />
                  重新生成
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="danger" onSelect={() => openManagerDialog("remove", scheme)}>
                <Trash2 aria-hidden="true" />
                删除
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </li>
  );
}

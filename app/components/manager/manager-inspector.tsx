"use client";

import { useId } from "react";
import { ArrowLeft, Copy, Download, Eye, EyeOff, FilePen, PackageOpen, Pencil, Plus, RefreshCw, Share2, Trash2 } from "lucide-react";

import { local, SERVER_LABELS, type Library, type LocalScheme } from "../../../lib/desktop";
import type { GameServer } from "../../../lib/types";
import { useAppStore } from "../../state/store";
import type { DownloadOffer } from "../../state/types";
import { Alert } from "../ui/alert";
import { Badge, StatusDot } from "../ui/badge";
import { Button } from "../ui/button";
import { EmptyState } from "../ui/empty-state";
import { Field } from "../ui/field";
import { Input } from "../ui/input";
import { Panel } from "../ui/panel";
import { Switch } from "../ui/switch";
import { baseLabel, missingBaseHint, schemeIssue, schemeTone } from "./scheme-meta";

function SchemeRules({ scheme }: { scheme: LocalScheme }) {
  const rules = scheme.profile.rules ?? [];
  if (!rules.length) return <p className="text-sm text-ink-muted">没有自定义规则。</p>;
  return (
    <ol className="space-y-1">
      {rules.map((rule, index) => (
        <li key={rule.id} className="flex min-w-0 items-center gap-2 text-sm">
          <span className="w-4 shrink-0 text-right font-mono text-xs text-ink-faint">{index + 1}</span>
          <span
            className={rule.enabled ? "min-w-0 truncate text-ink" : "min-w-0 truncate text-ink-faint line-through"}
            title={rule.name}
          >
            {rule.name}
          </span>
          {rule.hidden ? (
            <EyeOff aria-label="隐藏命中的物品" className="size-3.5 shrink-0 text-ember" />
          ) : (
            rule.enabled && <Eye aria-hidden="true" className="size-3.5 shrink-0 text-ink-faint" />
          )}
        </li>
      ))}
    </ol>
  );
}

function SchemeDetail({ scheme, server, busy, offers }: {
  scheme: LocalScheme;
  server: GameServer;
  busy: boolean;
  offers?: DownloadOffer[];
}) {
  const installScheme = useAppStore((state) => state.installScheme);
  const openManagerDialog = useAppStore((state) => state.openManagerDialog);
  const openDraft = useAppStore((state) => state.openDraft);
  const copyScheme = useAppStore((state) => state.copyScheme);
  const shareScheme = useAppStore((state) => state.shareScheme);
  const downloadZip = useAppStore((state) => state.downloadZip);
  const downloadBase = useAppStore((state) => state.downloadBase);
  const runManager = useAppStore((state) => state.runManager);

  const issue = schemeIssue(scheme.status);
  const missingBase = missingBaseHint(scheme);
  const rules = scheme.profile.rules ?? [];
  // 文件路径一律不显示：它们对判断方案状态没有帮助，还会把版面撑坏。
  const rows: Array<[string, string]> = [
    ["赛季", scheme.profile.league || "待选赛季"],
    ["基础过滤器", baseLabel(scheme.profile.baseFilter, scheme.profile.baseFilterHint)],
    ["规则", `${rules.length} 条 · 启用 ${rules.filter((rule) => rule.enabled).length} · 隐藏 ${rules.filter((rule) => rule.hidden).length}`],
  ];

  return (
    <div>
      <div className="flex min-w-0 items-start gap-2">
        <StatusDot tone={schemeTone(scheme)} className="mt-1.5" />
        <h3 className="min-w-0 text-base leading-snug font-semibold break-words text-ink">{scheme.name}</h3>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5 pl-3.5">
        <Badge>{SERVER_LABELS[server]}</Badge>
        <Badge tone={scheme.installed ? "sage" : "muted"}>{scheme.installed ? "已安装" : "未安装"}</Badge>
      </div>

      {missingBase && (
        <Alert tone="ember" title={`未能匹配基础过滤器「${missingBase}」`} className="mt-4">
          {offers?.length
            ? offers.map((offer) => (
                <button
                  key={offer.source}
                  type="button"
                  disabled={busy}
                  onClick={() => void downloadBase(scheme, missingBase, offer.source, offer.label)}
                  className="mr-3 cursor-pointer text-gold-bright underline underline-offset-4 hover:text-gold-press disabled:opacity-50"
                >
                  从 {offer.label} 下载
                </button>
              ))
            : "打开方案后可以重新选择，或清除基础过滤器。"}
        </Alert>
      )}
      {issue && (
        <Alert tone="ember" className="mt-4">
          {issue}
        </Alert>
      )}

      <dl className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-ink-muted">{label}</dt>
            <dd className="min-w-0 text-right text-ink [overflow-wrap:anywhere]">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-4 border-t border-line pt-4">
        <h4 className="mb-2 text-xs font-medium text-ink-muted">规则顺序</h4>
        <SchemeRules scheme={scheme} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button variant="primary" className="col-span-2" disabled={busy} onClick={() => void openDraft(scheme, server)}>
          <FilePen aria-hidden="true" />
          编辑方案
        </Button>
        {scheme.installed ? (
          <Button className="col-span-2" disabled={busy} onClick={() => openManagerDialog("uninstall", scheme)}>
            卸载过滤器
          </Button>
        ) : (
          <Button className="col-span-2" disabled={busy} onClick={() => void installScheme(scheme)}>
            安装到游戏
          </Button>
        )}
        <Button disabled={busy} onClick={() => openManagerDialog("rename", scheme)}>
          <Pencil aria-hidden="true" />
          重命名
        </Button>
        <Button disabled={busy} onClick={() => void copyScheme(scheme.id)}>
          <Copy aria-hidden="true" />
          复制
        </Button>
        <Button disabled={busy} onClick={() => void shareScheme(scheme)}>
          <Share2 aria-hidden="true" />
          分享码
        </Button>
        <Button disabled={busy} onClick={() => void downloadZip(scheme)}>
          <Download aria-hidden="true" />
          下载 ZIP
        </Button>
        {scheme.installed && (
          <>
            <div className="flex items-center">
              <Switch
                label="自动刷新"
                checked={scheme.autoRefresh}
                disabled={busy}
                onCheckedChange={(enabled) => void runManager(() => local("scheme_auto", { id: scheme.id, enabled }))}
              />
            </div>
            <Button variant="ghost" disabled={busy} onClick={() => void installScheme(scheme)}>
              <RefreshCw aria-hidden="true" />
              重新生成
            </Button>
          </>
        )}
        <Button variant="danger" className="col-span-2" disabled={busy} onClick={() => openManagerDialog("remove", scheme)}>
          <Trash2 aria-hidden="true" />
          删除方案
        </Button>
      </div>
    </div>
  );
}

function Overview({ library, busy, server }: { library: Library; busy: boolean; server: GameServer }) {
  const openDraft = useAppStore((state) => state.openDraft);
  const setSelectedSchemeId = useAppStore((state) => state.setSelectedSchemeId);
  const patch = useAppStore((state) => state.patchManager);
  const installed = library.schemes.filter((scheme) => scheme.installed).length;
  const attention = library.schemes.filter((scheme) => schemeTone(scheme) === "ember").length;
  return (
    <div>
      <h3 className="text-sm font-semibold text-ink">方案库概览</h3>
      <p className="mt-1 text-sm leading-relaxed text-ink-muted">点击左侧的方案查看详情和更多操作。</p>
      <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
        {([
          ["全部", library.schemes.length],
          ["已安装", installed],
          ["需处理", attention],
        ] as Array<[string, number]>).map(([label, value]) => (
          <div key={label} className="rounded-md border border-line bg-surface-2 px-2 py-2.5">
            <dt className="text-xs text-ink-muted">{label}</dt>
            <dd className="mt-0.5 font-mono text-lg text-ink">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-4 grid gap-2">
        <Button variant="primary" disabled={busy} onClick={() => void openDraft(null, server)}>
          <Plus aria-hidden="true" />
          新建方案
        </Button>
        <Button disabled={busy} onClick={() => patch({ importOpen: true })}>
          <PackageOpen aria-hidden="true" />
          导入分享码
        </Button>
      </div>
      {library.schemes.length > 0 && (
        <button
          type="button"
          onClick={() => setSelectedSchemeId(library.schemes[0].id)}
          className="mt-3 w-full cursor-pointer rounded-sm py-1 text-xs text-ink-muted underline underline-offset-4 hover:text-ink"
        >
          查看第一个方案
        </button>
      )}
    </div>
  );
}

function RefreshSettings({ library, busy }: { library: Library; busy: boolean }) {
  const intervalDraft = useAppStore((state) => state.intervalDraft);
  const patch = useAppStore((state) => state.patchManager);
  const updateSettings = useAppStore((state) => state.updateSettings);
  return (
    <Panel className="border-line/80 bg-surface-2/60" bodyClassName="p-4">
      <h3 className="text-sm font-semibold text-ink">刷新设置</h3>
      <p className="mt-1 text-sm leading-relaxed text-ink-muted">
        托盘会定时检查下载的基础过滤器和行情。已安装且开启自动刷新的方案会自动更新游戏里的过滤器。
      </p>
      <form
        className="mt-3 flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) void updateSettings(Number(intervalDraft ?? library.settings.intervalMinutes), library.settings.paused);
        }}
      >
        <Field label="刷新间隔（分钟）" className="min-w-0 flex-1">
          <Input
            type="number"
            min={1}
            max={1440}
            required
            disabled={busy}
            value={intervalDraft ?? library.settings.intervalMinutes}
            onChange={(event) => patch({ intervalDraft: event.target.value })}
          />
        </Field>
        <Button type="submit" disabled={busy}>
          应用
        </Button>
      </form>
      <Switch
        label="暂停后台刷新"
        className="mt-3"
        checked={library.settings.paused}
        disabled={busy}
        onCheckedChange={(paused) => void updateSettings(library.settings.intervalMinutes, paused)}
      />
    </Panel>
  );
}

/** 开机启动与刷新无关，单独一张卡片，结构和另外两张设置卡片一致。 */
function StartupSettings({ library, busy }: { library: Library; busy: boolean }) {
  const setAutostart = useAppStore((state) => state.setAutostart);
  const description = useId();
  // 读不到启动项时开关不可用，说明文字换成原因。
  const unavailable = library.autostart === null;
  return (
    <Panel className="border-line/80 bg-surface-2/60" bodyClassName="p-4">
      <h3 className="text-sm font-semibold text-ink">启动</h3>
      <p id={description} className="mt-1 text-sm leading-relaxed text-ink-muted">
        {unavailable
          ? "无法读取当前用户的启动项，暂时不能切换。"
          : "开启后，登录 Windows 时客户端直接在托盘中运行，不打开窗口。双击托盘图标或选择「打开过滤器编辑器」即可打开。"}
      </p>
      <Switch
        className="mt-3"
        label="开机启动"
        describedBy={description}
        checked={library.autostart === true}
        disabled={busy || unavailable}
        onCheckedChange={(enabled) => void setAutostart(enabled)}
      />
    </Panel>
  );
}

function FilterDirectory({ library, busy }: { library: Library; busy: boolean }) {
  const draft = useAppStore((state) => state.directoryDraft);
  const error = useAppStore((state) => state.directoryError);
  const patch = useAppStore((state) => state.patchManager);
  const saveDirectory = useAppStore((state) => state.saveDirectory);
  const pickFilterDirectory = useAppStore((state) => state.pickFilterDirectory);
  const effective = library.filterDirectory ?? "";
  const value = draft ?? effective;

  return (
    <Panel className="border-line/80 bg-surface-2/60" bodyClassName="p-4">
      <h3 className="text-sm font-semibold text-ink">过滤器目录</h3>
      <p className="mt-1 text-sm leading-relaxed text-ink-muted">两服共用过滤器目录。此设置用于新安装。</p>
      <form
        className="mt-3 grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) void saveDirectory(value);
        }}
      >
        <Field label="新安装目录" error={error}>
          <Input
            disabled={busy}
            aria-invalid={Boolean(error)}
            value={value}
            onChange={(event) => patch({ directoryDraft: event.target.value, directoryError: "" })}
          />
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={busy} onClick={() => void pickFilterDirectory(value)}>
            浏览
          </Button>
          <Button type="submit" size="sm" variant="primary" disabled={busy || !value.trim() || value === effective}>
            保存目录
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy || (!library.customDirectory && draft === undefined)}
            onClick={() => void saveDirectory(null)}
          >
            恢复默认
          </Button>
        </div>
      </form>
    </Panel>
  );
}

/** 方案库的检查器：选中方案的详情与操作；下方常驻刷新、启动和过滤器目录三张设置卡片。 */
export function ManagerInspector() {
  const library = useAppStore((state) => state.library);
  const busy = useAppStore((state) => state.managerBusy);
  const selectedSchemeId = useAppStore((state) => state.selectedSchemeId);
  const setSelectedSchemeId = useAppStore((state) => state.setSelectedSchemeId);
  const baseOffers = useAppStore((state) => state.baseOffers);

  if (!library) return <EmptyState compact title="正在读取方案库…" className="py-10" />;
  const scheme = library.schemes.find((entry) => entry.id === selectedSchemeId);
  const hint = scheme ? missingBaseHint(scheme) : undefined;

  return (
    <div className="space-y-4 p-4">
      {scheme ? (
        // 选中方案后概览被详情替换，这里留一个明确的返回入口。
        <div>
          <Button variant="ghost" size="sm" className="-ml-2 mb-1 text-ink-muted" onClick={() => setSelectedSchemeId(null)}>
            <ArrowLeft aria-hidden="true" />
            方案库概览
          </Button>
          <SchemeDetail scheme={scheme} server={library.server} busy={busy} offers={hint ? baseOffers[hint] : undefined} />
        </div>
      ) : (
        <Overview library={library} busy={busy} server={library.server} />
      )}
      <RefreshSettings library={library} busy={busy} />
      <StartupSettings library={library} busy={busy} />
      <FilterDirectory library={library} busy={busy} />
    </div>
  );
}

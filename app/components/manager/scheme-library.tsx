"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, PackageOpen, Plus, RefreshCw, SearchX, X } from "lucide-react";

import { isDesktop, local, type LocalScheme } from "../../../lib/desktop";
import { useAppStore } from "../../state/store";
import type { DownloadOffer } from "../../state/types";
import { Alert } from "../ui/alert";
import { Button, IconButton } from "../ui/button";
import { EmptyState, Skeleton } from "../ui/empty-state";
import { SearchInput } from "../ui/input";
import { Panel } from "../ui/panel";
import { SchemeDialogs } from "./scheme-dialogs";
import { missingBaseNames } from "./scheme-meta";
import { SchemeRow } from "./scheme-row";

/** 方案库主区：工具栏 + 按赛季分组的方案列表。 */
export function SchemeLibrary() {
  const library = useAppStore((state) => state.library);
  const busy = useAppStore((state) => state.managerBusy);
  const error = useAppStore((state) => state.managerError);
  const managerDialog = useAppStore((state) => state.managerDialog);
  const importTarget = useAppStore((state) => state.importTarget);
  const selectedSchemeId = useAppStore((state) => state.selectedSchemeId);
  const baseOffers = useAppStore((state) => state.baseOffers);
  const refreshTick = useAppStore((state) => state.refreshTick);
  const patchManager = useAppStore((state) => state.patchManager);
  const openDraft = useAppStore((state) => state.openDraft);
  const refreshLeagueMarket = useAppStore((state) => state.refreshLeagueMarket);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());

  // 方案引用了本机没有的基础过滤器时，向后端询问可用的下载来源。
  const missing = missingBaseNames(library?.schemes);
  useEffect(() => {
    const names: string[] = JSON.parse(missing);
    if (!isDesktop() || !names.length) return;
    let active = true;
    void local<Record<string, DownloadOffer[]>>("base_download_offers", { names })
      .then((offers) => {
        if (active) patchManager({ baseOffers: offers });
      })
      .catch(() => {
        // 没有下载来源时仍可手动选择基础过滤器。
      });
    return () => {
      active = false;
    };
  }, [missing, refreshTick, patchManager]);

  const groups = useMemo(() => {
    const byLeague = new Map<string, LocalScheme[]>();
    const search = query.trim().toLocaleLowerCase();
    for (const scheme of library?.schemes ?? []) {
      if (search && !scheme.name.toLocaleLowerCase().includes(search)) continue;
      const list = byLeague.get(scheme.profile.league);
      if (list) list.push(scheme);
      else byLeague.set(scheme.profile.league, [scheme]);
    }
    return [...byLeague];
  }, [library, query]);

  const toggleLeague = (league: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(league)) next.delete(league);
      else next.add(league);
      return next;
    });

  const hasSchemes = Boolean(library?.schemes.length);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" disabled={busy || !library} onClick={() => library && void openDraft(null, library.server)}>
          <Plus aria-hidden="true" />
          新建方案
        </Button>
        <Button disabled={busy || !library} onClick={() => patchManager({ importOpen: true })}>
          <PackageOpen aria-hidden="true" />
          导入分享码
        </Button>
        <SearchInput
          className="ml-auto w-64 max-w-full"
          value={query}
          aria-label="搜索方案"
          placeholder="搜索方案"
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {error && !managerDialog && !importTarget && (
        <Alert
          tone="ember"
          action={
            <IconButton label="关闭提示" size="icon-sm" onClick={() => patchManager({ managerError: "" })}>
              <X aria-hidden="true" />
            </IconButton>
          }
        >
          {error}
        </Alert>
      )}

      <Panel className="border-line/80" bodyClassName="p-2">
        {!library && !error && (
          <div role="status" className="space-y-2 p-2">
            <span className="sr-only">正在读取本地方案</span>
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
          </div>
        )}
        {library && !hasSchemes && (
          <EmptyState
            icon={<PackageOpen className="size-5" aria-hidden="true" />}
            title="还没有方案"
            description="新建一个方案，或粘贴分享码导入。"
            action={
              <Button variant="primary" disabled={busy} onClick={() => void openDraft(null, library.server)}>
                <Plus aria-hidden="true" />
                新建方案
              </Button>
            }
          />
        )}
        {library && hasSchemes && groups.length === 0 && (
          <EmptyState compact icon={<SearchX className="size-4" aria-hidden="true" />} title="没有匹配的方案" description="换一个关键词试试。" />
        )}
        {library &&
          groups.map(([league, schemes]) => {
            const open = !collapsed.has(league);
            return (
              <section key={league} aria-label={league || "待选赛季"} className="mb-2 last:mb-0">
                <div className="flex items-center justify-between gap-2 rounded-md px-2 py-1">
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => toggleLeague(league)}
                    className="flex min-w-0 cursor-pointer items-center gap-1.5 rounded-sm py-1 text-left text-sm font-semibold text-ink"
                  >
                    {open ? (
                      <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
                    ) : (
                      <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
                    )}
                    <span className="truncate">{league || "待选赛季"}</span>
                    <span className="font-mono text-xs font-normal text-ink-faint">{schemes.length}</span>
                  </button>
                  <IconButton
                    label={`刷新 ${league || "当前赛季"} 行情`}
                    size="icon-sm"
                    disabled={busy}
                    onClick={() => void refreshLeagueMarket(league)}
                  >
                    <RefreshCw aria-hidden="true" className={busy ? "animate-spin" : undefined} />
                  </IconButton>
                </div>
                {open && (
                  <ul className="grid gap-2">
                    {schemes.map((scheme) => {
                      const hint = scheme.profile.baseFilter ? undefined : scheme.profile.baseFilterHint;
                      return (
                        <SchemeRow
                          key={scheme.id}
                          scheme={scheme}
                          server={library.server}
                          selected={scheme.id === selectedSchemeId}
                          busy={busy}
                          offers={hint ? baseOffers[hint] : undefined}
                        />
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })}
      </Panel>
      <SchemeDialogs />
    </div>
  );
}

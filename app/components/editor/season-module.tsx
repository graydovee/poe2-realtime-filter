"use client";

import { RefreshCw } from "lucide-react";

import { useAppStore, useEditorMarket } from "../../state/store";
import { Badge, StatusDot } from "../ui/badge";
import { IconButton } from "../ui/button";
import { Panel } from "../ui/panel";
import { Select, type SelectGroup } from "../ui/select";

/** 模块 ①：赛季与行情。 */
export function SeasonModule() {
  const league = useAppStore((state) => state.profile.league);
  const originalLeague = useAppStore((state) => state.profile.originalLeague);
  const leagueCatalog = useAppStore((state) => state.leagueCatalog);
  const loading = useAppStore((state) => state.marketLoading);
  const marketError = useAppStore((state) => state.marketError);
  const selectLeague = useAppStore((state) => state.selectLeague);
  const refreshMarket = useAppStore((state) => state.refreshMarket);
  const market = useAppStore((state) => state.market);
  const { matching, selected } = useEditorMarket();

  // 服务器和赛季都对得上时展示真实行情（即使已过期，也能提示缓存时间）。
  const shown = matching ? market : selected;
  const usable = Boolean(shown.rates) && Date.parse(shown.expiresAt) >= Date.now();
  const tone = loading ? "gold" : marketError ? "ember" : usable ? "sage" : "muted";
  const statusText = loading
    ? `正在加载 ${league} 行情…`
    : marketError ||
      (shown.rates ? (usable ? "最新报价时间：" : "缓存已过期 · ") + new Date(shown.capturedAt).toLocaleString("zh-CN") : "暂无可用行情");

  const leagueGroups: SelectGroup[] | undefined = leagueCatalog
    ? [false, true].map((permanent) => ({
        label: permanent ? "永久区" : "赛季",
        options: leagueCatalog.leagues
          .filter((option) => option.permanent === permanent)
          .map((option) => ({ value: option.id, label: option.label })),
      }))
    : undefined;
  if (league && leagueGroups && !leagueCatalog?.leagues.some((option) => option.id === league)) {
    leagueGroups.unshift({ label: "方案原有赛季", options: [{ value: league, label: league }] });
  }
  const leagueOptions = leagueCatalog || !league ? undefined : [{ value: league, label: league }];

  return (
    <Panel
      id="module-season"
      title="赛季与行情"
      description="赛季决定行情、价格区间和生成版本。换赛季后方案保留原有赛季，可以手动切换。"
      bodyClassName="p-3"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex w-full max-w-xl items-center gap-2 sm:max-w-sm">
          <Select
            value={league}
            onValueChange={selectLeague}
            groups={leagueGroups}
            options={leagueOptions}
            disabled={loading}
            ariaLabel="选择赛季"
            placeholder="等待赛季列表"
          />
          <IconButton label="刷新行情" variant="secondary" disabled={loading} onClick={() => void refreshMarket()}>
            <RefreshCw aria-hidden="true" className={loading ? "animate-spin" : undefined} />
          </IconButton>
        </div>
        <Badge tone={tone} className="h-6 min-w-0 max-w-full" title={statusText}>
          <StatusDot tone={tone} className={loading ? "animate-pulse" : undefined} />
          <span className="truncate">{statusText}</span>
        </Badge>
        {originalLeague && originalLeague !== league && (
          <p className="text-xs whitespace-nowrap text-gold-bright">原始赛季：{originalLeague}</p>
        )}
      </div>
    </Panel>
  );
}

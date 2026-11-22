"use client";

import type { FilterProfile, LeagueCatalog, MarketSnapshot } from "../../../lib/types";
import { Select, type SelectGroup } from "../ui/controls";
import { Button, Panel, Skeleton, StatusDot } from "../ui/primitives";

export function SeasonSection({
  profile,
  leagueCatalog,
  leaguesLoading,
  marketLoading,
  marketError,
  selectedMarket,
  onLeagueChange,
  onRefresh,
}: {
  profile: FilterProfile;
  leagueCatalog: LeagueCatalog | null;
  leaguesLoading: boolean;
  marketLoading: boolean;
  marketError: string;
  selectedMarket: MarketSnapshot;
  onLeagueChange: (league: string) => void;
  onRefresh: () => void;
}) {
  const loading = leaguesLoading || marketLoading;
  const usable = selectedMarket.rates && Date.parse(selectedMarket.expiresAt) >= Date.now();
  const tone = loading ? "gold" : marketError ? "ember" : usable ? "sage" : "muted";
  const statusText = loading
    ? "正在加载 " + profile.league + " 行情…"
    : marketError || (selectedMarket.rates ? (usable ? "行情更新：" : "缓存已过期 · ") + new Date(selectedMarket.capturedAt).toLocaleString("zh-CN") : "暂无可用行情");

  const leagueGroups: SelectGroup[] | undefined = leagueCatalog
    ? [false, true].map((permanent) => ({
        label: permanent ? "永久区" : "赛季",
        options: leagueCatalog.leagues
          .filter((option) => option.permanent === permanent)
          .map((option) => ({ value: option.id, label: option.label })),
      }))
    : undefined;
  if (profile.league && leagueGroups && !leagueCatalog?.leagues.some((option) => option.id === profile.league)) {
    leagueGroups.unshift({ label: "方案原有赛季", options: [{ value: profile.league, label: profile.league }] });
  }
  const leagueOptions = leagueCatalog || !profile.league ? undefined : [{ value: profile.league, label: profile.league }];

  return (
    <Panel className="p-4 sm:p-5">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,22rem)] lg:items-center">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-ink">选择赛季</h2>
          <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">
            赛季决定行情、价格区间和生成版本。旧赛季方案会保留原有赛季，可手动切换。
          </p>
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-0 flex-1">
              <Select
                value={profile.league}
                onValueChange={onLeagueChange}
                groups={leagueGroups}
                options={leagueOptions}
                disabled={loading}
                ariaLabel="选择赛季"
                placeholder="等待赛季列表"
              />
            </div>
            <Button size="sm" disabled={loading} onClick={onRefresh}>刷新行情</Button>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <StatusDot tone={tone} className={loading ? "animate-pulse" : undefined} />
            {loading && !marketError ? (
              <Skeleton className="h-3 w-40" />
            ) : (
              <p className="truncate text-xs leading-relaxed text-ink-muted" role="status">
                {statusText}
              </p>
            )}
          </div>
          {profile.originalLeague && profile.originalLeague !== profile.league && (
            <p className="mt-1.5 text-xs text-gold">原始赛季：{profile.originalLeague}</p>
          )}
        </div>
      </div>
    </Panel>
  );
}

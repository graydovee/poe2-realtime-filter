"use client";

import type { FilterProfile, LeagueCatalog, MarketSnapshot } from "../../../lib/types";
import { Select, type SelectGroup } from "../ui/controls";
import { Panel, Skeleton, StatusDot } from "../ui/primitives";

export function SeasonSection({
  profile,
  leagueCatalog,
  leaguesLoading,
  marketLoading,
  marketError,
  selectedMarket,
  onLeagueChange,
}: {
  profile: FilterProfile;
  leagueCatalog: LeagueCatalog | null;
  leaguesLoading: boolean;
  marketLoading: boolean;
  marketError: string;
  selectedMarket: MarketSnapshot;
  onLeagueChange: (league: string) => void;
}) {
  const loading = leaguesLoading || marketLoading;
  const tone = loading ? "gold" : marketError ? "ember" : selectedMarket.rates ? "sage" : "muted";
  const statusText = loading
    ? "正在加载 " + profile.league + " 行情…"
    : marketError || (selectedMarket.rates ? "行情更新：" + new Date(selectedMarket.capturedAt).toLocaleString("zh-CN") : "暂无可用行情");

  const leagueGroups: SelectGroup[] | undefined = leagueCatalog
    ? [false, true].map((permanent) => ({
        label: permanent ? "永久区" : "赛季",
        options: leagueCatalog.leagues
          .filter((option) => option.permanent === permanent)
          .map((option) => ({ value: option.id, label: option.label })),
      }))
    : undefined;
  const leagueOptions = leagueCatalog ? undefined : [{ value: profile.league, label: profile.league }];

  return (
    <Panel className="p-4 sm:p-5">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,22rem)] lg:items-center">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-gold">当前行情范围</p>
          <h2 className="mt-1.5 text-[15px] font-semibold tracking-tight text-ink">选择赛季</h2>
          <p className="mt-1.5 text-[11px] leading-relaxed text-ink-muted">
            赛季决定行情、价格区间和生成版本。赛季结束后，已保存方案会保留原始赛季并自动归入对应永久区。
          </p>
        </div>
        <div className="min-w-0">
          <Select
            value={profile.league}
            onValueChange={onLeagueChange}
            groups={leagueGroups}
            options={leagueOptions}
            disabled={leaguesLoading}
            ariaLabel="选择赛季"
          />
          <div className="mt-2 flex items-center gap-2">
            <StatusDot tone={tone} className={loading ? "animate-pulse" : undefined} />
            {loading && !marketError ? (
              <Skeleton className="h-3 w-40" />
            ) : (
              <p className="truncate text-[11px] leading-relaxed text-ink-muted" role="status">
                {statusText}
              </p>
            )}
          </div>
          {profile.originalLeague && profile.originalLeague !== profile.league && (
            <p className="mt-1.5 text-[11px] text-gold/80">原始赛季：{profile.originalLeague}</p>
          )}
        </div>
      </div>
    </Panel>
  );
}

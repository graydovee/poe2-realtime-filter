"use client";

import { Download, FileArchive, Sparkles } from "lucide-react";

import type { FilterProfile, MarketSnapshot } from "../../lib/types";
import { SaveAsScheme } from "./save-as-scheme";
import { Disclosure } from "./ui/nav";
import { Alert, Button, EmptyState, Panel } from "./ui/primitives";

export type Generated = {
  filterFile: string;
  fileName: string;
  baselineFile: string;
  appliedPresets: Array<{ presetId: string; presetName: string; itemCount: number }>;
  safetyReport: {
    passed: boolean;
    warnings: string[];
    unknownItems: number;
    unpricedItems: number;
    ambiguousItems: number;
    hiddenHighValueItems: string[];
    coveredItems: number;
    catalogSize: number;
  };
  market: MarketSnapshot;
};

export function PreviewView({
  generated,
  profile,
  sounds,
  onGenerate,
  onDownload,
  onBundle,
  busy,
}: {
  generated: Generated | null;
  profile: FilterProfile;
  sounds: Record<string, File>;
  onGenerate: () => void;
  onDownload: () => void;
  onBundle: () => Promise<void>;
  busy: boolean;
}) {
  if (!generated) {
    return (
      <Panel className="p-0">
        <EmptyState
          icon={<Sparkles aria-hidden="true" className="size-6" />}
          title="还没有生成过滤器"
          description="在配置页设置规则后，生成并下载 .filter 文件或包含音效的 ZIP。"
          action={
            <Button variant="primary" onClick={onGenerate} disabled={busy}>
              {busy ? "生成中…" : "开始生成"}
            </Button>
          }
        />
      </Panel>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(18rem,0.5fr)]">
      <Panel className="min-w-0">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold">生成结果</span>
            <h2 className="mt-1 truncate font-mono text-sm text-ink">{generated.fileName}</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" size="sm" onClick={onDownload}>
              <Download aria-hidden="true" className="size-3.5" />
              下载 .filter
            </Button>
            <Button variant="secondary" size="sm" onClick={() => void onBundle()}>
              <FileArchive aria-hidden="true" className="size-3.5" />
              导出 ZIP
            </Button>
            <SaveAsScheme profile={profile} sounds={sounds} />
          </div>
        </div>

        {!generated.safetyReport.passed && (
          <Alert tone="ember" title="生成结果存在规则冲突" className="mb-4">
            请检查白名单和隐藏规则后重新生成。
          </Alert>
        )}

        <pre className="filter-code">{generated.filterFile.slice(0, 16000)}</pre>
      </Panel>

      <aside className="flex flex-col gap-4">
        <Panel>
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold">模板与行情</span>
          <h3 className="mt-2 break-words font-mono text-xs leading-relaxed text-ink">{generated.baselineFile}</h3>
          <dl className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-[11px]">
            <dt className="text-ink-muted">赛季</dt>
            <dd className="text-right text-ink/90">{generated.market.league}</dd>
            <dt className="text-ink-muted">市场来源</dt>
            <dd className="text-right text-ink/90">{generated.market.rates ? "poe.ninja" : "暂无可用行情"}</dd>
            <dt className="text-ink-muted">抓取时间</dt>
            <dd className="text-right text-ink/90">
              {generated.market.rates ? new Date(generated.market.capturedAt).toLocaleString("zh-CN") : "尚未更新"}
            </dd>
            <dt className="text-ink-muted">汇率</dt>
            <dd className="text-right font-mono text-ink/90">
              {generated.market.rates
                ? "1D = " + generated.market.rates.divineToChaos + "C / " + generated.market.rates.divineToExalted + "E"
                : "无有效汇率"}
            </dd>
          </dl>
        </Panel>

        <Panel className="p-4">
          <Disclosure summary="数据说明">
            <div className="space-y-2 pb-1 text-[11px] leading-relaxed text-ink-muted">
              <p>
                目录 {generated.safetyReport.catalogSize} 项 · 未定价 {generated.safetyReport.unpricedItems} 项 · 按原始规则处理{" "}
                {generated.safetyReport.ambiguousItems} 项
              </p>
              {generated.safetyReport.warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          </Disclosure>
        </Panel>
      </aside>
    </div>
  );
}

"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Copy, WrapText } from "lucide-react";

import { cn } from "../../lib/cn";
import { tokenizeFilter, type FilterLine, type FilterToken } from "../../lib/filter-highlight";
import type { Generated } from "../state/types";
import { Alert } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button, IconButton } from "./ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { toast } from "./ui/toast";

function tokenClass(token: FilterToken) {
  if (token.kind === "rule") return /^hide$/i.test(token.text) ? "font-semibold text-ember" : "font-semibold text-gold-bright";
  const classes = {
    prop: "text-ink",
    op: "text-ink-muted",
    num: "text-gold/90",
    str: "text-sage",
    value: "text-ink-muted",
    comment: "text-ink-faint italic",
  } as const;
  return classes[token.kind];
}

function FilterCode({ code }: { code: string }) {
  const [wrap, setWrap] = useState(false);
  const lines = useMemo(() => tokenizeFilter(code), [code]);
  return (
    <div className="overflow-hidden rounded-lg border border-line">
      <div className="flex items-center justify-between gap-2 border-b border-line bg-surface-2 px-3 py-1.5">
        <span className="font-mono text-xs text-ink-faint">{lines.length} 行</span>
        <div className="flex items-center gap-1">
          <IconButton
            label={wrap ? "取消自动换行" : "自动换行"}
            size="icon-sm"
            aria-pressed={wrap}
            onClick={() => setWrap((current) => !current)}
          >
            <WrapText aria-hidden="true" />
          </IconButton>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              navigator.clipboard.writeText(code).then(
                () => toast.success("过滤器内容已复制"),
                () => toast.error("复制失败，请在文本里手动选择复制"),
              )
            }
          >
            <Copy aria-hidden="true" />
            复制代码
          </Button>
        </div>
      </div>
      <div
        role="region"
        aria-label="过滤器内容"
        tabIndex={0}
        className="max-h-[60dvh] overflow-auto bg-bg p-3 font-mono text-xs leading-relaxed"
      >
        {lines.map((line, index) => (
          <Line key={index} line={line} wrap={wrap} />
        ))}
      </div>
    </div>
  );
}

function Line({ line, wrap }: { line: FilterLine; wrap: boolean }) {
  if (line.type === "blank") return <div className={wrap ? "min-h-[1.625em]" : "h-[1.625em]"} />;
  const startsBlock = line.type === "rule";
  return (
    <div
      className={cn(
        "py-0.5 pr-2",
        wrap ? "whitespace-pre-wrap [overflow-wrap:anywhere]" : "whitespace-pre",
        startsBlock && "mt-1 border-t border-line/60 pt-1.5 first:mt-0 first:border-t-0 first:pt-0.5",
      )}
    >
      {line.indent}
      {line.tokens.map((token, index) => (
        <span key={index} className={tokenClass(token)}>
          {token.text}
        </span>
      ))}
    </div>
  );
}

function Facts({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-1.5 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-ink-muted">{label}</dt>
          <dd className="min-w-0 text-right text-ink [overflow-wrap:anywhere]">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function RulesTab({ generated }: { generated: Generated }) {
  const report = generated.safetyReport;
  const covered = report.coveredRules ?? [];
  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <section className="rounded-lg border border-line bg-surface-2/60 p-4">
        <h3 className="mb-3 text-sm font-semibold text-ink">应用的规则</h3>
        {generated.appliedRules.length ? (
          <ul className="space-y-1.5">
            {generated.appliedRules.map((rule) => (
              <li key={rule.ruleId} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate text-ink">{rule.ruleName}</span>
                <span className="shrink-0 font-mono text-xs text-ink-muted">{rule.itemCount} 项</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-muted">没有应用任何自定义规则。</p>
        )}
      </section>
      <div className="grid content-start gap-4">
        {covered.length > 0 && (
          <Alert tone="gold" title={`有 ${covered.length} 条规则被排在前面的规则完全覆盖`}>
            <ul className="list-disc pl-4">
              {covered.map((rule) => (
                <li key={rule.ruleId}>{rule.ruleName}</li>
              ))}
            </ul>
          </Alert>
        )}
        {report.warnings.map((warning) => (
          <Alert key={warning} tone="gold">{warning}</Alert>
        ))}
        {report.hiddenHighValueItems.length > 0 && (
          <Alert tone="ember" title="以下高价值物品被隐藏规则命中">
            <p className="break-words">{report.hiddenHighValueItems.join("、")}</p>
          </Alert>
        )}
        {report.passed && !covered.length && !report.warnings.length && <Alert tone="sage">没有发现规则冲突或警告。</Alert>}
      </div>
    </div>
  );
}

/** 生成预览：过滤器内容（带语法着色）、应用的规则与安全检查、模板与行情。 */
export function PreviewView({ generated }: { generated: Generated }) {
  const report = generated.safetyReport;
  const market = generated.market;
  return (
    <div className="grid gap-4">
      {report.passed ? (
        <Alert tone="sage" role="status" title="安全检查通过" />
      ) : (
        <Alert tone="ember" title="生成结果存在规则冲突">
          请检查自定义规则与隐藏规则后重新生成。
        </Alert>
      )}
      <Tabs defaultValue="code">
        <TabsList>
          <TabsTrigger value="code">过滤器内容</TabsTrigger>
          <TabsTrigger value="rules">
            规则与安全
            {!report.passed && <Badge tone="ember" className="ml-1">!</Badge>}
          </TabsTrigger>
          <TabsTrigger value="market">模板与行情</TabsTrigger>
        </TabsList>
        <TabsContent value="code">
          <FilterCode code={generated.filterFile} />
        </TabsContent>
        <TabsContent value="rules">
          <RulesTab generated={generated} />
        </TabsContent>
        <TabsContent value="market">
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-lg border border-line bg-surface-2/60 p-4">
              <h3 className="mb-3 text-sm font-semibold text-ink">模板</h3>
              <p className="break-all font-mono text-xs leading-relaxed text-ink">{generated.baselineFile || "仅自定义规则"}</p>
            </section>
            <section className="rounded-lg border border-line bg-surface-2/60 p-4">
              <h3 className="mb-3 text-sm font-semibold text-ink">行情</h3>
              <Facts
                rows={[
                  ["赛季", market.league],
                  ["市场来源", market.rates ? market.source : "暂无可用行情"],
                  ["抓取时间", market.rates ? new Date(market.capturedAt).toLocaleString("zh-CN") : "尚未更新"],
                  [
                    "汇率",
                    market.rates ? `1D = ${market.rates.divineToChaos}C / ${market.rates.divineToExalted}E` : "无有效汇率",
                  ],
                ]}
              />
            </section>
            <section className="rounded-lg border border-line bg-surface-2/60 p-4 lg:col-span-2">
              <h3 className="mb-3 text-sm font-semibold text-ink">数据说明</h3>
              <Facts
                rows={[
                  ["物品目录", `${report.catalogSize} 项`],
                  ["未定价", `${report.unpricedItems} 项`],
                  ["未能识别", `${report.unknownItems} 项`],
                ]}
              />
            </section>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

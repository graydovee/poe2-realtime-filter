"use client";

import { Fragment } from "react";
import { ArrowRight } from "lucide-react";

import { LOCALE_LABELS, STRICTNESS_LABELS, STYLE_LABELS } from "../../../lib/data";
import type { FilterProfile } from "../../../lib/types";
import { Alert, Button, Panel } from "../ui/primitives";

export function SummarySidebar({
  profile,
  busy,
  disabled,
  error,
  onGenerate,
}: {
  profile: FilterProfile;
  busy: boolean;
  disabled: boolean;
  error: string;
  onGenerate: () => void;
}) {
  const rules = profile.rules ?? [];
  const rows: Array<[string, string]> = [
    ["赛季", profile.league],
    ["基础档位", STRICTNESS_LABELS[profile.strictness]],
    ["视觉风格", STYLE_LABELS[profile.style]],
    ["客户端语言", LOCALE_LABELS[profile.locale]],
    ["自定义规则", rules.length + " 条（启用 " + rules.filter((rule) => rule.enabled).length + "）"],
    ["隐藏规则", rules.filter((rule) => rule.enabled && rule.hidden).length + " 条"],
    ["跳过物品", profile.skippedItemIds.length + " 项"],
  ];

  return (
    <aside className="flex flex-col gap-4 lg:sticky lg:top-6 lg:self-start">
      <Panel>
        <h2 className="text-sm font-semibold tracking-tight text-ink">当前配置</h2>
        <dl className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-3 text-xs leading-relaxed">
          {rows.map(([label, value]) => (
            <Fragment key={label}>
              <dt className="text-ink-muted">{label}</dt>
              <dd className="m-0 break-words text-right text-ink">{value}</dd>
            </Fragment>
          ))}
        </dl>
      </Panel>

      <Button
        variant="primary"
        size="lg"
        className="w-full justify-between"
        onClick={onGenerate}
        disabled={busy || disabled}
      >
        <span>{busy ? "生成中…" : "生成过滤器"}</span>
        <ArrowRight aria-hidden="true" className="size-4" />
      </Button>

      {error && <Alert tone="ember">{error}</Alert>}
    </aside>
  );
}
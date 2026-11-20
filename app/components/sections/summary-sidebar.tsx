"use client";

import { Fragment } from "react";
import { ArrowRight } from "lucide-react";

import { LOCALE_LABELS, STRICTNESS_LABELS, STYLE_LABELS } from "../../../lib/data";
import type { Currency, FilterProfile } from "../../../lib/types";
import { Alert, Button, Panel } from "../ui/primitives";

const currencyShort: Record<Currency, string> = { divine: "D", chaos: "C", exalted: "E" };

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
  const rows: Array<[string, string]> = [
    ["赛季", profile.league],
    ["基础档位", STRICTNESS_LABELS[profile.strictness]],
    ["视觉风格", STYLE_LABELS[profile.style]],
    ["客户端语言", LOCALE_LABELS[profile.locale]],
    ["白名单", profile.whitelist.flatMap((entry) => entry.itemIds).length + " 项"],
    ["启用光效", profile.visualPresets.filter((preset) => preset.enabled).length + " / " + profile.visualPresets.length],
    [
      "低价值隐藏",
      profile.hideBelowEnabled ? "低于 " + profile.hideBelowAmount + " " + currencyShort[profile.hideBelowCurrency] : "未启用",
    ],
  ];

  return (
    <aside className="flex flex-col gap-4 lg:sticky lg:top-6">
      <Panel>
        <h2 className="text-sm font-semibold tracking-tight text-ink">当前配置</h2>
        <dl className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-3 text-[11px] leading-relaxed">
          {rows.map(([label, value]) => (
            <Fragment key={label}>
              <dt className="text-ink-muted">{label}</dt>
              <dd className="break-words text-right text-ink/90">{value}</dd>
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

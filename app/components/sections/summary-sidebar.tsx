"use client";

import { Fragment } from "react";
import { ArrowRight } from "lucide-react";

import type { FilterProfile } from "../../../lib/types";
import { Alert, Button, Panel } from "../ui/primitives";

export function SummarySidebar({
  profile,
  saving,
  previewing,
  error,
  onSave,
  onPreview,
  onCancel,
  showActions = true,
}: {
  profile: FilterProfile;
  saving: boolean;
  previewing: boolean;
  error: string;
  onSave: () => void;
  onPreview: () => void;
  onCancel: () => void;
  showActions?: boolean;
}) {
  const rules = profile.rules ?? [];
  const rows: Array<[string, string]> = [
    ["赛季", profile.league],
    ["基础过滤器", profile.baseFilter?.name ?? (profile.baseFilterHint ? "待选择" : "仅自定义规则")],
    ["自定义规则", rules.length + " 条（启用 " + rules.filter((rule) => rule.enabled).length + "）"],
    ["隐藏规则", rules.filter((rule) => rule.enabled && rule.hidden).length + " 条"],
  ];
  if (profile.baseFilter) rows.push(["跳过物品", profile.skippedItemIds.length + " 项"]);

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

      {showActions && <>
        <Button
          variant="primary"
          size="lg"
          className="w-full justify-between"
          onClick={onSave}
          disabled={saving}
        >
          <span>{saving ? "保存中…" : "保存方案"}</span>
          <ArrowRight aria-hidden="true" className="size-4" />
        </Button>

        <div className="grid grid-cols-2 gap-2">
          <Button onClick={onPreview} disabled={saving || previewing}>预览</Button>
          <Button onClick={onCancel} disabled={saving}>取消</Button>
        </div>
      </>}

      {error && <Alert tone="ember">{error}</Alert>}
    </aside>
  );
}

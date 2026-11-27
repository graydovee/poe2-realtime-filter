"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { EyeOff, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { blockKey, type BaseRuleView } from "../../../lib/base-overlays";
import type { BaseOverlay } from "../../../lib/types";
import { cn } from "../../../lib/cn";
import { effectiveRule, useBaseEdits } from "../../state/base-edits";
import { useAppStore } from "../../state/store";
import { Alert } from "../ui/alert";
import { Badge } from "../ui/badge";
import { IconButton } from "../ui/button";
import { SearchInput } from "../ui/input";
import { Tooltip } from "../ui/tooltip";

type Row =
  | { kind: "label"; id: string; text: string; tone: "muted" | "ember" }
  | { kind: "rule"; id: string; rule: BaseRuleView; edit?: BaseOverlay }
  | { kind: "edit"; id: string; overlay: BaseOverlay; reason: string };

const rowHeight = (row: Row) => (row.kind === "label" ? 24 : 46);
/** 条件里第一行物品或类别条件以外的部分；规则的名字已经说了匹配什么，第二行只列其余的。 */
const extraConditions = (conditions: string[]) => {
  const first = conditions.find((line) => /^(BaseType|Class)\b/.test(line));
  return conditions.filter((line) => line !== first).join(" · ");
};
const selectedClass = "border-gold/60 bg-gold/8";
const plainClass = "border-transparent hover:bg-surface-3/60";

/** 基础过滤器里的规则，按分节列出，可以搜索。失效的修改列在最前面。选中一条后右侧编辑它。 */
export function BaseRuleList() {
  const baseRules = useAppStore((state) => state.baseRules);
  const baseRulesError = useAppStore((state) => state.baseRulesError);
  const overlays = useAppStore((state) => state.profile.overlays);
  const editsOn = useAppStore((state) => state.profile.editsEnabled !== false);
  const activeBase = useAppStore((state) => state.activeBase);
  const setActiveBase = useAppStore((state) => state.setActiveBase);
  const removeOverlay = useAppStore((state) => state.removeOverlay);
  const undoRemoveOverlay = useAppStore((state) => state.undoRemoveOverlay);
  const byKey = useBaseEdits();
  const [query, setQuery] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  const rows = useMemo<Row[]>(() => {
    if (!baseRules) return [];
    const search = query.trim().toLowerCase();
    const next: Row[] = [];
    // 规则表是读取时的快照；之后新粘贴的修改还没有状态，下一次读取才会出现。
    const stale = overlays.filter((overlay) => baseRules.overlays[overlay.id]?.state === "invalid");
    if (stale.length) {
      next.push({ kind: "label", id: "stale", text: `失效的修改 · ${stale.length} 处`, tone: "ember" });
      for (const overlay of stale) {
        if (search && !overlay.conditions.join("\n").toLowerCase().includes(search)) continue;
        next.push({ kind: "edit", id: overlay.id, overlay, reason: (baseRules.overlays[overlay.id] as { reason: string }).reason });
      }
    }
    let section: string | undefined;
    for (const rule of baseRules.rules) {
      const edit = byKey.get(blockKey(rule.conditions));
      const haystack = [rule.label, rule.section, rule.comment, ...effectiveRule(rule, edit, editsOn).conditions].join("\n").toLowerCase();
      if (search && !haystack.includes(search)) continue;
      if (rule.section !== section) {
        section = rule.section;
        if (section) next.push({ kind: "label", id: `section:${rule.index}`, text: section, tone: "muted" });
      }
      next.push({ kind: "rule", id: `rule:${rule.index}`, rule, edit });
    }
    return next;
  }, [baseRules, overlays, byKey, query, editsOn]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => rowHeight(rows[index]),
    overscan: 8,
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [query]);

  // 用方向键移动选中时，让选中的规则留在可见范围里。
  useEffect(() => {
    if (activeBase?.kind !== "rule") return;
    const index = rows.findIndex((row) => row.id === `rule:${activeBase.index}`);
    if (index >= 0) virtualizer.scrollToIndex(index, { align: "auto" });
  }, [activeBase, rows, virtualizer]);

  function remove(overlay: BaseOverlay) {
    removeOverlay(overlay.id);
    toast("已删除这处修改", { action: { label: "撤销", onClick: undoRemoveOverlay } });
  }

  return (
    <section aria-labelledby={titleId} className="border-t border-line pt-2">
      <div className="flex items-center justify-between gap-2">
        <h3 id={titleId} className="text-xs font-semibold tracking-wide text-ink-muted">基础过滤器规则</h3>
        {baseRules && <span className="font-mono text-xs text-ink-faint">{baseRules.rules.length} 条</span>}
      </div>
      <SearchInput
        className="mt-2"
        aria-label="搜索基础过滤器规则"
        placeholder="搜索规则、分节或条件"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {baseRulesError ? (
        <Alert tone="ember" className="mt-2">{baseRulesError}</Alert>
      ) : !baseRules ? (
        <p role="status" className="mt-2 px-1 py-6 text-center text-xs text-ink-muted">正在读取基础过滤器的规则…</p>
      ) : rows.length === 0 ? (
        <p className="mt-2 px-1 py-6 text-center text-xs text-ink-muted">没有匹配的规则。换一个关键词，或清空搜索。</p>
      ) : (
        <div
          ref={scrollRef}
          aria-label="基础过滤器规则列表"
          className="mt-2 max-h-[26rem] overflow-y-auto overscroll-contain rounded-md border border-line bg-surface-2/50 p-1.5"
        >
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((virtual) => {
              const row = rows[virtual.index];
              return (
                <div
                  key={row.id}
                  style={{ position: "absolute", top: 0, left: 0, width: "100%", height: virtual.size, transform: `translateY(${virtual.start}px)` }}
                >
                  {row.kind === "label" ? (
                    <div className={cn("flex h-full items-center truncate px-2 text-xs font-semibold", row.tone === "ember" ? "text-ember" : "text-ink-faint")} title={row.text}>
                      {row.text}
                    </div>
                  ) : row.kind === "rule" ? (
                    <RuleRow
                      rule={row.rule}
                      edit={row.edit}
                      editsOn={editsOn}
                      selected={activeBase?.kind === "rule" && activeBase.index === row.rule.index}
                      onSelect={() => setActiveBase({ kind: "rule", index: row.rule.index })}
                    />
                  ) : (
                    <StaleRow
                      overlay={row.overlay}
                      reason={row.reason}
                      selected={activeBase?.kind === "edit" && activeBase.id === row.overlay.id}
                      onSelect={() => setActiveBase({ kind: "edit", id: row.overlay.id })}
                      onRemove={editsOn ? () => remove(row.overlay) : undefined}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

function RuleRow({ rule, edit, editsOn, selected, onSelect }: {
  rule: BaseRuleView;
  edit?: BaseOverlay;
  editsOn: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  // 总开关关闭时，所有修改都按关闭显示。
  const active = editsOn && Boolean(edit?.enabled);
  // 改过的条件生效时才在第二行标出来。
  const editedLines = active ? edit?.conditionLines : undefined;
  const view = effectiveRule(rule, edit, editsOn);
  return (
    <button
      type="button"
      aria-current={selected ? "true" : undefined}
      onClick={onSelect}
      title={rule.comment || undefined}
      className={cn(
        "flex h-full w-full cursor-pointer flex-col justify-center gap-0.5 rounded-md border px-2 text-left transition-colors duration-150",
        selected ? selectedClass : plainClass,
      )}
    >
      <span className="flex items-center gap-2 text-sm">
        <span className="w-6 shrink-0 truncate font-mono text-xs text-ink-faint">{rule.index + 1}</span>
        <span className={cn("min-w-0 flex-1 truncate", edit ? "font-medium text-ink" : "text-ink-muted")}>{rule.label}</span>
        {view.hidden && (
          <Tooltip label="隐藏物品">
            <EyeOff aria-hidden="true" className="size-3.5 shrink-0 text-ember" />
          </Tooltip>
        )}
        {edit ? (
          <Badge tone={active ? "gold" : "muted"}>{active ? "已修改" : "已关闭"}</Badge>
        ) : (
          <Badge tone="muted">基础</Badge>
        )}
      </span>
      <span className="line-clamp-1 pl-8 text-xs leading-snug text-ink-muted">
        {editedLines !== undefined ? <><span className="text-gold-bright">条件已改 · </span>{extraConditions(editedLines)}</> : rule.detail}
      </span>
    </button>
  );
}

function StaleRow({ overlay, reason, selected, onSelect, onRemove }: {
  overlay: BaseOverlay;
  reason: string;
  selected: boolean;
  onSelect: () => void;
  /** 总开关关闭时没有删除按钮。 */
  onRemove?: () => void;
}) {
  return (
    <div className={cn("flex h-full items-center gap-1 rounded-md border pr-1 pl-2 transition-colors duration-150", selected ? selectedClass : "border-ember/20 hover:bg-surface-3/60")}>
      <button type="button" aria-current={selected ? "true" : undefined} onClick={onSelect} className="flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5 py-1.5 text-left">
        <span className="flex items-center gap-2 text-sm">
          <Tooltip label={reason}>
            <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0 text-ember" />
          </Tooltip>
          <span className="min-w-0 flex-1 truncate font-medium text-ink">失效的修改</span>
          <Badge tone="ember">已失效</Badge>
        </span>
        <span className="line-clamp-1 pl-[22px] font-mono text-xs leading-snug text-ink-muted" title={overlay.conditions.join("\n")}>
          {overlay.conditions.join(" · ")}
        </span>
      </button>
      {onRemove && (
        <IconButton label="删除这处修改" variant="danger" size="icon-sm" onClick={onRemove}>
          <Trash2 aria-hidden="true" className="size-3.5" />
        </IconButton>
      )}
    </div>
  );
}

import { summarizeDrop } from "../../../lib/drop-conditions";
import { formatUnit } from "../../../lib/pricing";
import type { FilterRule } from "../../../lib/types";

/** 规则匹配条件的中文摘要，用于规则列表。 */
export function ruleSummary(rule: FilterRule) {
  const { itemIds, itemEnabled, priceEnabled, range } = rule.target;
  const parts: string[] = [];
  if (itemIds.length && itemEnabled !== false) parts.push(`${itemIds.length} 项物品`);
  if (range && priceEnabled !== false) {
    const min = range.min ? `≥ ${formatUnit(range.min)}` : "";
    const max = range.max ? `< ${formatUnit(range.max)}` : "";
    parts.push(["单件价格", min, max].filter(Boolean).join(" "));
  }
  parts.push(...summarizeDrop(rule.target.dropConditions));
  return parts.join(" · ") || "选择匹配条件";
}

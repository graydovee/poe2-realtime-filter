import { DEFAULT_PROFILE } from "./default-profile";
import { normalizeLeague } from "./market";
import type { FilterProfile, FilterRule } from "./types";

/**
 * 请求体 / 数据库里的方案归一：补齐默认字段、统一赛季名。
 * 旧版方案（whitelist + visualPresets）不再支持，缺失 rules 时直接报错。
 */
export function normalizeProfile(input: unknown): FilterProfile {
  const raw = (input ?? {}) as Partial<FilterProfile>;
  if (!Array.isArray(raw.rules)) throw new Error("方案格式已更新，请重新添加自定义过滤规则");
  const league = normalizeLeague(raw.league ?? process.env.POE2_LEAGUE ?? DEFAULT_PROFILE.league);
  const rules = raw.rules.map((rule) => {
    const candidate = (rule ?? {}) as FilterRule;
    return {
      ...candidate,
      target: {
        itemIds: Array.isArray(candidate.target?.itemIds) ? candidate.target!.itemIds : [],
        ...(candidate.target?.range ? { range: candidate.target.range } : {}),
        ...(candidate.target?.itemEnabled === false ? { itemEnabled: false } : {}),
        ...(candidate.target?.priceEnabled === false ? { priceEnabled: false } : {}),
      },
      effects: candidate.effects ?? {},
    } as FilterRule;
  });
  return {
    ...DEFAULT_PROFILE,
    ...raw,
    schemaVersion: 2,
    league,
    originalLeague: typeof raw.originalLeague === "string" && raw.originalLeague.trim() ? raw.originalLeague.trim() : league,
    rules,
    skippedItemIds: Array.isArray(raw.skippedItemIds) ? raw.skippedItemIds : [],
  };
}

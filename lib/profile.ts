import { DEFAULT_PROFILE } from "./default-profile";
import type { FilterProfile, FilterRule } from "./types";

/**
 * 请求体 / 数据库里的方案归一：补齐默认字段、统一赛季名。
 * 旧版方案（whitelist + visualPresets）不再支持，缺失 rules 时直接报错。
 */
export function normalizeProfile(input: unknown): FilterProfile {
  const raw = (input ?? {}) as Partial<FilterProfile>;
  if (!Array.isArray(raw.rules)) throw new Error("方案格式已更新，请重新添加自定义过滤规则");
  const league = normalizeLeague(raw.league ?? DEFAULT_PROFILE.league);
  if (raw.schemaVersion !== 2) throw new Error("不支持的方案格式版本");
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
    baseFilter: raw.baseFilter,
    baseFilterHint: raw.baseFilterHint,
    strictness: raw.strictness ?? DEFAULT_PROFILE.strictness,
    style: raw.style ?? DEFAULT_PROFILE.style,
    locale: raw.locale ?? DEFAULT_PROFILE.locale,
    schemaVersion: 2,
    league,
    originalLeague: typeof raw.originalLeague === "string" && raw.originalLeague.trim() ? normalizeLeague(raw.originalLeague) : league,
    rules,
    skippedItemIds: Array.isArray(raw.skippedItemIds) ? raw.skippedItemIds : [],
  };
}

export function normalizeLeague(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 120 || /[\x00-\x1f]/.test(value)) throw new Error("无效赛季");
  return value.trim();
}

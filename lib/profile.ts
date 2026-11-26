import rulesData from "../data/default-rules.json";
import { legacyEffectItemId } from "./data";
import { DEFAULT_PROFILE } from "./default-profile";
import type { FilterProfile, FilterRule, PriceCurrency, PricePoint, PriceRange } from "./types";

const legacyEffectSnapshots = new Map(rulesData.rules.map((rule) => [rule.id, rule]));

/** 对比快照的完整内容；JSON 对象里的字段顺序不代表编辑。 */
function sameSnapshot(value: unknown, expected: unknown): boolean {
  if (value === expected) return true;
  if (!value || !expected || typeof value !== "object" || typeof expected !== "object" || Array.isArray(value) || Array.isArray(expected)) return false;
  const saved = value as Record<string, unknown>;
  const original = expected as Record<string, unknown>;
  const keys = Object.keys(original);
  return Object.keys(saved).length === keys.length && keys.every((key) =>
    Object.prototype.hasOwnProperty.call(saved, key) && sameSnapshot(saved[key], original[key]));
}

function normalizeRuleEffects(rule: FilterRule) {
  const legacyItemId = legacyEffectItemId(rule.id);
  if (rule.baselineEffectItemId === undefined && legacyItemId !== undefined) {
    const snapshot = rule.followBaseline === undefined ? legacyEffectSnapshots.get(rule.id) : undefined;
    if (rule.followBaseline === true || (snapshot && rule.effectPresetId === snapshot.effectPresetId
      && sameSnapshot(rule.effects, snapshot.effects))) {
      rule.baselineEffectItemId = legacyItemId;
    }
  }
  if (rule.baselineEffectItemId !== undefined) {
    if (typeof rule.followBaseline === "boolean") delete rule.followBaseline;
    delete rule.effectPresetId;
    rule.effects = {};
  }
  // 显式的 false 要保留：再次读取时，这条规则仍按自己的样式处理。
}

type LegacyPoint = PricePoint & { referenceItemId?: string };

/** 用锚点通货 id 写的价格点（如「1 枚剥离石」），读成计价单位。 */
const LEGACY_UNITS: Record<string, PriceCurrency> = {
  "exalted-orb": "exalted", "chaos-orb": "chaos", "orb-of-annulment": "annulment", "divine-orb": "divine",
};

function normalizePoint(value?: LegacyPoint): PricePoint | undefined {
  if (!value) return undefined;
  const unit = LEGACY_UNITS[value.referenceItemId ?? ""];
  return { amount: value.amount, currency: unit ?? value.currency };
}

/** 非对象的区间原样留着，交给校验报错。 */
function normalizeRange(range: PriceRange): PriceRange {
  if (!range || typeof range !== "object") return range;
  const min = normalizePoint(range.min);
  const max = normalizePoint(range.max);
  return { ...(min ? { min } : {}), ...(max ? { max } : {}) };
}

/** 检查本地方案的规则列表和格式版本，并补齐默认字段、统一赛季名。 */
export function normalizeProfile(input: unknown): FilterProfile {
  const raw = (input ?? {}) as Partial<FilterProfile>;
  if (!Array.isArray(raw.rules)) throw new Error("方案缺少规则列表");
  const server = raw.server;
  if (server !== undefined && server !== "international" && server !== "tencent") throw new Error("无效游戏服务器");
  const season = (value: unknown) => normalizeLeague(value, server === "tencent");
  const league = server === "tencent" && raw.league === "" ? "" : season(raw.league ?? DEFAULT_PROFILE.league);
  if (raw.schemaVersion !== 2 && raw.schemaVersion !== 3) throw new Error("不支持的方案格式版本");
  const rules = raw.rules.map((entry) => {
    const candidate = (entry ?? {}) as FilterRule & { autoRange?: boolean };
    const rule = {
      ...candidate,
      target: {
        itemIds: Array.isArray(candidate.target?.itemIds) ? candidate.target!.itemIds : [],
        ...(candidate.target?.dropConditions !== undefined ? { dropConditions: candidate.target.dropConditions } : {}),
        ...(candidate.target?.range ? { range: normalizeRange(candidate.target.range) } : {}),
        ...(candidate.target?.itemEnabled === false ? { itemEnabled: false } : {}),
        ...(candidate.target?.priceEnabled === false ? { priceEnabled: false } : {}),
      },
      effects: candidate.effects ?? {},
    } as FilterRule;
    // 读取时去掉 `autoRange`。
    delete (rule as { autoRange?: boolean }).autoRange;
    normalizeRuleEffects(rule);
    return rule;
  });
  const skippedItemIds = Array.isArray(raw.skippedItemIds) ? raw.skippedItemIds : [];
  const variantId = (id: unknown) => typeof id === "string" && /^(base|unique):/.test(id);
  const version3 = raw.schemaVersion === 3 || skippedItemIds.some(variantId) || rules.some((rule) =>
    rule.target.dropConditions !== undefined || rule.target.itemIds.some(variantId) || variantId(rule.baselineEffectItemId),
  );
  return {
    ...DEFAULT_PROFILE,
    ...(server ? { server } : {}),
    baseFilter: raw.baseFilter,
    baseFilterHint: raw.baseFilterHint,
    strictness: raw.strictness ?? DEFAULT_PROFILE.strictness,
    style: raw.style ?? DEFAULT_PROFILE.style,
    locale: raw.locale ?? DEFAULT_PROFILE.locale,
    schemaVersion: version3 ? 3 : 2,
    league,
    originalLeague: typeof raw.originalLeague === "string" && raw.originalLeague.trim() ? season(raw.originalLeague) : league,
    rules,
    skippedItemIds,
  };
}

export function normalizeLeague(value: unknown, preserve = false): string {
  if (typeof value !== "string" || !value.trim() || value.length > 120 || /[\x00-\x1f]/.test(value)) throw new Error("无效赛季");
  return preserve ? value : value.trim();
}

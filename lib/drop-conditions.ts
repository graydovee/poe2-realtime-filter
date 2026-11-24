import { FILTER_ITEMS_BY_ID } from "./data";
import type { DropBound, DropConditions, DropField, DropNumber, FilterRule, ItemDefinition, ItemRarity } from "./types";

export const DROP_FIELDS = {
  stackSize: { label: "堆叠数量", command: "StackSize", minimum: 1 },
  itemLevel: { label: "物品等级", command: "ItemLevel", minimum: 1 },
  sockets: { label: "孔数", command: "Sockets", minimum: 0 },
  unidentifiedTier: { label: "未鉴定阶级", command: "UnidentifiedItemTier", minimum: 1 },
} satisfies Record<DropField, { label: string; command: string; minimum: number }>;

export const DROP_KEYS = Object.keys(DROP_FIELDS) as DropField[];
export const DROP_OPERATORS = [">=", ">", "=", "<", "<="] as const;
export const RARITIES: ItemRarity[] = ["Normal", "Magic", "Rare", "Unique"];
export const RARITY_LABELS = { Normal: "普通", Magic: "魔法", Rare: "稀有", Unique: "传奇" };

export type Interval = [min: number, max: number];

export function dropInterval(field: DropField, bounds: DropBound[]): Interval {
  let min: number = DROP_FIELDS[field].minimum;
  let max = Infinity;
  for (const { op, value } of bounds) {
    if (op === "=" || op === ">=" || op === ">") min = Math.max(min, value + Number(op === ">"));
    if (op === "=" || op === "<=" || op === "<") max = Math.min(max, value - Number(op === "<"));
  }
  return [min, max];
}

export function rarityInterval(item: ItemDefinition, rarity?: ItemRarity): Interval {
  const fixed = item.matcher.rarity ? RARITIES.indexOf(item.matcher.rarity) : undefined;
  const low = fixed ?? 0;
  const high = fixed ?? (item.matcher.nonUnique ? 2 : 3);
  if (!rarity) return [low, high];
  const value = RARITIES.indexOf(rarity);
  return [Math.max(low, value), Math.min(high, value)];
}

export function supportsDropField(item: ItemDefinition, field: DropField): boolean {
  const [group] = item.categoryPath;
  switch (field) {
    case "stackSize": return Boolean(item.stackable);
    case "sockets": return group === "equipment" && item.categoryPath.some((key) => ["body-armour", "helmets", "gloves", "boots", "weapons", "one-hand", "two-hand", "shields", "bucklers", "foci"].includes(key));
    case "unidentifiedTier": return group === "equipment" && !item.categoryPath.some((key) => ["jewels", "relics"].includes(key)) && item.matcher.rarity !== "Unique";
    case "itemLevel": return true;
  }
}

export function dropConditionsIssue(rule: FilterRule): string | undefined {
  const drop = rule.target.dropConditions;
  if (drop === undefined) return;
  if (!drop || typeof drop !== "object" || Array.isArray(drop)) return "掉落条件格式无效";
  const items = rule.target.itemIds.map((id) => FILTER_ITEMS_BY_ID.get(id)).filter((item): item is ItemDefinition => Boolean(item));
  const active = Object.entries(drop).some(([, entry]) => entry?.enabled === true);
  if (active && (rule.target.itemEnabled === false || !items.length)) return "请为掉落条件选择物品或分类";
  for (const [key, entry] of Object.entries(drop)) {
    if (!entry || typeof entry !== "object" || typeof entry.enabled !== "boolean") return "掉落条件格式无效";
    if (key === "rarity") {
      const rarity = drop.rarity!.value;
      if (!RARITIES.includes(rarity)) return "请选择有效的稀有度";
      if (entry.enabled) {
        const conflict = items.find((item) => { const [lo, hi] = rarityInterval(item, rarity); return lo > hi; });
        if (conflict) return `${conflict.name}与所选稀有度不匹配`;
      }
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(DROP_FIELDS, key)) return "无法识别的掉落条件";
    const field = key as DropField;
    const { label } = DROP_FIELDS[field];
    const bounds = (entry as DropNumber).bounds;
    if (!Array.isArray(bounds) || bounds.length > 2 || (entry.enabled && !bounds.length) || bounds.some((bound) => !bound || !DROP_OPERATORS.includes(bound.op) || !Number.isInteger(bound.value) || bound.value < 0 || bound.value > 2147483647)) return `${label}需要有效的整数和比较方式`;
    if (entry.enabled) {
      const [lo, hi] = dropInterval(field, bounds);
      if (lo > hi) return `${label}区间需要至少包含一个有效数值`;
      const unsupported = items.filter((item) => !supportsDropField(item, field));
      if (unsupported.length) return `${label}不适用于 ${unsupported.slice(0, 3).map((item) => item.name).join("、")}${unsupported.length > 3 ? `等 ${unsupported.length} 项` : ""}`;
      if (field === "unidentifiedTier" && drop.rarity?.enabled && drop.rarity.value !== "Rare") return "未鉴定阶级适用于稀有装备";
    }
  }
}

export function dropLines(conditions?: DropConditions): string[] {
  if (!conditions) return [];
  const lines = DROP_KEYS.flatMap((field) => conditions[field]?.enabled
    ? conditions[field]!.bounds.map(({ op, value }) => `\t${DROP_FIELDS[field].command} ${op} ${value}`) : []);
  if (conditions.rarity?.enabled) lines.push(`\tRarity ${conditions.rarity.value}`);
  if (conditions.unidentifiedTier?.enabled) {
    if (!conditions.rarity?.enabled) lines.push("\tRarity Rare");
    lines.push("\tIdentified False");
  }
  return lines;
}

export function summarizeDrop(conditions?: DropConditions): string[] {
  if (!conditions) return [];
  const labels = DROP_KEYS.flatMap((field) => conditions[field]?.enabled
    ? [`${DROP_FIELDS[field].label} ${conditions[field]!.bounds.map(({ op, value }) => `${op} ${value}`).join(" / ")}`] : []);
  if (conditions.rarity?.enabled) labels.push(RARITY_LABELS[conditions.rarity.value]);
  return labels;
}

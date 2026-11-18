import fs from "node:fs";
import path from "node:path";
import { FALLBACK_SNAPSHOT, ITEM_CATALOG, STRICTNESS_LABELS } from "./data";
import type { FilterProfile, GeneratedBundle, ItemDefinition, MarketSnapshot, SafetyReport, Strictness } from "./types";

const BASELINE_NAMES: Record<Strictness, string> = {
  0: "0-SOFT",
  1: "1-REGULAR",
  2: "2-SEMI-STRICT",
  3: "3-STRICT",
  4: "4-VERY-STRICT",
  5: "5-UBER-STRICT",
  6: "6-UBER-PLUS-STRICT",
};

const STYLE_DIRS: Record<string, string> = {
  aura: "(STYLE) AURA",
  cobalt: "(STYLE) COBALT",
  customsounds: "(STYLE) CUSTOMSOUNDS",
  darkmode: "(STYLE) DARKMODE",
  mythic: "(STYLE) MYTHIC",
  vaal: "(STYLE) VAAL",
  zen: "(STYLE) ZEN",
};

const valueInDivines = (amount: number, currency: string): number => {
  if (currency === "divine") return amount;
  if (currency === "exalted") return amount * 0.02;
  return amount * 0.001;
};

export function baselineFileFor(profile: FilterProfile): string {
  const suffix = BASELINE_NAMES[profile.strictness];
  if (profile.style === "default") return `NeverSink's filter 2 - ${suffix}.filter`;
  const dir = STYLE_DIRS[profile.style] ?? STYLE_DIRS.customsounds;
  const styleName = profile.style === "customsounds" ? "customsounds" : profile.style;
  return `${dir}/NeverSink's filter 2 - ${suffix} (${styleName}) .filter`;
}

function readBaseline(profile: FilterProfile): { contents: string; file: string } {
  const file = baselineFileFor(profile);
  const fullPath = path.join(process.cwd(), "vendor", "neversink", file);
  if (fs.existsSync(fullPath)) return { contents: fs.readFileSync(fullPath, "utf8"), file };
  const fallback = path.join(process.cwd(), "vendor", "neversink", `NeverSink's filter 2 - ${BASELINE_NAMES[profile.strictness]}.filter`);
  return { contents: fs.readFileSync(fallback, "utf8"), file: path.basename(fallback) };
}

function quote(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function itemRule(item: ItemDefinition, profile: FilterProfile, level: "high" | "valuable" | "unknown"): string {
  const base = item.baseType ?? item.name;
  const color = level === "high" ? profile.visuals.highValueColor : level === "unknown" ? profile.visuals.unknownColor : profile.visuals.valuableColor;
  const fontSize = level === "high" ? Math.max(profile.visuals.fontSize, 42) : profile.visuals.fontSize;
  const sound = level === "high" ? "6veryvaluable.mp3" : level === "valuable" ? "2currency.mp3" : "1maybevaluable.mp3";
  const icon = level === "high" ? "Red Star" : level === "valuable" ? "Yellow Circle" : "Pink Diamond";
  const actions = [
    `\tSetFontSize ${fontSize}`,
    `\tSetTextColor ${color}`,
    `\tSetBorderColor ${color}`,
    `\tSetBackgroundColor 20 20 28 245`,
    profile.visuals.showMinimapIcons ? `\tMinimapIcon 0 ${icon}` : "",
    profile.visuals.showBeams && level !== "unknown" ? `\tPlayEffect ${level === "high" ? "Red" : "Yellow"}` : "",
    `\tPlayAlertSoundCustom ${quote(profile.sound.pack === "custom" && profile.sound.customFileName ? profile.sound.customFileName : sound)} ${level === "high" ? 300 : 150}`,
  ].filter(Boolean).join("\n");
  return `Show # poe2-filter override: ${item.name}\n\tBaseType == ${quote(base)}\n${actions}`;
}

function hideRule(item: ItemDefinition, profile: FilterProfile): string {
  const base = item.baseType ?? item.name;
  return `Hide # poe2-filter optional low-value rule: ${item.name}\n\tBaseType == ${quote(base)}\n\tItemLevel < ${Math.max(1, profile.itemLevelMin)}\n\tSetFontSize 18`;
}

function isWhitelisted(itemId: string, profile: FilterProfile): boolean {
  return profile.whitelist.some((entry) => entry.itemIds.includes(itemId));
}

function resolveSnapshot(snapshot?: MarketSnapshot): MarketSnapshot {
  if (!snapshot || Date.parse(snapshot.expiresAt) < Date.now()) return FALLBACK_SNAPSHOT;
  return snapshot;
}

export function generateFilter(profile: FilterProfile, inputSnapshot?: MarketSnapshot): GeneratedBundle {
  const { contents: baseline, file: baselineFile } = readBaseline(profile);
  const snapshot = resolveSnapshot(inputSnapshot);
  const highValueFloor = profile.hideBelowEnabled ? valueInDivines(profile.hideBelowAmount, profile.hideBelowCurrency) : Number.POSITIVE_INFINITY;
  const overrides: string[] = [];
  const hidden: string[] = [];
  const warnings: string[] = [];

  for (const item of ITEM_CATALOG) {
    const price = snapshot.prices[item.id];
    const divines = price ? valueInDivines(price.amount, price.currency) : undefined;
    const whitelisted = isWhitelisted(item.id, profile);
    const unknown = !item.known;
    if (unknown) {
      overrides.push(itemRule(item, profile, "unknown"));
      continue;
    }
    if (divines !== undefined && divines >= 5) {
      overrides.push(itemRule(item, profile, "high"));
      continue;
    }
    if (divines !== undefined && divines >= 0.1) {
      overrides.push(itemRule(item, profile, "valuable"));
      continue;
    }
    if (profile.hideBelowEnabled && divines !== undefined && divines < highValueFloor && !whitelisted) {
      overrides.push(hideRule(item, profile));
      hidden.push(item.name);
    } else if (whitelisted) {
      overrides.push(itemRule(item, profile, "valuable"));
    }
  }

  if (snapshot.source.includes("fallback")) warnings.push("当前价格快照来自 NeverSink 回退数据，未新增基于市场的隐藏规则。");
  if (profile.hideBelowEnabled) warnings.push(`已启用低于 ${profile.hideBelowAmount} ${profile.hideBelowCurrency} 的隐藏；白名单优先。`);
  if (ITEM_CATALOG.some((item) => !item.known)) warnings.push("目录中存在未知物品，已使用警示样式显示，不会静默隐藏。");

  const safetyReport = validateSafety(profile, baselineFile, baseline, hidden, warnings);
  const header = [
    "# poe2-filter generated overlay",
    `# Base: ${baselineFile}`,
    `# Strictness: ${profile.strictness} - ${STRICTNESS_LABELS[profile.strictness]}`,
    `# Market: ${snapshot.source} @ ${snapshot.capturedAt}`,
    "# Safety: unknown items are shown; whitelist wins over optional hide rules.",
    "",
  ].join("\n");
  const filterFile = `${header}${overrides.join("\n\n")}\n\n${baseline}`;
  const soundFiles = profile.sound.pack === "custom" && profile.sound.customFileName ? [profile.sound.customFileName] : ["1maybevaluable.mp3", "2currency.mp3", "6veryvaluable.mp3"];
  return {
    filterFile,
    baselineFile,
    fileName: `poe2-filter-${BASELINE_NAMES[profile.strictness].toLowerCase()}.filter`,
    soundFiles,
    safetyReport,
  };
}

export function validateSafety(profile: FilterProfile, baselineFile: string, baseline: string, hidden: string[], warnings: string[]): SafetyReport {
  const baseTypes = new Set<string>();
  const classes = new Set<string>();
  for (const line of baseline.matchAll(/^\s*(?:BaseType|Class) == (.+)$/gm)) {
    for (const value of line[1].matchAll(/"([^"\n]+)"/g)) {
      if (line[0].includes("BaseType")) baseTypes.add(value[1]);
      else classes.add(value[1]);
    }
  }
  const known = baseTypes.size + classes.size;
  const unknown = ITEM_CATALOG.filter((item) => !item.known).length;
  const hiddenHighValueItems = hidden.filter((name) => ["Divine Orb", "Mirror of Kalandra", "Temporalis", "Headhunter"].includes(name));
  const whitelistViolations = profile.whitelist.flatMap((entry) => entry.itemIds.filter((itemId) => hidden.includes(ITEM_CATALOG.find((item) => item.id === itemId)?.name ?? "")));
  return {
    sourceVersion: "NeverSink PoE2 0.10.4a vendored baseline",
    baselineFile,
    catalogSize: known,
    coveredItems: known,
    unknownItems: unknown,
    hiddenHighValueItems,
    whitelistViolations,
    warnings,
    passed: hiddenHighValueItems.length === 0 && whitelistViolations.length === 0,
  };
}

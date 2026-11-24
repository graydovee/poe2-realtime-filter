import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const vendor = path.join(root, "vendor", "neversink");
const required = [
  "NeverSink's filter 2 - 0-SOFT.filter",
  "NeverSink's filter 2 - 1-REGULAR.filter",
  "NeverSink's filter 2 - 2-SEMI-STRICT.filter",
  "NeverSink's filter 2 - 3-STRICT.filter",
  "NeverSink's filter 2 - 4-VERY-STRICT.filter",
  "NeverSink's filter 2 - 5-UBER-STRICT.filter",
  "NeverSink's filter 2 - 6-UBER-PLUS-STRICT.filter",
];
const missing = required.filter((name) => !fs.existsSync(path.join(vendor, name)));
if (missing.length) throw new Error("missing NeverSink baseline files: " + missing.join(", "));

const problems = [];
const uncutGroup = (item) => (item.categoryPath?.[0] === "gems" ? item.categoryPath[1] : undefined);
for (const name of required) {
  const text = fs.readFileSync(path.join(vendor, name), "utf8");
  if (!/^Show\b/m.test(text)) problems.push(name + ": no Show rule");
  if (!/^Hide\b/m.test(text)) problems.push(name + ": no Hide rule");
  if (!text.includes("Unknown")) problems.push(name + ": unknown-item marker not found");
}

const catalog = JSON.parse(fs.readFileSync(path.join(root, "data", "item-catalog.json"), "utf8"));
if (!Array.isArray(catalog.items) || catalog.items.length < 1000) problems.push("catalog: expected at least 1000 parsed items");
const itemIds = new Set();
for (const item of catalog.items || []) {
  if (!item.id || itemIds.has(item.id)) problems.push("catalog: duplicate or empty item id " + item.id);
  itemIds.add(item.id);
  if (!item.name || !item.matcher || (!item.matcher.baseType && !item.matcher.class)) problems.push("catalog: invalid matcher " + item.id);
  if (!Array.isArray(item.categoryPath) || item.categoryPath.length < 2) problems.push("catalog: missing category path " + item.id);
  if (!item.localeNames?.cn || !item.localeNames?.tw || !item.localeNames?.us) problems.push("catalog: missing locale name " + item.id);
  // 未切割宝石每个等级是一件独立物品：id 里的等级、GemLevel 和分组必须一致。
  const uncut = /^uncut-(skill|spirit|support)-gem-(\d+)$/.exec(item.id || "");
  if (uncut && (item.matcher.gemLevel !== Number(uncut[2]) || item.categoryPath?.join("/") !== "gems/uncut-" + uncut[1] + "-gems")) {
    problems.push("catalog: inconsistent uncut gem level " + item.id);
  }
}
for (const [kind, levels] of [["skill", 20], ["spirit", 20], ["support", 5]]) {
  const found = (catalog.items || []).filter((item) => uncutGroup(item) === "uncut-" + kind + "-gems").length;
  if (found !== levels) problems.push("catalog: expected " + levels + " uncut " + kind + " gem levels, found " + found);
}

const mechanics = JSON.parse(fs.readFileSync(path.join(root, "data", "item-mechanics.json"), "utf8"));
const groupLabels = mechanics.groups || {};
const mechanicKeys = Object.keys(groupLabels);
if (!mechanicKeys.length) problems.push("item mechanics: missing group vocabulary");
for (const [key, labels] of Object.entries(groupLabels)) {
  if (!labels?.cn || !labels?.tw || !labels?.us) problems.push("item mechanics: missing labels for " + key);
}
const order = mechanics.order || [];
for (const key of mechanicKeys) if (!order.includes(key)) problems.push("item mechanics: group missing from display order: " + key);
for (const key of order) if (!mechanicKeys.includes(key) && !["essences", "socketables"].includes(key)) problems.push("item mechanics: unknown key in display order: " + key);
const mapping = mechanics.items || {};
const mapped = new Set(Object.keys(mapping));
const unmapped = [];
for (const item of catalog.items || []) {
  if (item.categoryPath?.[0] !== "crafting") continue;
  const mechanic = item.categoryPath[1];
  const known = mechanicKeys.includes(mechanic) || ["essences", "socketables", "class-selection"].includes(mechanic);
  if (!known) problems.push("catalog: unknown crafting group '" + mechanic + "' on " + item.id);
  if (mechanicKeys.includes(mechanic) && item.categoryPath.length > 2) problems.push("catalog: unexpected extra level under " + mechanic + " on " + item.id);
  if (mechanicKeys.includes(mechanic) && !mapped.has(item.name)) unmapped.push(item.name);
}
for (const [name, entry] of Object.entries(mapping)) {
  if (!mechanicKeys.includes(entry?.mechanic)) problems.push("item mechanics: unknown mechanic " + entry?.mechanic + " for " + name);
  if (typeof entry?.evidence !== "string" || !entry.evidence.trim()) problems.push("item mechanics: missing evidence for " + name);
}

const effects = JSON.parse(fs.readFileSync(path.join(root, "data", "neversink-effects.json"), "utf8"));
const styleNames = ["default", "aura", "cobalt", "customsounds", "darkmode", "mythic", "vaal", "zen"];
for (const style of styleNames) {
  const presets = effects.styles?.[style];
  if (!Array.isArray(presets) || presets.length < 20) problems.push("effect presets: missing or empty style " + style);
  const ids = new Set();
  for (const preset of presets || []) {
    if (!preset.id || ids.has(preset.id) || !/^[a-zA-Z0-9_-]+$/.test(preset.id)) problems.push("effect presets: bad id in " + style + " " + preset.id);
    ids.add(preset.id);
    if (!preset.beam && !preset.icon && !preset.font) problems.push("effect presets: empty preset " + preset.id);
    if (preset.font?.fontSize !== undefined && (!Number.isInteger(preset.font.fontSize) || preset.font.fontSize < 18 || preset.font.fontSize > 45)) problems.push("effect presets: bad font size " + JSON.stringify(preset));
  }
}
if (!Array.isArray(effects.sounds) || effects.sounds.length === 0) problems.push("effect presets: empty sounds");
if (!Array.isArray(effects.customSounds)) problems.push("effect presets: missing customSounds");

const defaultRules = JSON.parse(fs.readFileSync(path.join(root, "data", "default-rules.json"), "utf8")).rules || [];
if (defaultRules.length !== 4) problems.push("default rules: expected 4 price tiers, found " + defaultRules.length);
// 价格档就是普通价格区间，从低到高每档「≥ 1 枚本档通货，且 < 1 枚下一档通货」，最高档不封顶。
const tiers = [["default-exalted", "exalted"], ["default-chaos", "chaos"], ["default-annulment", "annulment"], ["default-divine", "divine"]];
const defaultPresets = new Map((effects.styles?.default || []).map((preset) => [preset.id, preset]));
const ruleIds = new Set();
defaultRules.forEach((rule, index) => {
  if (!rule.id || ruleIds.has(rule.id)) problems.push("default rules: duplicate id " + rule.id);
  ruleIds.add(rule.id);
  if (!rule.name || typeof rule.enabled !== "boolean" || typeof rule.hidden !== "boolean") problems.push("default rules: incomplete " + rule.id);
  if (!Array.isArray(rule.target?.itemIds) || rule.target.itemIds.length !== 0) problems.push("default rules: price tier must not select items " + rule.id);
  if (rule.autoRange !== undefined) problems.push("default rules: price tiers are ordinary ranges, no autoRange " + rule.id);
  const [expectedId, unit] = tiers[index] ?? [];
  const next = tiers[index + 1];
  if (rule.id !== expectedId) problems.push("default rules: expected " + expectedId + " at position " + index + ", found " + rule.id);
  const wrong = (point, currency) => !point || point.amount !== 1 || point.currency !== currency;
  const max = rule.target?.range?.max;
  if (wrong(rule.target?.range?.min, unit)) problems.push("default rules: lower bound of " + rule.id + " must be 1 " + unit + ", found " + JSON.stringify(rule.target?.range?.min));
  if (next ? wrong(max, next[1]) : max !== undefined) problems.push("default rules: upper bound of " + rule.id + (next ? " must be 1 " + next[1] : " must be unset") + ", found " + JSON.stringify(max));
  const preset = defaultPresets.get(rule.effectPresetId);
  if (!preset) problems.push("default rules: effectPresetId not in default style " + rule.id + " " + rule.effectPresetId);
  else {
    const expected = { ...(preset.beam ? { beam: preset.beam } : {}), ...(preset.icon ? { icon: preset.icon } : {}), ...(preset.font ? { font: preset.font } : {}), ...(preset.sound ? { sound: preset.sound } : {}) };
    if (JSON.stringify(expected) !== JSON.stringify(rule.effects)) problems.push("default rules: effects differ from preset " + rule.id);
  }
});

if (unmapped.length) {
  for (const name of unmapped.slice(0, 10)) console.warn("WARN: 未登记来源玩法，先运行 node scripts/build-item-mechanics.mjs：" + name);
  problems.push(unmapped.length + " 件通货与材料物品缺少来源玩法归属（见上方 WARN）");
}

if (problems.length) {
  for (const problem of problems) console.error("FAIL: " + problem);
  process.exit(1);
}
console.log("data validation: ok (" + required.length + " baselines, " + catalog.items.length + " catalog items, " + Object.keys(mapping).length + " mechanic assignments, " + styleNames.map((style) => style + " " + (effects.styles?.[style]?.length ?? 0)).join(" / ") + " presets, " + defaultRules.length + " default rules)");
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
for (const key of ["beams", "icons", "fonts", "sounds", "customSounds"]) {
  if (!Array.isArray(effects[key]) || effects[key].length === 0) problems.push("effect presets: empty " + key);
}
const colorPattern = /^\d{1,3} \d{1,3} \d{1,3}( \d{1,3})?$/;
for (const font of effects.fonts || []) {
  if (font.fontSize !== undefined && (!Number.isInteger(font.fontSize) || font.fontSize < 18 || font.fontSize > 45)) problems.push("effect presets: bad font size " + JSON.stringify(font));
  for (const color of [font.textColor, font.borderColor, font.backgroundColor]) {
    if (color !== undefined && !colorPattern.test(color)) problems.push("effect presets: bad color " + color);
  }
}
for (const sound of effects.sounds || []) {
  if (sound.type === "builtin" ? !Number.isInteger(sound.id) : typeof sound.fileName !== "string") problems.push("effect presets: bad sound " + JSON.stringify(sound));
}

const defaultRules = JSON.parse(fs.readFileSync(path.join(root, "data", "default-rules.json"), "utf8")).rules || [];
if (defaultRules.length !== 4) problems.push("default rules: expected 4 price tiers, found " + defaultRules.length);
const anchors = ["exalted-orb", "chaos-orb", "orb-of-annulment", "divine-orb"];
const beams = new Set(effects.beams || []);
const icons = new Set(effects.icons || []);
const fonts = new Set((effects.fonts || []).map((font) => JSON.stringify(font)));
const sounds = new Set((effects.sounds || []).map((sound) => JSON.stringify(sound)));
const ruleIds = new Set();
for (const rule of defaultRules) {
  if (!rule.id || ruleIds.has(rule.id)) problems.push("default rules: duplicate id " + rule.id);
  ruleIds.add(rule.id);
  if (!rule.name || typeof rule.enabled !== "boolean" || typeof rule.hidden !== "boolean") problems.push("default rules: incomplete " + rule.id);
  if (!Array.isArray(rule.target?.itemIds) || rule.target.itemIds.length !== 0) problems.push("default rules: price tier must not select items " + rule.id);
  const anchor = rule.target?.range?.min?.referenceItemId;
  if (!anchors.includes(anchor)) problems.push("default rules: bad anchor " + anchor + " for " + rule.id);
  if (rule.effects?.beam && !beams.has(rule.effects.beam)) problems.push("default rules: beam not in palette " + rule.effects.beam);
  if (rule.effects?.icon && !icons.has(rule.effects.icon)) problems.push("default rules: icon not in palette " + rule.effects.icon);
  if (rule.effects?.font && !fonts.has(JSON.stringify(rule.effects.font))) problems.push("default rules: font not in palette " + rule.id);
  if (rule.effects?.sound && !sounds.has(JSON.stringify(rule.effects.sound))) problems.push("default rules: sound not in palette " + rule.id);
}

if (unmapped.length) {
  for (const name of unmapped.slice(0, 10)) console.warn("WARN: 未登记来源玩法，先运行 node scripts/build-item-mechanics.mjs：" + name);
  problems.push(unmapped.length + " 件通货与材料物品缺少来源玩法归属（见上方 WARN）");
}

if (problems.length) {
  for (const problem of problems) console.error("FAIL: " + problem);
  process.exit(1);
}
console.log("data validation: ok (" + required.length + " baselines, " + catalog.items.length + " catalog items, " + Object.keys(mapping).length + " mechanic assignments, " + effects.beams.length + " beams / " + effects.icons.length + " icons / " + effects.fonts.length + " font styles / " + effects.sounds.length + " sounds, " + defaultRules.length + " default rules)");
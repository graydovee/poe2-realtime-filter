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

const visuals = JSON.parse(fs.readFileSync(path.join(root, "data", "visual-presets.json"), "utf8"));
if (!Array.isArray(visuals.presets) || visuals.presets.length < 10) problems.push("visual presets: expected NeverSink effect union");
const visualIds = new Set();
for (const preset of visuals.presets || []) {
  if (!preset.id || visualIds.has(preset.id)) problems.push("visual presets: duplicate id " + preset.id);
  visualIds.add(preset.id);
  if (!preset.effect || (!preset.sound || (preset.sound.type === "builtin" ? !Number.isInteger(preset.sound.id) : !preset.sound.fileName))) problems.push("visual presets: incomplete " + preset.id);
}

if (problems.length) {
  for (const problem of problems) console.error("FAIL: " + problem);
  process.exit(1);
}
console.log("data validation: ok (" + required.length + " baselines, " + catalog.items.length + " catalog items, " + visuals.presets.length + " visual presets)");

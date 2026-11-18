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
if (missing.length) throw new Error(`missing NeverSink baseline files: ${missing.join(", ")}`);
const problems = [];
for (const name of required) {
  const text = fs.readFileSync(path.join(vendor, name), "utf8");
  if (!/^Show\b/m.test(text)) problems.push(`${name}: no Show rule`);
  if (!/^Hide\b/m.test(text)) problems.push(`${name}: no Hide rule`);
  if (!text.includes("Unknown")) problems.push(`${name}: unknown-item marker not found; inspect upstream before release`);
}
if (problems.length) {
  for (const problem of problems) console.error(`FAIL: ${problem}`);
  process.exit(1);
}
console.log(`data validation: ok (${required.length} NeverSink strictness files)`);

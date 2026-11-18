import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const root = process.cwd();

test("NeverSink baseline and generated data are vendored", () => {
  execFileSync(process.execPath, ["scripts/validate-data.mjs"], { cwd: root, stdio: "pipe" });
  assert.equal(existsSync("vendor/neversink/NeverSink's filter 2 - 2-SEMI-STRICT.filter"), true);
  const catalog = JSON.parse(readFileSync("data/item-catalog.json", "utf8"));
  assert.ok(catalog.items.length >= 1000);
  assert.ok(catalog.items.some((item) => item.matcher?.baseType === "Divine Orb"));
});

test("visual presets expose default price tiers", () => {
  const presets = JSON.parse(readFileSync("data/visual-presets.json", "utf8")).presets;
  assert.equal(presets.length, 17);
  assert.deepEqual(presets.filter((preset) => preset.enabled).map((preset) => preset.effect).sort(), ["Blue", "Red", "Yellow"]);
  assert.equal(presets.find((preset) => preset.effect === "Blue").range.max.currency, "chaos");
  assert.equal(presets.find((preset) => preset.effect === "Red").range.min.currency, "divine");
});

test("market worker is valid JavaScript", () => {
  execFileSync(process.execPath, ["--check", "worker/price-sync.mjs"], { cwd: root, stdio: "pipe" });
});

test("generated safety policy is documented", () => {
  const readme = readFileSync("README.md", "utf8");
  assert.match(readme, /未知物品/);
  assert.match(readme, /白名单/);
});

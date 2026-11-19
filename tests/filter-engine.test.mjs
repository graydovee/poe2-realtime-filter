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

test("four currency defaults are enabled", () => {
  const presets = JSON.parse(readFileSync("data/visual-presets.json", "utf8")).presets;
  assert.equal(presets.length, 21);
  assert.equal(presets.filter((preset) => preset.enabled).length, 4);
  assert.ok(presets.filter((preset) => preset.enabled).every((preset) => preset.autoRange && preset.range.min.referenceItemId));
});

test("market worker is valid JavaScript", () => {
  execFileSync(process.execPath, ["--check", "worker/price-sync.mjs"], { cwd: root, stdio: "pipe" });
});

test("generated safety policy is documented", () => {
  const readme = readFileSync("README.md", "utf8");
  assert.match(readme, /未知物品/);
  assert.match(readme, /白名单/);
});

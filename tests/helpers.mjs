import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const require = createRequire(import.meta.url);
const output = mkdtempSync(path.join(tmpdir(), "poe2-engine-"));
execFileSync(
  process.execPath,
  [
    "node_modules/typescript/bin/tsc",
    "lib/filter-engine.ts",
    "lib/catalog.ts",
    "lib/default-profile.ts",
    "--outDir", output,
    "--module", "commonjs",
    "--target", "es2021",
    "--esModuleInterop",
    "--resolveJsonModule",
    "--skipLibCheck",
  ],
  { stdio: "pipe" },
);

const core = require(path.join(output, "lib/filter-engine.js"));
export const engine = { ...core, generateFilter: (profile, snapshot, options) =>
  core.generateFilter(profile, readFileSync(path.join("vendor/neversink", core.baselineFileFor(profile)), "utf8"), snapshot, options)
};
export const baseStyles = require(path.join(output, "lib/baseline-effects.js")).inspectBaseStyles;
export const generateOnBase = core.generateFilter;
export const pricing = require(path.join(output, "lib/pricing.js"));
export const data = require(path.join(output, "lib/data.js"));
export const DEFAULT_PROFILE = require(path.join(output, "lib/default-profile.js")).DEFAULT_PROFILE;
export const cleanup = () => rmSync(output, { recursive: true, force: true });

export const DIVINE = 1000; // 1D = 1000E
const now = new Date().toISOString();
export const snapshot = {
  league: "Standard",
  source: "poe.ninja",
  capturedAt: now,
  expiresAt: new Date(Date.now() + 3600000).toISOString(),
  rates: { divineToChaos: 100, divineToExalted: DIVINE, capturedAt: now, source: "poe.ninja" },
  prices: Object.fromEntries(
    [["exalted-orb", 1 / DIVINE], ["chaos-orb", 1 / 100], ["orb-of-annulment", 1 / 10], ["divine-orb", 1]].map(([itemId, amount]) => [
      itemId,
      { itemId, amount, currency: "divine", confidence: 0.9, capturedAt: now, source: "poe.ninja" },
    ]),
  ),
};

export const withPrice = (market, itemId, amountInDivine) => ({
  ...market,
  prices: {
    ...market.prices,
    [itemId]: { itemId, amount: amountInDivine, currency: "divine", confidence: 0.9, capturedAt: market.capturedAt, source: "poe.ninja" },
  },
});
export const itemByName = (name) => data.ITEM_CATALOG.find((item) => item.name === name);
export const blockFor = (filter, needle) => filter.split(/\n\n/).find((block) => block.includes(needle));
export const ruleBlocks = (filter) => filter.split(/\n\n/).filter((block) => /^(?:Show|Hide) # poe2-filter rule:/.test(block));
export const makeRule = (overrides = {}) => ({
  id: "rule-test",
  name: "测试规则",
  enabled: true,
  hidden: false,
  effects: {},
  target: { itemIds: [] },
  ...overrides,
});

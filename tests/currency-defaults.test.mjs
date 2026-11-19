import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { parseExchange } from "../worker/market-adapter.mjs";

const require = createRequire(import.meta.url);
const output = mkdtempSync(path.join(tmpdir(), "poe2-engine-"));
execFileSync(process.execPath, ["node_modules/typescript/bin/tsc", "lib/filter-engine.ts", "--outDir", output, "--module", "commonjs", "--target", "es2021", "--esModuleInterop", "--resolveJsonModule", "--skipLibCheck"], { stdio: "pipe" });
const { generateFilter } = require(path.join(output, "lib/filter-engine.js"));
const { toDivines, currencyDefaultRanges } = require(path.join(output, "lib/pricing.js"));
const { DEFAULT_VISUAL_PRESETS, ITEM_CATALOG } = require(path.join(output, "lib/data.js"));
test.after(() => rmSync(output, { recursive: true, force: true }));
const now = new Date().toISOString();
const snapshot = {
  league: "Standard", source: "poe.ninja", capturedAt: now, expiresAt: new Date(Date.now() + 3600000).toISOString(),
  rates: { divineToChaos: 100, divineToExalted: 1000, capturedAt: now, source: "poe.ninja" },
  prices: Object.fromEntries([["exalted-orb", .001], ["chaos-orb", .01], ["orb-of-annulment", .1], ["divine-orb", 1]].map(([itemId, amount]) => [itemId, { itemId, amount, currency: "divine", confidence: .9, capturedAt: now, source: "poe.ninja" }])),
};
const profile = { strictness: 2, style: "default", locale: "cn", itemLevelMin: 65, areaLevelMin: 65, hideBelowEnabled: false, hideBelowAmount: 0, hideBelowCurrency: "exalted", whitelist: [], visualPresets: DEFAULT_VISUAL_PRESETS, sound: { pack: "neversink", alertLevel: "economy" }, visuals: {} };

test("each enabled preset copies its currency's complete NeverSink appearance", () => {
  const baseline = readFileSync("vendor/neversink/NeverSink's filter 2 - 2-SEMI-STRICT.filter", "utf8");
  const enabled = DEFAULT_VISUAL_PRESETS.filter((p) => p.enabled);
  assert.deepEqual(enabled.map((p) => p.sourceItemId), ["exalted-orb", "chaos-orb", "orb-of-annulment", "divine-orb"]);
  const keys = { effect: "PlayEffect", minimapIcon: "MinimapIcon", textColor: "SetTextColor", borderColor: "SetBorderColor", backgroundColor: "SetBackgroundColor", fontSize: "SetFontSize" };
  for (const preset of enabled) {
    const name = ITEM_CATALOG.find((i) => i.id === preset.sourceItemId).name;
    const block = baseline.split(/(?=^(?:Show|Hide)\b)/m).find((b) => b.split("\n")[0].includes("$type->currency $tier->") && b.includes('"' + name + '"'));
    assert.ok(block, name);
    for (const [field, command] of Object.entries(keys)) assert.ok(block.includes(command + " " + preset[field]), field);
    assert.ok(block.includes("PlayAlertSound " + preset.sound.id + " " + preset.sound.volume));
  }
});

test("anchors follow the snapshot, intervals include the lower boundary and exclude the upper", () => {
  const candidates = [["scroll-of-wisdom", .0009], ["orb-of-alchemy", .005], ["vaal-orb", .05], ["regal-orb", .5], ["mirror-of-kalandra", 2]];
  const prices = { ...snapshot.prices };
  for (const [itemId, amount] of candidates) prices[itemId] = { ...prices["divine-orb"], itemId, amount };
  const result = generateFilter(profile, { ...snapshot, prices });
  assert.deepEqual(result.appliedPresets.map((p) => [p.presetId, p.itemCount]).sort(), [["currency-chaos-orb", 2], ["currency-divine-orb", 2], ["currency-exalted-orb", 2], ["currency-orb-of-annulment", 2]]);
  const overlay = result.filterFile.split("#===============================================================================================================")[0];
  assert.ok(!overlay.includes("Scroll of Wisdom"));
  assert.ok(overlay.includes("PlayAlertSound 6 300"));
  assert.ok(!overlay.includes("PlayAlertSoundCustom"));
  assert.deepEqual(result.soundFiles, []);
  assert.equal(toDivines({ amount: 10, currency: "chaos" }, snapshot.rates), .1);
  assert.equal(toDivines({ amount: 100, currency: "exalted" }, snapshot.rates), .1);
  const expired = generateFilter(profile, { ...snapshot, expiresAt: "2000-01-01T00:00:00Z" });
  assert.equal(expired.appliedPresets.length, 0);
  assert.equal(generateFilter({ ...profile, visualPresets: [] }, snapshot).appliedPresets.length, 0);
});

test("market price changes reorder default anchors without changing manual ranges", () => {
  const reversed = structuredClone(snapshot);
  reversed.prices["orb-of-annulment"].amount = .005;
  const presets = currencyDefaultRanges(DEFAULT_VISUAL_PRESETS, reversed);
  assert.equal(presets.find((p) => p.sourceItemId === "exalted-orb").range.max.referenceItemId, "orb-of-annulment");
  assert.equal(presets.find((p) => p.sourceItemId === "orb-of-annulment").range.max.referenceItemId, "chaos-orb");
  const manual = { ...presets[0], autoRange: false, range: { min: { amount: 10, currency: "exalted" }, max: { amount: 2, currency: "chaos" } } };
  assert.deepEqual(currencyDefaultRanges([manual], reversed)[0], manual);
  assert.equal(toDivines({ amount: 1, currency: "divine", referenceItemId: "orb-of-annulment" }, snapshot.rates, {}), undefined);
});

test("exchange adapter reads divine primaryValue and rates without fuzzy base matches", () => {
  const payload = { core: { primary: "divine", rates: { chaos: 100, exalted: 1000 } }, items: [{ id: "annul", name: "Orb of Annulment" }, { id: "greater-exalted", name: "Greater Exalted Orb" }], lines: [{ id: "annul", primaryValue: .1 }, { id: "greater-exalted", primaryValue: .02 }] };
  const parsed = parseExchange(payload, ITEM_CATALOG, now);
  assert.equal(parsed.prices["orb-of-annulment"].currency, "divine");
  assert.equal(parsed.prices["orb-of-annulment"].amount, .1);
  assert.equal(parsed.prices["exalted-orb"].amount, .001);
  assert.equal(parsed.prices["greater-exalted-orb"].amount, .02);
  assert.equal(parsed.rates.divineToChaos, 100);
  assert.throws(() => parseExchange({ ...payload, core: { primary: "unknown" } }, ITEM_CATALOG, now));
});

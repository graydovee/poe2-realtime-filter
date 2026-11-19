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
execFileSync(process.execPath, ["node_modules/typescript/bin/tsc", "lib/filter-engine.ts", "lib/catalog.ts", "lib/default-profile.ts", "--outDir", output, "--module", "commonjs", "--target", "es2021", "--esModuleInterop", "--resolveJsonModule", "--skipLibCheck"], { stdio: "pipe" });
const { generateFilter } = require(path.join(output, "lib/filter-engine.js"));
const { toExalted, toDivines, currencyPriceTiers, formatPrice, currencyDefaultRanges } = require(path.join(output, "lib/pricing.js"));
const { DEFAULT_VISUAL_PRESETS, ITEM_CATALOG } = require(path.join(output, "lib/data.js"));
const { DEFAULT_PROFILE } = require(path.join(output, "lib/default-profile.js"));
const { buildCatalogTree, catalogItems, catalogNode, searchCatalog } = require(path.join(output, "lib/catalog.js"));
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

test("mixed D/C/E anchor quotes are converted to E before sorting and matching", () => {
  const mixed = structuredClone(snapshot);
  mixed.rates.divineToExalted = 200;
  mixed.rates.divineToChaos = 10;
  for (const [itemId, amount, currency] of [["exalted-orb", 1, "exalted"], ["chaos-orb", 1, "chaos"], ["orb-of-annulment", .25, "divine"], ["divine-orb", 1, "divine"]]) {
    mixed.prices[itemId] = { ...snapshot.prices["divine-orb"], itemId, amount, currency };
  }
  assert.deepEqual(currencyPriceTiers(mixed).map((t) => [t.itemId, t.exaltedValue]), [["exalted-orb", 1], ["chaos-orb", 20], ["orb-of-annulment", 50], ["divine-orb", 200]]);
  const cases = [
    ["scroll-of-wisdom", .99, "exalted", null],
    ["orb-of-alchemy", 1, "exalted", "崇高石光效"],
    ["vaal-orb", 1, "chaos", "混沌石光效"],
    ["regal-orb", 2.5, "chaos", "剥离石光效"],
    ["mirror-of-kalandra", 1, "divine", "神圣石光效"],
  ];
  for (const [itemId, amount, currency] of cases) mixed.prices[itemId] = { ...snapshot.prices["divine-orb"], itemId, amount, currency };
  const overlay = generateFilter(profile, mixed).filterFile.split("#===============================================================================================================")[0];
  for (const [itemId, , , expected] of cases) {
    const name = ITEM_CATALOG.find((item) => item.id === itemId).name;
    const block = overlay.split("\n\n").find((block) => block.includes(" / " + name + "\n"));
    if (expected === null) assert.equal(block, undefined);
    else assert.ok(block?.includes("preset: " + expected + " / " + name), name);
  }
  assert.equal(toExalted({ amount: 2.5, currency: "chaos" }, mixed.rates), 50);
  assert.equal(toExalted({ amount: .25, currency: "divine" }, mixed.rates), 50);
  assert.match(formatPrice({ amount: 1, currency: "exalted", referenceItemId: "divine-orb" }, mixed), /200 E$/);
  assert.match(formatPrice({ amount: 1, currency: "exalted", referenceItemId: "chaos-orb" }, mixed), /20 E$/);
  mixed.prices["orb-of-annulment"].amount = .05;
  assert.deepEqual(currencyPriceTiers(mixed).map((t) => [t.itemId, t.exaltedValue]), [["exalted-orb", 1], ["orb-of-annulment", 10], ["chaos-orb", 20], ["divine-orb", 200]]);
});

test("missing or invalid rates do not generate partial automatic price tiers", () => {
  const incomplete = structuredClone(snapshot);
  delete incomplete.prices["orb-of-annulment"];
  assert.deepEqual(currencyPriceTiers(incomplete), []);
  assert.equal(generateFilter(profile, incomplete).appliedPresets.length, 0);
  assert.equal(toExalted({ amount: 1, currency: "chaos" }, { ...snapshot.rates, divineToChaos: 0 }), undefined);
  assert.equal(toExalted({ amount: 1, currency: "divine" }, { ...snapshot.rates, divineToExalted: NaN }), undefined);
});

test("catalog exposes category menus before individual items and retains every item", () => {
  const tree = buildCatalogTree(ITEM_CATALOG);
  assert.equal(tree.items.length, 0);
  assert.ok(tree.children.length >= 5);
  const ids = catalogItems(tree).map((item) => item.id);
  assert.equal(ids.length, ITEM_CATALOG.length);
  assert.equal(new Set(ids).size, ITEM_CATALOG.length);
  const bows = catalogNode(tree, ["equipment", "weapons", "bows"]);
  assert.ok(bows.items.some((item) => item.name === "Gemini Bow"));
  const boots = catalogNode(tree, ["equipment", "armour", "boots"]);
  assert.ok(boots.items.some((item) => item.name === "Charmed Shoes"));
  const search = buildCatalogTree(searchCatalog(ITEM_CATALOG, "Divine Orb"));
  assert.equal(search.items.length, 0);
  assert.ok(catalogItems(search).some((item) => item.id === "divine-orb"));
  assert.equal(catalogNode(tree, ["equipment", "unknown"]), undefined);
  assert.equal(catalogItems(buildCatalogTree(searchCatalog(ITEM_CATALOG, "no-such-item-zzyy"))).length, 0);
});

test("low-value hiding defaults off at 0.1 E and whitelist overrides an enabled hide", () => {
  assert.equal(DEFAULT_PROFILE.hideBelowEnabled, false);
  assert.equal(DEFAULT_PROFILE.hideBelowAmount, .1);
  assert.equal(DEFAULT_PROFILE.hideBelowCurrency, "exalted");
  const prices = { ...snapshot.prices, "scroll-of-wisdom": { ...snapshot.prices["divine-orb"], itemId: "scroll-of-wisdom", amount: .05, currency: "exalted" } };
  const config = { ...DEFAULT_PROFILE, visualPresets: [] };
  const generated = generateFilter(config, { ...snapshot, prices });
  assert.ok(!generated.filterFile.includes("poe2-filter optional low-value rule: Scroll of Wisdom"));
  const hidden = generateFilter({ ...config, hideBelowEnabled: true }, { ...snapshot, prices });
  assert.ok(hidden.filterFile.includes("Hide # poe2-filter optional low-value rule: Scroll of Wisdom"));
  const white = generateFilter({ ...config, hideBelowEnabled: true, whitelist: [{ id: "scroll", label: "Scroll of Wisdom", itemIds: ["scroll-of-wisdom"] }] }, { ...snapshot, prices });
  assert.ok(white.filterFile.includes("Show # poe2-filter whitelist: Scroll of Wisdom"));
  assert.ok(!white.filterFile.includes("poe2-filter optional low-value rule: Scroll of Wisdom"));
});

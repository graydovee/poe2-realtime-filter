import test from "node:test";
import assert from "node:assert/strict";
import { cleanup, data, tencent } from "./helpers.mjs";

test.after(cleanup);

const now = Date.parse("2026-11-23T04:00:00Z");
const row = (engname, latest_buy1, currency_unit, extra = {}) => ({
  engname, latest_buy1, latest_sell1: 0, currency_unit,
  latest_datetime: "2026-11-23 11:00:00", error: false, ...extra,
});
const quotes = [
  row("Divine Orb", 100, "e"), row("Chaos Orb", 2, "e"),
  row("Orb of Annulment", 0, "d", { latest_sell1: 0.2 }),
  row("Lesser Jeweller's Orb", 0.15, "e", { latest_sell1: 0.1 }),
  row("Greater Jeweller's Orb", 1, "d", { error: true }),
];

function load(items, previousQuotes) {
  return tencent.tencentSnapshot({ league: "0.5.5", body: [{ items }], previousQuotes, lifetime: 4 * 3600000 }, data.ITEM_CATALOG, now);
}

test("Tencent league catalog retains upstream IDs and labels verbatim", () => {
  const ids = ["0.5.5", "RunesofAldur", "standard", "腾讯服 New Season"];
  const catalog = tencent.tencentCatalog(ids);
  assert.deepEqual(catalog.leagues.map(({ id, label }) => [id, label]), ids.map((id) => [id, id]));
  assert.equal(catalog.defaultLeague, ids[0]);
  assert.throws(() => tencent.tencentCatalog([]));
});

test("Tencent uses buy first, sell fallback, denomination conversion and source timestamps", () => {
  const { snapshot: result } = load(quotes);
  const prices = result.prices;
  assert.equal(result.server, "tencent");
  assert.equal(result.league, "0.5.5");
  assert.equal(result.capturedAt, "2026-11-23T03:00:00.000Z");
  assert.equal(result.rates.divineToChaos, 50);
  assert.equal(prices["divine-orb"].amount, 100);
  assert.equal(prices["exalted-orb"].amount, 1);
  assert.equal(prices["orb-of-annulment"].amount, 20);
  assert.equal(prices["lesser-jeweller-s-orb"].amount, 0.15);
  assert.equal(prices["greater-jeweller-s-orb"], undefined);
});

test("Tencent accepts the newest quote even when the upstream only flags its age", () => {
  const at = (hour) => ({ latest_datetime: `2026-11-21 ${hour}:00:00`, error: true, error_info: "数据已过时超过24h" });
  const first = load([
    row("Divine Orb", 100, "e", at("09")), row("Chaos Orb", 2, "e", at("10")),
    row("Orb of Annulment", 0.2, "d", at("08")), row("Lesser Jeweller's Orb", 0.15, "e", at("09")),
  ]);
  const second = load([
    row("Divine Orb", 200, "e", at("10")), row("Chaos Orb", 9, "e", at("09")),
    row("Orb of Annulment", 0.9, "d", at("08")),
    row("Lesser Jeweller's Orb", 9, "e", { ...at("11"), error_info: "价格出现剧烈波动" }),
  ], first.quotes);
  assert.equal(second.snapshot.rates.divineToExalted, 200);
  assert.equal(second.snapshot.prices["chaos-orb"].amount, 2);
  assert.equal(second.snapshot.prices["orb-of-annulment"].amount, 40);
  assert.equal(second.snapshot.prices["orb-of-annulment"].capturedAt, "2026-11-21T00:00:00.000Z");
  assert.equal(second.snapshot.prices["lesser-jeweller-s-orb"].amount, 0.15);
  assert.equal(second.snapshot.capturedAt, "2026-11-21T02:00:00.000Z");
  assert.equal(second.snapshot.expiresAt, "2026-11-23T08:00:00.000Z");

  const restored = JSON.parse(JSON.stringify(second.quotes));
  const third = load([row("Lesser Jeweller's Orb", 0.25, "e", at("11"))], restored);
  assert.equal(third.snapshot.prices["orb-of-annulment"].amount, 40);
  assert.equal(third.snapshot.prices["lesser-jeweller-s-orb"].amount, 0.25);
  assert.equal(third.snapshot.capturedAt, "2026-11-21T03:00:00.000Z");
});

test("Tencent recovers previous quotes from the legacy cached response", () => {
  const result = tencent.tencentSnapshot({
    league: "0.5.5", previousBody: [{ items: quotes }], lifetime: 3600000,
    body: [{ items: [row("Lesser Jeweller's Orb", 0.25, "e", { latest_datetime: "2026-11-23 11:30:00" })] }],
  }, data.ITEM_CATALOG, now);
  assert.equal(result.snapshot.prices["divine-orb"].amount, 100);
  assert.equal(result.snapshot.prices["lesser-jeweller-s-orb"].amount, 0.25);
});

test("Tencent rejects missing anchors, future timestamps, and unrecognized errors", () => {
  assert.throws(() => load(quotes.slice(1)), /汇率/);
  assert.throws(() => load(quotes.map((quote) => ({ ...quote, latest_datetime: "2026-11-23 12:30:00" }))), /没有返回可用报价/);
  assert.throws(() => load(quotes.map((quote) => ({ ...quote, error: true }))), /没有返回可用报价/);
  assert.throws(() => load([]), /没有返回可用报价/);
});

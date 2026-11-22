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

function load(items) {
  return tencent.tencentSnapshot({ league: "0.5.5", body: [{ items }], lifetime: 4 * 3600000 }, data.ITEM_CATALOG, now);
}

test("Tencent league catalog retains upstream IDs and labels verbatim", () => {
  const ids = ["0.5.5", "RunesofAldur", "standard", "腾讯服 New Season"];
  const catalog = tencent.tencentCatalog(ids);
  assert.deepEqual(catalog.leagues.map(({ id, label }) => [id, label]), ids.map((id) => [id, id]));
  assert.equal(catalog.defaultLeague, ids[0]);
  assert.throws(() => tencent.tencentCatalog([]));
});

test("Tencent uses buy first, sell fallback, denomination conversion and source timestamps", () => {
  const result = load(quotes);
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

test("Tencent rejects missing or stale conversion anchors", () => {
  assert.throws(() => load(quotes.slice(1)), /汇率/);
  assert.throws(() => load(quotes.map((quote) => ({ ...quote, latest_datetime: "2026-11-21 11:00:00" }))), /汇率/);
  assert.throws(() => tencent.tencentSnapshot({ league: "standard", body: [], lifetime: 3600000 }, data.ITEM_CATALOG, now), /没有返回/);
});

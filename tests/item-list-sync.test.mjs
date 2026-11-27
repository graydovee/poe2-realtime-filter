import assert from "node:assert/strict";
import test from "node:test";

import { editDropMetadata, removeEntry, setEntry } from "../scripts/lib/drop-metadata.mjs";
import { applyItemPlan, buildItemPlan, describePlan } from "../scripts/sync-item-list.mjs";

const record = (Name, ItemClass, id = Name) => ({ Id: "Metadata/Items/" + id, ItemClass, Name, DropLevel: 1, Flag1: false });
const client = {
  records: [
    record("Acrid Wand", 8), record("Attuned Wand", 8), record("Bone Wand", 8), record("Carrier Wand", 8), record("Golden Charm", 33),
    record("Divine Orb", 30), record("Old Orb", 30), record("Ancient Crisis Fragment", 117, "Pinnacle/PinnacleKey1"),
    record("Waystone (Tier 2)", 35, "Maps/MapKeyTier2"), record("Waystone (Tier 1)", 35, "Maps/MapKeyTier1"), record("Trial Key", 30, "Sanctum/SanctumTrialKey"),
  ],
  byName: new Map(), byLowerName: new Map(),
};
const CHINESE = { "Acrid Wand": ["刻薄法杖", "刺鼻法杖"], "Attuned Wand": ["调音法杖", "調音法杖"], "Golden Charm": ["黄金咒符", "黃金咒符"] };
for (const item of client.records) {
  const [cn, tw] = CHINESE[item.Name] ?? ["中" + item.Name, "繁" + item.Name];
  const entry = { name: item.Name, records: [item], dropLevel: item.DropLevel, localeNames: { us: item.Name, cn, tw } };
  client.byName.set(item.Name, entry);
  client.byLowerName.set(item.Name.toLowerCase(), entry);
}
const item = (name, categoryPath) => ({ id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), name, categoryPath, matcher: { baseType: name }, localeNames: { us: name } });
const wands = ["Acrid Wand", "Attuned Wand", "Bone Wand"].map((name) => item(name, ["equipment", "one-hand", "wands"]));
const base = () => ({
  client,
  catalog: { items: [...wands, item("Golden Charm", ["equipment", "accessories", "charms"]), item("Divine Orb", ["currency", "currency"]), item("Old Orb", ["currency", "currency"]), item("Ancient Crisis Fragment", ["endgame", "keys"]), { id: "class-waystones", name: "Waystones", categoryPath: ["endgame", "waystones", "class-selection"], matcher: { class: "Waystones" } }] },
  metadata: {
    dropEnabled: { "Acrid Wand": true, "Attuned Wand": true, "Bone Wand": true },
    items: { "Divine Orb": { icon: "a.png" }, "Old Orb": {}, "Acrid Wand": { icon: "b.png" } },
    uniques: { "Acrid Wand": { Cursecarver: "c.png" }, "Bone Wand": { "Gone Wand": "d.png" } },
    localizedUniqueNames: { Cursecarver: { cn: "旧译名", tw: "舊譯名" }, "Gone Wand": { cn: "x", tw: "y" } },
  },
  reference: { items: [], uniques: [], uniqueBases: [] },
  details: { items: {}, uniques: {} },
});
const TRIAL_KEY_ICON = "https://cdn.poe2db.tw/image/Art/2DItems/Currency/Sanctum/SanctumKeyTrial.webp";
const WAYSTONE_ICON = "https://cdn.poe2db.tw/image/Art/2DItems/Maps/EndgameMaps/EndgameMap2.webp";
const ROAD_RUNNER_ICON = "https://cdn.poe2db.tw/image/Art/2DItems/Wands/Uniques/RoadRunner.webp";
// What the item list names: what the catalog already has, the key it adds this time and two waystone tiers.
const listed = () => ({
  items: [
    { name: "Acrid Wand", itemClass: 8, path: "equipment/one-hand/wands" }, { name: "Attuned Wand", itemClass: 8, path: "equipment/one-hand/wands" },
    { name: "Bone Wand", itemClass: 8, path: "equipment/one-hand/wands" }, { name: "Golden Charm", itemClass: 33, path: "equipment/accessories/charms" },
    { name: "Divine Orb", itemClass: 30, path: "currency/currency" }, { name: "Ancient Crisis Fragment", itemClass: 117, path: "endgame/keys" },
    { name: "Trial Key", itemClass: 30, path: "endgame/sekhema-trials" },
    { name: "Waystone (Tier 2)", itemClass: 35, path: "endgame/waystones" }, { name: "Waystone (Tier 1)", itemClass: 35, path: "endgame/waystones" },
  ],
  uniques: [
    { name: "Cursecarver", base: "Acrid Wand", cn: "刻咒", tw: "刻咒", path: "uniques/one-hand/wands" },
    { name: "Road Runner", base: "Bone Wand", cn: "飞毛腿", tw: "飛毛腿", path: "uniques/one-hand/wands" },
  ],
  uniqueBases: [],
});
// A metadata file with every section in it, one record per line like the real one.
const metadataText = () => [
  `{`,
  `  "stackable": [`, `    "Divine Orb"`, `  ],`,
  `  "dropEnabled": {`, `    "Acrid Wand": true`, `    "Attuned Wand": true`, `    "Bone Wand": true`, `  },`,
  `  "items": {`, `    "Divine Orb": {"icon": "a.png"},`, `    "Old Orb": {}`, `  },`,
  `  "uniques": {`, `    "Acrid Wand": {"Cursecarver": "c.png"},`, `    "Bone Wand": {"Gone Wand": "d.png", "Kept": "e.png"}`, `  },`,
  `  "localizedUniqueNames": {`, `    "Cursecarver": {"cn": "旧译名", "tw": "舊譯名"},`, `    "Gone Wand": {"cn": "x", "tw": "y"}`, `  }`,
  `}`,
].join("\n");

test("物品和传奇的清单照物品列表：有的补上，没有的去掉；译名取物品列表，图标取物品详情", () => {
  const ctx = base();
  const details = {
    items: { "Divine Orb": { listed: true, stackSize: [1, 10] }, "Trial Key": { icon: TRIAL_KEY_ICON }, "Waystone (Tier 2)": { icon: WAYSTONE_ICON } },
    uniques: { "Road Runner": { icon: ROAD_RUNNER_ICON } },
  };
  const plan = buildItemPlan({ ...ctx, reference: listed(), details });
  // Translated names come from the item list; icons from what the item details have for the unique.
  assert.deepEqual(plan.uniques.add, [{ name: "Road Runner", base: "Bone Wand", cn: "飞毛腿", tw: "飛毛腿", icon: ROAD_RUNNER_ICON }]);
  assert.deepEqual(plan.uniques.rename, [{ name: "Cursecarver", cn: "刻咒", tw: "刻咒" }, { name: "Road Runner", cn: "飞毛腿", tw: "飛毛腿" }]);
  assert.deepEqual(plan.uniques.remove, [{ name: "Gone Wand", base: "Bone Wand" }]);
  assert.deepEqual(plan.uniques.move, []);
  assert.deepEqual(plan.uniqueIcons, []);
  // New items come sorted by category, waystones from the highest tier down.
  assert.deepEqual(plan.items.add.map((item) => item.name + " → " + item.categoryPath.join("/") + " " + item.localeNames.cn), [
    "Trial Key → endgame/sekhema-trials 中Trial Key",
    "Waystone (Tier 2) → endgame/waystones 中Waystone (Tier 2)", "Waystone (Tier 1) → endgame/waystones 中Waystone (Tier 1)",
  ]);
  // Only what has an icon in the item details gets one.
  assert.deepEqual(plan.items.add.map((item) => item.icon ?? null), [TRIAL_KEY_ICON, WAYSTONE_ICON, null]);
  // Old Orb is not on the item list and goes, whether or not the item details have it.
  assert.deepEqual(plan.items.remove, ["Old Orb"]);
  assert.deepEqual(plan.icons, { fill: [] });
  assert.ok(describePlan(plan).includes("去掉的物品：1"));

  // Writing the plan: the catalog and the metadata sections.
  const edit = applyItemPlan(plan, ctx.catalog);
  const result = editDropMetadata(metadataText(), (sections) => {
    edit(sections);
    setEntry(sections.items, "Zeta Orb", { icon: "z.png" });
    removeEntry(sections.dropEnabled, "Attuned Wand");
  });
  assert.deepEqual(result.changed, {
    stackable: { added: 0, removed: 0, changed: 0 }, dropEnabled: { added: 0, removed: 1, changed: 0 }, items: { added: 3, removed: 1, changed: 0 },
    uniques: { added: 0, removed: 0, changed: 1 }, localizedUniqueNames: { added: 1, removed: 1, changed: 1 },
  });
  const metadata = JSON.parse(result.text);
  assert.deepEqual(metadata.uniques, { "Acrid Wand": { Cursecarver: "c.png" }, "Bone Wand": { Kept: "e.png", "Road Runner": ROAD_RUNNER_ICON } });
  assert.deepEqual(metadata.localizedUniqueNames, { Cursecarver: { cn: "刻咒", tw: "刻咒" }, "Road Runner": { cn: "飞毛腿", tw: "飛毛腿" } });
  // The items section keeps the records of the catalog's items only: Old Orb's record went with the item.
  assert.deepEqual(metadata.items, { "Divine Orb": { icon: "a.png" }, "Trial Key": { icon: TRIAL_KEY_ICON }, "Waystone (Tier 2)": { icon: WAYSTONE_ICON }, "Zeta Orb": { icon: "z.png" } });
  // Lines that were not edited keep their wording.
  assert.ok(result.text.includes(`    "Divine Orb": {"icon": "a.png"},`));
  assert.deepEqual(metadata.stackable, ["Divine Orb"]);
  assert.equal(ctx.catalog.items.some((item) => item.name === "Trial Key"), true);
  assert.equal(ctx.catalog.items.some((item) => item.name === "Old Orb"), false);
  // A waystone tier is its own item: matched by tier, never priced.
  const [tier2, tier1] = ctx.catalog.items.filter((item) => item.matcher.waystoneTier !== undefined);
  assert.deepEqual([tier2.matcher, tier2.priceable, tier2.category, tier2.categoryPath, tier2.baseType], [{ waystoneTier: 2 }, false, "map", ["endgame", "waystones"], undefined]);
  assert.deepEqual(tier1.matcher, { waystoneTier: 1 });
});

test("只给传奇挂基底的物品留着；一件传奇有几个基底时，挂的基底按物品列表的记录", () => {
  const ctx = base();
  // Carrier Wand appears only as a base of uniques; Twin Wand and Shifted Wand are in the catalog already.
  ctx.catalog.items.push(item("Carrier Wand", ["equipment", "one-hand", "wands"]));
  ctx.metadata.uniques["Bone Wand"]["Twin Wand"] = "f.png";
  ctx.metadata.uniques["Attuned Wand"] = { "Shifted Wand": "g.png" };
  ctx.metadata.localizedUniqueNames["Shifted Wand"] = { cn: "s", tw: "s" };
  const reference = {
    items: [
      { name: "Acrid Wand", itemClass: 8, path: "equipment/one-hand/wands" }, { name: "Attuned Wand", itemClass: 8, path: "equipment/one-hand/wands" },
      { name: "Bone Wand", itemClass: 8, path: "equipment/one-hand/wands" }, { name: "Golden Charm", itemClass: 33, path: "equipment/accessories/charms" },
      { name: "Divine Orb", itemClass: 30, path: "currency/currency" }, { name: "Ancient Crisis Fragment", itemClass: 117, path: "endgame/keys" },
    ],
    uniques: [
      { name: "Cursecarver", base: "Acrid Wand", cn: "刻咒", tw: "刻咒" },
      { name: "Gone Wand", base: "Bone Wand", cn: "消失之杖", tw: "消失之杖" },
      { name: "Road Runner", base: "Carrier Wand", cn: "飞毛腿", tw: "飛毛腿" },
      { name: "Late Wand", base: "Carrier Wand" },
      // Two bases: the catalog hangs the unique on Bone Wand, which is one of them.
      { name: "Twin Wand", base: "Attuned Wand" }, { name: "Twin Wand", base: "Bone Wand" },
      { name: "Shifted Wand", base: "Acrid Wand", cn: "s", tw: "s" },
      { name: "Orphan Wand", base: "Missing Wand" },
    ],
    uniqueBases: [{ name: "Carrier Wand", itemClass: 8 }],
  };
  const plan = buildItemPlan({ ...ctx, reference });
  // Old Orb is not on the item list and goes; Carrier Wand stays as a base for uniques.
  assert.deepEqual(plan.items.remove, ["Old Orb"]);
  assert.deepEqual(plan.items.add, []);
  // Gone Wand stays under its base and takes the item list's names.
  assert.deepEqual(plan.uniques.rename, [{ name: "Cursecarver", cn: "刻咒", tw: "刻咒" }, { name: "Gone Wand", cn: "消失之杖", tw: "消失之杖" }, { name: "Road Runner", cn: "飞毛腿", tw: "飛毛腿" }]);
  assert.deepEqual(plan.uniques.remove, []);
  // Without an entry in the item details the unique comes in without an icon.
  assert.deepEqual(plan.uniques.add, [
    { name: "Road Runner", base: "Carrier Wand", cn: "飞毛腿", tw: "飛毛腿", icon: null },
    // The item list has no translated name for this one: the catalog keeps the one it has.
    { name: "Late Wand", base: "Carrier Wand", cn: undefined, tw: undefined, icon: null },
  ]);
  assert.deepEqual(plan.uniques.move, [{ name: "Shifted Wand", from: "Attuned Wand", base: "Acrid Wand" }]);
  assert.deepEqual(plan.uniques.withoutBase, ["Orphan Wand"]);
  // A unique in the catalog but off the item list goes.
  ctx.metadata.uniques["Bone Wand"]["Stopped Wand"] = "h.png";
  const stopped = buildItemPlan({ ...ctx, reference });
  assert.deepEqual(stopped.uniques.remove.map((unique) => unique.name), ["Stopped Wand"]);
  // An empty item list leaves nothing but the class entries.
  const empty = buildItemPlan({ ...ctx, reference: { items: [], uniques: [], uniqueBases: [] } });
  assert.deepEqual(empty.items.remove, ["Acrid Wand", "Attuned Wand", "Bone Wand", "Golden Charm", "Divine Orb", "Old Orb", "Ancient Crisis Fragment", "Carrier Wand"]);
});

test("目录里还没有图标的物品和传奇，物品详情里有的补上", () => {
  const ctx = base();
  const WAND_ICON = "https://cdn.poe2db.tw/image/Art/2DItems/Wands/Uniques/AttunedWand.webp";
  const CURSECARVER_ICON = "https://cdn.poe2db.tw/image/Art/2DItems/Wands/Uniques/Cursecarver.webp";
  const details = {
    items: { "Attuned Wand": { icon: WAND_ICON }, "Bone Wand": { listed: true }, "Divine Orb": { listed: true, stackSize: [1, 10] } },
    uniques: { Cursecarver: { icon: CURSECARVER_ICON }, "Gone Wand": { icon: "https://cdn.poe2db.tw/image/GoneWand.webp" } },
  };
  const reference = {
    items: [
      { name: "Acrid Wand", itemClass: 8, path: "equipment/one-hand/wands" }, { name: "Attuned Wand", itemClass: 8, path: "equipment/one-hand/wands" },
      { name: "Bone Wand", itemClass: 8, path: "equipment/one-hand/wands" }, { name: "Golden Charm", itemClass: 33, path: "equipment/accessories/charms" },
      { name: "Divine Orb", itemClass: 30, path: "currency/currency" }, { name: "Ancient Crisis Fragment", itemClass: 117, path: "endgame/keys" },
    ],
    uniques: [{ name: "Cursecarver", base: "Acrid Wand", cn: "刻咒", tw: "刻咒" }],
    uniqueBases: [],
  };
  ctx.metadata.uniques["Acrid Wand"] = { Cursecarver: null };
  const plan = buildItemPlan({ ...ctx, reference, details });
  // Attuned Wand is the only item without an icon that has one in the item details. Gone Wand is on its way out, so it gets none.
  assert.deepEqual(plan.icons, { fill: [{ name: "Attuned Wand", icon: WAND_ICON }] });
  assert.deepEqual(plan.uniqueIcons, [{ name: "Cursecarver", base: "Acrid Wand", icon: CURSECARVER_ICON }]);
  const text = [
    `{`,
    `  "stackable": [`, `    "Divine Orb"`, `  ],`,
    `  "dropEnabled": {`, `    "Acrid Wand": true`, `  },`,
    `  "items": {`, `    "Attuned Wand": {},`, `    "Divine Orb": {"icon": "a.png"}`, `  },`,
    `  "uniques": {`, `    "Acrid Wand": {"Cursecarver": null},`, `    "Bone Wand": {"Gone Wand": "d.png"}`, `  },`,
    `  "localizedUniqueNames": {`, `    "Cursecarver": {"cn": "旧译名", "tw": "舊譯名"}`, `  }`,
    `}`,
  ].join("\n");
  const metadata = JSON.parse(editDropMetadata(text, applyItemPlan(plan, ctx.catalog)).text);
  assert.deepEqual(metadata.items["Attuned Wand"], { icon: WAND_ICON });
  assert.equal(metadata.uniques["Acrid Wand"].Cursecarver, CURSECARVER_ICON);
});

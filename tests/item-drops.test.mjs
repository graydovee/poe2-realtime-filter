import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { cleanup, data, DEFAULT_PROFILE, itemLabel, makeRule, searchCatalog, validateProfile } from "./helpers.mjs";

test.after(cleanup);

const catalog = JSON.parse(readFileSync("data/item-catalog.json", "utf8"));
const metadata = JSON.parse(readFileSync("data/item-drop-metadata.json", "utf8"));
const pickerIds = new Set(data.PICKER_ITEMS.map((item) => item.id));
const pathOf = (id) => data.FILTER_ITEMS_BY_ID.get(id)?.categoryPath.join("/");
const idByName = (name) => catalog.items.find((item) => item.name === name)?.id;
const build = (rules, skippedItemIds = []) => validateProfile({ ...DEFAULT_PROFILE, rules, skippedItemIds });
const itemRule = (id, itemIds, overrides = {}) => makeRule({ id, name: id, target: { itemIds }, ...overrides });

test("只出传奇的基底没有普通变体，它只以传奇的身份出现", () => {
  // 普通基底是物品列表里列了、而且有不止出传奇的记录的装备基底。只出传奇的基底（客户端表里编号带 Unique，
  // 例如符文之叉 FourWandUnique2）和只给传奇挂基底的几件（华服装束、永恒珠宝、戒指、永霜法杖、饕餮法杖）记 false。
  for (const [name, enabled] of Object.entries(metadata.dropEnabled)) {
    assert.equal(data.FILTER_ITEMS_BY_ID.has(`base:${idByName(name)}`), enabled, name);
  }
  const uniqueOnly = Object.entries(metadata.dropEnabled).filter(([, enabled]) => !enabled).map(([name]) => name);
  assert.deepEqual(uniqueOnly.sort(), [
    "Aberrant Sledge", "Ancient Gauntlets", "Ancient Leggings", "Ancient Mail", "Ancient Visor", "Garment", "Glacial Fortress", "Heartwood Shortbow",
    "Ornate Ringmail", "Perching Staff", "Permafrost Staff", "Primal Markings", "Ravenous Staff", "Reflecting Staff", "Ring", "Runic Fork",
    "Tenebrous Crown", "Tethering Bands", "Timeless Jewel", "Twisted Wand", "Venerable Defender", "Veridical Chain", "Warding Quarterstaff",
  ]);
  // 有传奇的仅传奇基底只出现在传奇里；一件传奇都没有的不出现在选择器里。
  for (const name of uniqueOnly) {
    const uniques = Object.keys(metadata.uniques[name] ?? {});
    assert.equal(pickerIds.has(`unique:${idByName(name)}`), uniques.length > 0, name);
  }
  // 物品列表里列了的基底都是普通基底，包括客户端表里编号带 Demigod 的金羽腰带（Golden Obi）。
  for (const name of ["Acrid Wand", "Offering Wand", "Conqueror Plate", "Champion Cuirass", "Torment Club", "Massive Spear", "Embroidered Gloves", "Greatbow", "Attuned Wand", "Iron Greaves", "Diamond", "Golden Obi"]) {
    assert.ok(pickerIds.has(`base:${idByName(name)}`), name);
  }
});

test("装备基底清单照物品列表", () => {
  // NeverSink 过滤器没有点名的普通基底（例如 Juggernaut Plate、Glorious Plate、Primordial Wand）也在物品列表里，照样收。
  for (const name of ["Juggernaut Plate", "Chieftain Cuirass", "Colosseum Plate", "Glorious Plate", "Offering Wand", "Frigid Wand", "Torture Wand", "Critical Wand", "Primordial Wand", "Attuned Focus", "Magus Focus", "Brigand Mace", "Lumen Mace", "Solemn Maul", "Polished Targe"]) {
    const item = data.FILTER_ITEMS_BY_ID.get(idByName(name));
    assert.ok(item, name);
    assert.ok(pickerIds.has(`base:${item.id}`), name + " 没有普通基底");
    assert.equal(item.localeNames.cn !== item.name, true, name + " 缺中文名");
  }
  // 匕首、单手剑和双手剑的基底物品列表里没有，目录里也不收。
  for (const name of ["Glass Shank", "Cinquedea", "Shortsword", "Dark Blade", "Corroded Longsword", "Ultra Greatsword"]) assert.equal(idByName(name), undefined, name);
  // 开发用的物品和符文锻造出来的衍生基底不收。
  for (const name of ["Keyblade", "Energy Blade", "Runeforged Fur Plate", "Runemastered Runic Fork"]) assert.equal(idByName(name), undefined, name);
  // 法杖的 13 个普通基底都在「装备 › 单手武器 › 法杖」里；出了传奇的 8 个基底在「传奇 › 传奇单手 › 法杖」里，其中两把只出传奇。
  const normalWands = data.PICKER_ITEMS.filter((item) => pathOf(item.id) === "equipment/one-hand/wands").map((item) => item.matcher.baseType).sort();
  assert.deepEqual(normalWands, ["Acrid Wand", "Attuned Wand", "Bone Wand", "Critical Wand", "Dueling Wand", "Frigid Wand", "Galvanic Wand", "Offering Wand", "Primordial Wand", "Siphoning Wand", "Torture Wand", "Volatile Wand", "Withered Wand"]);
  const uniqueWands = data.PICKER_ITEMS.filter((item) => pathOf(item.id) === "uniques/one-hand/wands");
  assert.deepEqual(uniqueWands.map((item) => item.matcher.baseType).sort(), ["Acrid Wand", "Attuned Wand", "Bone Wand", "Runic Fork", "Siphoning Wand", "Twisted Wand", "Volatile Wand", "Withered Wand"]);
  assert.ok(uniqueWands.every((item) => item.category === "unique" && item.categoryPath[0] === "uniques"), "传奇不在装备分类下");
  const uniqueOnlyWands = uniqueWands.filter((item) => ["Runic Fork", "Twisted Wand"].includes(item.matcher.baseType));
  assert.equal(uniqueOnlyWands.length, 2);
  // 掉落等级取客户端的数值（Dueling Wand 原来记的是 Wiki 的 62，Sacred Bloom 是 1）。
  for (const [name, level] of [["Juggernaut Plate", 45], ["Glorious Plate", 65], ["Dueling Wand", 65], ["Sacred Bloom", 65], ["Breachstone", 68]]) {
    assert.equal(data.PICKER_ITEMS.find((item) => item.name === name && item.category !== "unique")?.dropLevel, level, name);
  }
  // 药瓶各档也在客户端表里，收在「装备 › 饰品 › 药剂」下。
  for (const name of ["Lesser Life Flask", "Colossal Mana Flask"]) {
    const item = data.FILTER_ITEMS_BY_ID.get(idByName(name));
    assert.ok(pickerIds.has(item.id), name);
    assert.equal(pathOf(item.id), "equipment/accessories/flasks");
  }
  // 防具按属性需求拆开，盾牌分三种。
  for (const [name, expected] of [["Rusted Greathelm", "equipment/helmets/str"], ["Shabby Hood", "equipment/helmets/dex"], ["Twig Circlet", "equipment/helmets/int"], ["Gladiatorial Helm", "equipment/helmets/str-dex"], ["Cryptic Crown", "equipment/helmets/str-int"], ["Grinning Mask", "equipment/helmets/dex-int"], ["Grand Visage", "equipment/helmets/str-dex-int"], ["Splintered Tower Shield", "equipment/off-hand/shields-str"], ["Hardwood Targe", "equipment/off-hand/shields-str-dex"], ["Blazon Crest Shield", "equipment/off-hand/shields-str-int"], ["Leather Buckler", "equipment/off-hand/bucklers"]]) {
    assert.equal(pathOf("base:" + idByName(name)), expected, name);
  }
});

test("同名基底里有一条会掉落的记录，普通变体就保留", () => {
  // Shrine Sceptre 和 Ornate Buckler 各有一个只出传奇的同名基底，过滤器按名字分不开它们。
  for (const name of ["Shrine Sceptre", "Ornate Buckler"]) {
    const id = idByName(name);
    assert.equal(metadata.dropEnabled[name], true, name);
    assert.ok(pickerIds.has(`base:${id}`) && pickerIds.has(`unique:${id}`), name);
  }
});

test("传奇条目带着基底的名字，按基底名能搜到它", () => {
  const unique = data.FILTER_ITEMS_BY_ID.get(`unique:${idByName("Runic Fork")}`);
  assert.equal(itemLabel(unique, "cn"), "符文猎手的呼唤");
  assert.deepEqual(unique.baseLocaleNames, { cn: "符文之叉", tw: "符文尖叉", us: "Runic Fork" });
  assert.deepEqual(searchCatalog(data.PICKER_ITEMS, "符文之叉").map((item) => item.id), [unique.id]);
});

test("传奇清单照物品列表", () => {
  const uniques = (base) => Object.keys(metadata.uniques[base] ?? {});
  assert.ok(uniques("Tethering Bands").includes("The Master's Reach"));
  // 传奇挂在哪件基底上、叫什么名字，都按物品列表的记录。
  assert.ok(uniques("Velour Shoes").includes("Beetlebite"));
  assert.equal(itemLabel(data.FILTER_ITEMS_BY_ID.get(`unique:${idByName("Tethering Bands")}`), "cn"), "主宰之觸");
  assert.deepEqual(metadata.localizedUniqueNames["Alpha's Howl"], { cn: "极地之眼", tw: "極地之嗥" });
  // Megalomaniac、From Nothing、Blessed Bonds、Forgotten By Time、The Road Warrior 也在列表里；图标取物品详情。
  assert.ok(uniques("Diamond").includes("Megalomaniac") && uniques("Diamond").includes("From Nothing"));
  assert.deepEqual(metadata.localizedUniqueNames["Megalomaniac"], { cn: "妄想症", tw: "妄想症" });
  assert.deepEqual(metadata.localizedUniqueNames["From Nothing"], { cn: "无根之源", tw: "從無到有" });
  assert.equal(pathOf(`unique:${idByName("Diamond")}`), "uniques/accessories/jewels");
  // Blessed Bonds、Forgotten By Time、The Road Warrior 的基底和译名按物品列表，图标取物品详情。
  for (const [base, name, cn, tw, leaf] of [
    ["Linen Wraps", "Blessed Bonds", "蒙福的羁绊", "祝福之絆", "uniques/equipment/gloves"],
    ["Expedition Tablet", "Forgotten By Time", "时光的埋没", "時間之遺", "uniques/misc/tablets"],
    ["Raider Plate", "The Road Warrior", "征途之士", "無畏戰士", "uniques/equipment/body-armour"],
  ]) {
    assert.ok(uniques(base).includes(name), name);
    assert.deepEqual(metadata.localizedUniqueNames[name], { cn, tw });
    assert.equal(pathOf(`unique:${idByName(base)}`), leaf, name);
    assert.ok(itemLabel(data.FILTER_ITEMS_BY_ID.get(`unique:${idByName(base)}`), "cn").includes(cn), name);
    assert.match(metadata.uniques[base][name], /^https:\/\/cdn\.poe2db\.tw\/image\//, name);
  }
  // 物品列表里没有的传奇不在目录里。
  for (const name of ["Siegebreaker", "Kaom's Roots", "The Fallen Formation", "Forbidden Gaze", "Merit of Service", "Wylund's Stake", "The Deepest Tower", "Thunderstep"]) {
    assert.equal(Object.values(metadata.uniques).some((variants) => name in variants), false, name);
    assert.equal(name in metadata.localizedUniqueNames, false, name);
  }
  // 药瓶、咒符、石板和圣物上的传奇也各归「传奇」下对应的叶子，每件基底一个条目。
  const uniqueLeaf = (base) => pathOf("unique:" + idByName(base));
  assert.equal(uniqueLeaf("Golden Charm"), "uniques/accessories/charms");
  assert.equal(itemLabel(data.FILTER_ITEMS_BY_ID.get(`unique:${idByName("Golden Charm")}`), "cn"), metadata.localizedUniqueNames["Rite of Passage"].cn);
  assert.equal(uniqueLeaf("Ultimate Life Flask"), "uniques/accessories/flasks");
  assert.equal(uniqueLeaf("Irradiated Tablet"), "uniques/misc/tablets");
  assert.equal(uniqueLeaf("Incense Relic"), "uniques/misc/relics");
  const count = (leaf) => data.PICKER_ITEMS.filter((item) => item.category === "unique" && pathOf(item.id) === leaf).length;
  assert.deepEqual(Object.fromEntries(["charms", "flasks"].map((key) => [key, count("uniques/accessories/" + key)])), { charms: 12, flasks: 5 });
  assert.deepEqual(Object.fromEntries(["tablets", "relics"].map((key) => [key, count("uniques/misc/" + key)])), { tablets: 7, relics: 6 });
  // 传奇是独立的顶层分类，不在装备下；装备下面只有普通基底。
  assert.ok(data.PICKER_ITEMS.filter((item) => item.categoryPath[0] === "equipment").every((item) => item.category !== "unique"));
  assert.equal(data.PICKER_ITEMS.filter((item) => item.categoryPath[0] === "uniques").length, 372);
});

test("通货、材料和钥匙各在自己的分类里", () => {
  // 分类照物品列表：标成「不存在」的 11 把圣物厅钥匙和几种神器碎片归在「其他 › 不存在」。
  for (const [name, expected] of [
    ["Lesser Tempered Rune", "runes/normal"],
    ["Soul Core of Vizoma", "runes/greater-soul-cores"],
    ["Exotic Coinage", "other/unavailable"],
    ["Sun Artifact", "other/unavailable"],
    ["Origin Core", "endgame/keys"],
    ["Ancient Crisis Fragment", "endgame/keys"],
    ["Azmeri Reliquary Key", "endgame/vault-keys"],
    ["Zarokh's Reliquary Key: Temporalis", "endgame/vault-keys"],
    ["Bronze Key", "endgame/sekhema-trials"],
    ["Silver Key", "endgame/sekhema-trials"],
    ["Gold Key", "endgame/sekhema-trials"],
    ["Ancient Reliquary Key", "other/unavailable"],
    ["Vaal Reliquary Key", "other/unavailable"],
  ]) {
    const id = idByName(name);
    assert.equal(pathOf(id), expected, name);
    assert.ok(pickerIds.has(id), name);
    assert.equal(catalog.items.find((item) => item.id === id).localeNames.tw !== name, true, name + " 缺繁体名");
  }
  // 可堆叠名单按物品详情里的堆叠上限：灵魂核心和符文可堆叠，钥匙和钥匙碎片不堆叠。
  assert.ok(metadata.stackable.includes("Exotic Coinage") && metadata.stackable.includes("Ward Rune"));
  for (const name of ["Ancient Crisis Fragment", "Azmeri Reliquary Key", "Bronze Key"]) assert.equal(metadata.stackable.includes(name), false, name);
  // 物品列表里没有的物品不在目录里。
  for (const name of ["Alchemy Shard", "Rogue's Marker", "Omen of Recombination", "Mutated Verisium", "Styrn's Anthem"]) assert.equal(idByName(name), undefined, name);
  // 图标：图床上的完整地址。
  assert.match(metadata.items["Juggernaut Plate"].icon, /^https:\/\/cdn\.poe2db\.tw\/image\//);
});

test("选择器里没有按名字片段匹配的词", () => {
  // 物品列表的 1585 件物品里有 1584 件是逐件条目（远征日志是一件整类条目），加只给传奇挂基底的 5 件和 40 个整类条目。
  assert.equal(catalog.items.length, 1629);
  for (const item of data.PICKER_ITEMS) assert.notEqual(item.categoryPath.join("/"), "other/other-items", item.id);
  for (const id of ["gargantuan", "grand", "ultimate", "liquid", "omen", "rune", "tower-shield"]) {
    assert.equal(data.FILTER_ITEMS_BY_ID.has(id), false, id);
  }
});

test("名字写法和 NeverSink 不同的两颗宝石按游戏数据里的类别归类", () => {
  const fist = data.FILTER_ITEMS_BY_ID.get("fist-of-kalguur");
  const fragments = data.FILTER_ITEMS_BY_ID.get("fragments-of-the-past");
  // 卡古兰之拳是符文辅助宝石，往昔碎片是符文技能宝石，物品列表把两种都归在「技能 › 符文技能」。
  assert.equal(pathOf("fist-of-kalguur"), "gems/runic");
  assert.equal(pathOf("fragments-of-the-past"), "gems/runic");
  assert.equal(itemLabel(fist, "cn"), "卡古兰之拳");
  assert.equal(itemLabel(fragments, "cn"), "往昔碎片");
  assert.ok(pickerIds.has(fist.id) && pickerIds.has(fragments.id));
});

test("读取方案时去掉目录里已经没有的物品，不认识的仍然报错", () => {
  // 退役的 ID：只出传奇的基底以前有普通变体，物品列表里没有的物品和没有的宝石等级曾经收录过。
  const retired = ["base:runic-fork", "base:ancient-mail", "gargantuan", "uncut-spirit-gem-1", "alchemy-shard"];
  for (const id of retired) assert.ok(data.RETIRED_ITEM_IDS.has(id), id);
  const profile = build([
    itemRule("rule", [...retired.filter((id) => id !== "base:ancient-mail"), "exalted-orb", "chaos-orb"]),
    itemRule("disabled", ["base:runic-fork"], { enabled: false }),
  ], ["base:ancient-mail", "divine-orb"]);
  assert.deepEqual(profile.rules.map((rule) => rule.target.itemIds), [["exalted-orb", "chaos-orb"], []]);
  assert.deepEqual(profile.skippedItemIds, ["divine-orb"]);
  assert.throws(() => build([itemRule("rule", ["not-a-real-item"])]), /规则物品无效/);
  assert.throws(() => build([itemRule("rule", ["exalted-orb"])], ["not-a-real-item"]), /跳过物品无效/);
  // 一条启用的规则去掉之后没有任何物品，也没有价格条件。
  assert.throws(() => build([itemRule("rule", ["base:runic-fork"])]), /规则至少要选择物品或价格区间/);
});

test("分享码目录带着物品目录的版本", () => {
  assert.equal(catalog.catalogVersion, 1);
  assert.equal(data.CATALOG_VERSION, catalog.catalogVersion);
  assert.equal(data.shareCatalog().version, catalog.catalogVersion);
});

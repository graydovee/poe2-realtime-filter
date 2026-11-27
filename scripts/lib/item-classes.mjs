import fs from "node:fs";

/**
 * 物品的分类：选择器里的分类树和「客户端记录 → 分类路径」的规则。
 *
 * 分类树是 data/item-categories.json，层级、名字和顺序照物品列表里的分类。
 * 每件物品归到哪个叶子由客户端 BaseItemTypes 表的记录决定：物品类别编号（ItemClass）、标签（Tags）和编号（Id）。
 * 规则 reproduce 物品列表的归属，tests/item-categories.test.mjs 拿参考数据（data/item-category-reference.json）逐件核对。
 */

/** 分类树。每个节点有 key、三语名字 name，可以有 children；uniques 是这件物品上的传奇所在的叶子（"a/b/c"）。 */
export const CATEGORY_TREE = JSON.parse(fs.readFileSync(new URL("../../data/item-categories.json", import.meta.url), "utf8"));

/** 按选择器里的显示顺序列出全部节点：路径（"a/b/c"）、节点、是不是叶子。 */
export const CATEGORY_NODES = (() => {
  const nodes = [];
  const walk = (children, prefix) => {
    for (const node of children) {
      const path = [...prefix, node.key].join("/");
      nodes.push({ path, node, leaf: !node.children?.length });
      if (node.children) walk(node.children, [...prefix, node.key]);
    }
  };
  walk(CATEGORY_TREE.roots, []);
  return nodes;
})();

export const LEAF_PATHS = CATEGORY_NODES.filter((entry) => entry.leaf).map((entry) => entry.path);
const NODE_BY_PATH = new Map(CATEGORY_NODES.map((entry) => [entry.path, entry.node]));
const pathKey = (path) => path.join("/");

/** 这件物品上的传奇所在的分类路径；这个叶子不出传奇时返回 undefined。 */
export const uniquePathFor = (path) => NODE_BY_PATH.get(pathKey(path))?.uniques?.split("/") ?? undefined;

/**
 * 游戏数据里有、当前不会掉落的物品。物品列表把它们归在「其他 › 不存在」，这份名单跟着物品列表。
 * 其余分类都由规则算出来，这一类没有可依据的字段。
 */
export const UNAVAILABLE = new Set([
  "Sun Artifact", "Order Artifact", "Exotic Coinage", "Broken Circle Artifact", "Black Scythe Artifact", "Petition Splinter", "Runic Splinter",
  "Idol of Estazunti", "Omen of Corruption", "Founders Verisium",
  "Voidborn Reliquary Key", "Visceral Reliquary Key", "Vaal Reliquary Key", "Timeworn Reliquary Key", "Shiny Reliquary Key", "Oubliette Reliquary Key",
  "Forgotten Reliquary Key", "Decaying Reliquary Key", "Cosmic Reliquary Key", "Archive Reliquary Key", "Ancient Reliquary Key",
]);

/** 装备类别的编号。这些类别里的每一行都是一个装备基底，选择器给它们分成普通基底和传奇两种条目。 */
export const EQUIPMENT_CLASSES = new Set(CATEGORY_TREE.itemClasses.equipment);
/** 装备之外会出传奇的基底：药瓶、咒符和石板。 */
export const UNIQUE_BASE_CLASSES = new Set([...EQUIPMENT_CLASSES, ...CATEGORY_TREE.itemClasses.uniqueBases]);

/** 客户端的物品类别编号 → 过滤器里 Class 条件用的类名。 */
export const ITEM_CLASS_NAMES = {
  0: "Life Flasks", 1: "Mana Flasks", 4: "Amulets", 5: "Rings", 8: "Wands", 12: "One Hand Maces", 13: "Bows",
  14: "Staves", 17: "Two Hand Maces", 18: "Skill Gems", 19: "Support Gems", 20: "Quivers", 21: "Belts", 22: "Gloves",
  23: "Boots", 24: "Body Armours", 25: "Helmets", 26: "Shields", 30: "Stackable Currency", 31: "Quest Items", 32: "Sceptres", 33: "Charms",
  35: "Waystones", 38: "Map Fragments", 39: "Map Fragments", 42: "Jewels", 47: "Inscribed Ultimatum", 58: "Quarterstaves", 74: "Expedition Logbook", 75: "Expedition Logbook",
  76: "Incubators", 78: "Skill Gems", 79: "Spears", 80: "Crossbows", 81: "Foci", 86: "Relics", 88: "Map Fragments", 90: "Vault Keys",
  91: "Trial Coins", 94: "Bucklers", 106: "Augment", 107: "Tablet", 108: "Omen", 109: "Pinnacle Keys", 110: "Talismans",
  111: "Skill Gems", 112: "Support Gems", 113: "Spirit Gems", 116: "Wombgifts", 117: "Pinnacle Keys",
};

/**
 * 整类条目（过滤器里写 Class 条件的那些）在目录里的分类路径。它们不是可选物品，这条路径只说明它代表哪一类物品。
 * 一个类别的物品分布在几个叶子里时（头盔按属性分成七个，盾牌分成三个，预兆分在四个玩法下），写它所在的分组。
 */
export const CLASS_ENTRY_PATHS = {
  "Body Armours": ["equipment", "body-armour"], Boots: ["equipment", "boots"], Gloves: ["equipment", "gloves"], Helmets: ["equipment", "helmets"],
  Bows: ["equipment", "two-hand", "bows"], Crossbows: ["equipment", "two-hand", "crossbows"], Wands: ["equipment", "one-hand", "wands"],
  Staves: ["equipment", "two-hand", "staves"], "One Hand Maces": ["equipment", "one-hand", "one-hand-maces"],
  "Two Hand Maces": ["equipment", "two-hand", "two-hand-maces"], Quarterstaves: ["equipment", "two-hand", "quarterstaves"],
  Sceptres: ["equipment", "one-hand", "sceptres"], Spears: ["equipment", "one-hand", "spears"], Talismans: ["equipment", "two-hand", "talismans"],
  Amulets: ["equipment", "accessories", "amulets"], Rings: ["equipment", "accessories", "rings"], Belts: ["equipment", "accessories", "belts"],
  Jewels: ["equipment", "accessories", "jewels"], Shields: ["equipment", "off-hand"], Foci: ["equipment", "off-hand", "foci"],
  Quivers: ["equipment", "off-hand", "quivers"], Bucklers: ["equipment", "off-hand", "bucklers"],
  "Life Flasks": ["equipment", "accessories", "flasks"], "Mana Flasks": ["equipment", "accessories", "flasks"], Charms: ["equipment", "accessories", "charms"],
  "Skill Gems": ["gems", "runic"], "Support Gems": ["gems", "lineage"],
  "Quest Items": ["other", "quest-items"], "Instance Local Items": ["other", "quest-items"],
  "Expedition Logbook": ["gameplay", "expedition", "fragments"], "Vault Keys": ["endgame", "vault-keys"], "Pinnacle Keys": ["endgame", "keys"],
  Waystones: ["endgame", "waystones"], Omen: ["gameplay", "ritual", "equipment-omens"], "Augment": ["runes", "normal"],
  Incubators: ["gameplay", "temple", "currency"], "Stackable Currency": ["currency", "currency"],
  "Map Fragments": ["gameplay", "ritual", "fragments"], Tablet: ["endgame", "tablets"], "Fishing Rods": ["other", "quest-items"],
};

// 客户端标签的编号。
const ATTRIBUTE_TAG = { 38: "str", 39: "dex", 40: "int", 41: "str-dex", 42: "str-int", 43: "dex-int", 44: "str-dex-int" };
const RUNE_TAG = 1165, RUNIC_GEM_TAG = 1252, IDOL_TAG = 305, SOUL_CORE_TAG = 1104;
const ESSENCE_TAG = 303, CATALYST_TAG = 621, REFINED_CATALYST_TAG = 1244, OIL_TAG = 463, SHARD_TAG = 232, QUALITY_TAG = 350, TEMPLE_TAG = 1322;
const ONE_HAND = { 8: "wands", 12: "one-hand-maces", 32: "sceptres", 79: "spears" };
const TWO_HAND = { 13: "bows", 14: "staves", 17: "two-hand-maces", 58: "quarterstaves", 80: "crossbows", 110: "talismans" };
const ACCESSORY = { 4: "amulets", 5: "rings", 21: "belts", 42: "jewels" };
const ARMOUR = { 22: "gloves", 23: "boots", 24: "body-armour", 25: "helmets" };
const TIERED_ORB = /^Currency\/Currency(?:RerollRare|AddModToRare|UpgradeMagicToRare|AddModToMagic|UpgradeToMagic|AddSkillGemSocket)\d*$/;
// 地图预兆的编号：影响地图、怪物、神龛、商人这些的预兆，其余的 Omen 都是作用在一件物品上的装备预兆。
const MAP_OMEN = /Map|LowLife|Death|Strongbox|Tormented|RogueExile|Shrine|SellVendor|Gamble/;
const CORRUPTED_ESSENCE = /^Essence of (?:the )?(?:Hysteria|Horror|Delirium|Breach|Abyss|Insanity)$/;

const has = (record, tag) => record.Tags?.includes(tag) ?? false;
/** 编号去掉固定的前缀，剩下能看出玩法的路径。 */
const shortId = (record) => String(record.Id ?? "").replace(/^Metadata\/Items\//, "");

function fragmentPath(record) {
  const id = shortId(record);
  if (/^Ultimatum\//.test(id)) return ["endgame", "chaos-trials"];
  if (/^Pinnacle\/(?:PinnacleKey|BurningMonolithKey|Mothersoul)/.test(id)) return ["endgame", "keys"];
  if (/Breach/.test(id)) return ["gameplay", "breach", "fragments"];
  if (/Affliction|Delirium/.test(id)) return ["gameplay", "delirium", "fragments"];
  if (/Expedition/.test(id)) return ["gameplay", "expedition", "fragments"];
  if (/Abyss/.test(id)) return ["gameplay", "abyss", "fragments"];
  if (/Ritual|Wildwood/.test(id)) return ["gameplay", "ritual", "fragments"];
  return undefined;
}

/** 符文、灵魂核心和魔偶都是客户端的 Augment 类别（106），按标签分，标签分不出的档次看编号。 */
function augmentPath(record) {
  const id = shortId(record);
  // 深渊的凝视和神庙的圣典带着各自玩法的标签。
  if (has(record, 1189)) return ["gameplay", "abyss", "runes"];
  if (has(record, 1109)) return ["gameplay", "temple", "cores"];
  if (has(record, SOUL_CORE_TAG)) {
    // 灵核维斯玛的标签和普通核心一样，物品列表把它归在高级核心。
    return ["runes", has(record, 1107) || has(record, 1108) || id === "SoulCores/SoulCoreVision" ? "greater-soul-cores" : "soul-cores"];
  }
  // 高级魔偶的编号带着 Special、Corrupted，或者是 Carved 开头；雕琢的四个在客户端里挂的是符文标签。
  if (has(record, IDOL_TAG) || /^SoulCores\/Carved/.test(id)) {
    return ["runes", /^SoulCores\/(?:TalismanSpecial|IdolSpecial|IdolCorrupted|IdolHawk|Carved)/.test(id) ? "greater-idols" : "idols"];
  }
  if (has(record, RUNE_TAG)) {
    if (has(record, 1152) || has(record, 1153) || has(record, 1154)) return ["runes", "normal"];
    if (has(record, 1155)) return ["runes", "perfect"];
    return ["runes", /^SoulCores\/Rune(?:OfTheAncients|Special|WardSpecial)/.test(id) ? "greater" : "special"];
  }
  return undefined;
}

/** 通货（Stackable Currency，30）里混着各种玩法的材料，依次看标签和编号。 */
function currencyPath(record, name) {
  const id = shortId(record);
  if (has(record, ESSENCE_TAG)) {
    if (CORRUPTED_ESSENCE.test(name)) return ["essences", "corrupted"];
    if (/^Perfect Essence/.test(name)) return ["essences", "perfect"];
    if (/^Greater Essence/.test(name)) return ["essences", "greater"];
    return ["essences", "normal"];
  }
  if (has(record, REFINED_CATALYST_TAG)) return ["gameplay", "breach", "refined-catalysts"];
  if (has(record, CATALYST_TAG)) return ["gameplay", "breach", "catalysts"];
  if (has(record, OIL_TAG)) return ["gameplay", "delirium", /^Ancient /.test(name) ? "ancient-oils" : "oils"];
  if (/AbyssalBenchTicket/.test(id)) return ["gameplay", "abyss", "bones"];
  if (/CurrencyBreachShard$/.test(id)) return ["gameplay", "breach", "fragments"];
  if (/CurrencyAfflictionShard$/.test(id)) return ["gameplay", "delirium", "fragments"];
  if (/^Currency\/Expedition\/ExpeditionPinnacleKeyShard$/.test(id)) return ["gameplay", "expedition", "fragments"];
  if (/^Currency\/CurrencyVerisiumAlloy/.test(id)) return ["gameplay", "expedition", "alloys"];
  // 维金矿石和它的几个变种：维金、精品维金、液体维金，还有几件传奇专属的星辉矿石。
  if (/^Currency\/CurrencyVerisium(?:Metal|Ore)/.test(id) || id === "Currency/CurrencyRerollRemnant") return ["gameplay", "expedition", "anvils"];
  if (/ Flux$/.test(name) || id === "Currency/CurrencyUpgradeInherentTo20") return ["gameplay", "expedition", "solvents"];
  if (/^Sanctum\//.test(id)) return ["endgame", "sekhema-trials"];
  if (has(record, TEMPLE_TAG)) return ["gameplay", "temple", "currency"];
  if (has(record, QUALITY_TAG)) return ["currency", "quality"];
  if (TIERED_ORB.test(id)) return ["currency", "tiered"];
  if (has(record, SHARD_TAG) || /^Currency\/(?:GoldCoin|CurrencyIdentification|CurrencyAddEquipmentSocket)$/.test(id)) return ["currency", "shards"];
  return ["currency", "currency"];
}

/**
 * 按客户端记录给一件物品定分类路径：叶子在分类树里的路径，例如 ["equipment", "helmets", "str"]。
 * 类别没有登记、或者记录缺着定属性要用的标签时返回 undefined。
 */
export function categoryPathFor(record, name = record.Name) {
  const uncut = /^Uncut (Skill|Spirit|Support) Gem \(Level \d+\)$/.exec(name);
  if (uncut) return ["gems", uncut[1].toLowerCase()];
  if (UNAVAILABLE.has(name)) return ["other", "unavailable"];
  const attribute = ATTRIBUTE_TAG[record.Tags?.find((tag) => tag in ATTRIBUTE_TAG) ?? ""];
  switch (record.ItemClass) {
    case 0: case 1: return ["equipment", "accessories", "flasks"];
    case 33: return ["equipment", "accessories", "charms"];
    case 4: case 5: case 21: case 42: return ["equipment", "accessories", ACCESSORY[record.ItemClass]];
    case 8: case 12: case 32: case 79: return ["equipment", "one-hand", ONE_HAND[record.ItemClass]];
    case 13: case 14: case 17: case 58: case 80: case 110: return ["equipment", "two-hand", TWO_HAND[record.ItemClass]];
    case 20: return ["equipment", "off-hand", "quivers"];
    case 81: return ["equipment", "off-hand", "foci"];
    case 94: return ["equipment", "off-hand", "bucklers"];
    case 26: return attribute ? ["equipment", "off-hand", "shields-" + attribute] : undefined;
    case 22: case 23: case 24: case 25: return attribute ? ["equipment", ARMOUR[record.ItemClass], attribute] : undefined;
    case 86: return ["endgame", "sekhema-trials"];
    case 18: case 78: return ["gems", "runic"];
    // 符文辅助宝石带符文标签（1252）、掉落等级是 1；血脉宝石的掉落等级是 65，其中两颗也带着符文标签。
    case 19: return has(record, RUNIC_GEM_TAG) && record.DropLevel === 1 ? ["gems", "runic"] : ["gems", "lineage"];
    case 111: return ["gems", "skill"];
    case 113: return ["gems", "spirit"];
    case 112: return ["gems", "support"];
    case 106: return augmentPath(record);
    case 116: return ["gameplay", "breach", "legacies"];
    case 108: {
      const id = shortId(record);
      if (/^Expedition\//.test(id)) return ["gameplay", "expedition", "omens"];
      if (/Abyss/.test(id)) return ["gameplay", "abyss", "omens"];
      return ["gameplay", "ritual", MAP_OMEN.test(id) ? "map-omens" : "equipment-omens"];
    }
    case 107: return ["endgame", "tablets"];
    // 孵化器里只有神庙的瓦尔孵卵器是掉落的物品。
    case 76: return /^Currency\/CurrencyIncursion/.test(shortId(record)) ? ["gameplay", "temple", "currency"] : undefined;
    case 35: return ["endgame", "waystones"];
    case 90: return ["endgame", "vault-keys"];
    case 74: case 75: return ["gameplay", "expedition", "fragments"];
    case 47: return ["endgame", "chaos-trials"];
    case 91: return ["endgame", "sekhema-trials"];
    case 38: case 39: case 88: case 109: case 117: return fragmentPath(record);
    // 泰瑟奇术通量是按等级卖的符文技能宝石，在客户端里是一件通货。
    case 30: return /^Currency\/CurrencySetKalguuranSkillGemLevel\d+$/.test(shortId(record)) ? ["gems", "runic"] : currencyPath(record, name);
    default: return undefined;
  }
}

/** 同名记录可以分属几个类别（巅峰钥匙碎片同时也是任务物品），取类别登记过分类的那一条。 */
export const classifiedRecord = (entry, name = entry.name) => entry?.records.find((record) => categoryPathFor(record, name));

/**
 * 给目录里的每件物品定分类路径，就地改写 categoryPath。整类条目不是可选物品，它的路径只说明它代表哪一类物品。
 * 客户端表里没有、或者类别还没登记分类的物品放进「其他物品」，返回它们的名字。
 */
export function categorizeCatalog(catalog, client) {
  const unclassified = [];
  for (const item of catalog.items) {
    if (item.matcher.class) {
      item.categoryPath = [...(CLASS_ENTRY_PATHS[item.matcher.class] ?? ["other"]), "class-selection"];
      continue;
    }
    // 按不区分大小写查找客户端记录，物品名在两边的大小写写法可能不同。
    const record = classifiedRecord(client.byLowerName.get(item.name.toLowerCase()), item.name);
    if (record) item.categoryPath = categoryPathFor(record, item.name);
    else {
      item.categoryPath = ["other", "other-items"];
      unclassified.push(item.name);
    }
  }
  return unclassified;
}

const attributeLeaves = (theirPrefix, group) => Object.fromEntries(
  [["str", "str"], ["dex", "dex"], ["int", "int"], ["str_dex", "str-dex"], ["str_int", "str-int"], ["dex_int", "dex-int"], ["str_dex_int", "str-dex-int"]]
    .map(([their, mine]) => [theirPrefix + "/" + theirPrefix + "_" + their, ["equipment", group, mine]]),
);
const typeLeaves = (theirPrefix, group, types) => Object.fromEntries(types.map(([their, mine]) => [theirPrefix + their, ["equipment", group, mine]]));

/**
 * 物品列表里的叶子（"分类/子分类"）→ 分类树里的路径。tests/item-categories.test.mjs 用它核对规则的结果。
 */
export const LIST_LEAF_PATHS = Object.fromEntries(Object.entries({
  "currency/currency_items": ["currency", "currency"], "currency/tiered_currency": ["currency", "tiered"],
  "currency/quality_currency": ["currency", "quality"], "currency/currency_shards": ["currency", "shards"],
  "unique_one_hand_weapons/unique_one_hand_maces": ["uniques", "one-hand", "one-hand-maces"], "unique_one_hand_weapons/unique_wands": ["uniques", "one-hand", "wands"],
  "unique_one_hand_weapons/unique_sceptres": ["uniques", "one-hand", "sceptres"], "unique_one_hand_weapons/unique_spears": ["uniques", "one-hand", "spears"],
  "unique_two_hand_weapons/unique_bows": ["uniques", "two-hand", "bows"], "unique_two_hand_weapons/unique_talismans": ["uniques", "two-hand", "talismans"],
  "unique_two_hand_weapons/unique_crossbows": ["uniques", "two-hand", "crossbows"], "unique_two_hand_weapons/unique_two_hand_maces": ["uniques", "two-hand", "two-hand-maces"],
  "unique_two_hand_weapons/unique_quarterstaves": ["uniques", "two-hand", "quarterstaves"], "unique_two_hand_weapons/unique_staves": ["uniques", "two-hand", "staves"],
  "unique_off_hand/unique_shields": ["uniques", "off-hand", "shields"], "unique_off_hand/unique_foci": ["uniques", "off-hand", "foci"],
  "unique_off_hand/unique_quivers": ["uniques", "off-hand", "quivers"], "unique_off_hand/unique_bucklers": ["uniques", "off-hand", "bucklers"],
  "unique_equipment/unique_body_armours": ["uniques", "equipment", "body-armour"], "unique_equipment/unique_gloves": ["uniques", "equipment", "gloves"],
  "unique_equipment/unique_helmets": ["uniques", "equipment", "helmets"], "unique_equipment/unique_boots": ["uniques", "equipment", "boots"],
  "unique_accessories/unique_rings": ["uniques", "accessories", "rings"], "unique_accessories/unique_amulets": ["uniques", "accessories", "amulets"],
  "unique_accessories/unique_belts": ["uniques", "accessories", "belts"], "unique_accessories/unique_charms": ["uniques", "accessories", "charms"],
  "unique_accessories/unique_flasks": ["uniques", "accessories", "flasks"], "unique_accessories/unique_jewels": ["uniques", "accessories", "jewels"],
  "unique_misc/unique_tablet": ["uniques", "misc", "tablets"], "unique_misc/relics": ["uniques", "misc", "relics"],
  "breach/catalysts": ["gameplay", "breach", "catalysts"], "breach/refined_catalysts": ["gameplay", "breach", "refined-catalysts"],
  "breach/breach_legacies": ["gameplay", "breach", "legacies"], "breach/breach_fragments": ["gameplay", "breach", "fragments"],
  "delirium/time_lost_jewels": ["gameplay", "delirium", "ancient-oils"], "delirium/delirium_jewels": ["gameplay", "delirium", "oils"],
  "delirium/delirium_fragments": ["gameplay", "delirium", "fragments"],
  "ritual/equipment_omens": ["gameplay", "ritual", "equipment-omens"], "ritual/map_omens": ["gameplay", "ritual", "map-omens"],
  "ritual/ritual_fragments": ["gameplay", "ritual", "fragments"],
  "expedition/alloys": ["gameplay", "expedition", "alloys"], "expedition/anvils": ["gameplay", "expedition", "anvils"],
  "expedition/solvents": ["gameplay", "expedition", "solvents"], "expedition/expedition_omens": ["gameplay", "expedition", "omens"],
  "expedition/expedition_fragments": ["gameplay", "expedition", "fragments"],
  "abyss/abyss_bones": ["gameplay", "abyss", "bones"], "abyss/abyss_omens": ["gameplay", "abyss", "omens"],
  "abyss/abyss_runes": ["gameplay", "abyss", "runes"], "abyss/abyss_fragments": ["gameplay", "abyss", "fragments"],
  "temple/temple_currency": ["gameplay", "temple", "currency"], "temple/temple_cores": ["gameplay", "temple", "cores"],
  "endgame/endgame_keys": ["endgame", "keys"], "endgame/waystones": ["endgame", "waystones"], "endgame/tablets": ["endgame", "tablets"],
  "endgame/vault_keys": ["endgame", "vault-keys"], "endgame/sekhema_trials": ["endgame", "sekhema-trials"], "endgame/chaos_trials": ["endgame", "chaos-trials"],
  "runes/special_runes": ["runes", "special"], "runes/greater_runes": ["runes", "greater"], "runes/soul_cores": ["runes", "soul-cores"],
  "runes/greater_soul_cores": ["runes", "greater-soul-cores"], "runes/idols": ["runes", "idols"], "runes/greater_idols": ["runes", "greater-idols"],
  "runes/normal_runes": ["runes", "normal"], "runes/perfect_runes": ["runes", "perfect"],
  "essences/corrupted_essences": ["essences", "corrupted"], "essences/perfect_essences": ["essences", "perfect"],
  "essences/greater_essences": ["essences", "greater"], "essences/normal_essences": ["essences", "normal"],
  "skills_gem/lineage_gem": ["gems", "lineage"], "skills_gem/skill_gems": ["gems", "skill"], "skills_gem/spirit_gems": ["gems", "spirit"],
  "skills_gem/support_gems": ["gems", "support"], "skills_gem/runic_skills": ["gems", "runic"],
  ...typeLeaves("accessories/", "accessories", [["rings", "rings"], ["amulets", "amulets"], ["belts", "belts"], ["charms", "charms"], ["flasks", "flasks"], ["jewels", "jewels"]]),
  ...typeLeaves("one_hand_weapons/", "one-hand", [["one_hand_maces", "one-hand-maces"], ["wands", "wands"], ["sceptres", "sceptres"], ["spears", "spears"]]),
  ...typeLeaves("two_hand_weapons/", "two-hand", [["bows", "bows"], ["talismans", "talismans"], ["crossbows", "crossbows"], ["two_hand_maces", "two-hand-maces"], ["quarterstaves", "quarterstaves"], ["staves", "staves"]]),
  ...typeLeaves("off_hand/", "off-hand", [["shields_str", "shields-str"], ["shields_str_dex", "shields-str-dex"], ["shields_str_int", "shields-str-int"], ["foci", "foci"], ["quivers", "quivers"], ["bucklers", "bucklers"]]),
  ...attributeLeaves("helmets", "helmets"), ...attributeLeaves("gloves", "gloves"), ...attributeLeaves("body_armours", "body-armour"), ...attributeLeaves("boots", "boots"),
  "misc/unavailable_items": ["other", "unavailable"],
}).map(([leaf, path]) => [leaf, path.join("/")]));

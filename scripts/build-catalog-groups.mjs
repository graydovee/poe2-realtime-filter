import fs from "node:fs";
import path from "node:path";

const clientRoot = process.argv[2];
if (!clientRoot) throw new Error("Usage: node scripts/build-catalog-groups.mjs <client-version-directory>");
const records = new Map();
for (const line of fs.readFileSync(path.join(clientRoot, "us/BaseItemTypes.jsonl"), "utf8").trim().split("\n")) {
  const record = JSON.parse(line);
  if (record.Name && !records.has(record.Name)) records.set(record.Name, record);
}
const classPaths = {
  0: ["supplies", "flasks", "life"], 1: ["supplies", "flasks", "mana"],
  4: ["equipment", "jewellery", "amulets"], 5: ["equipment", "jewellery", "rings"], 21: ["equipment", "jewellery", "belts"],
  8: ["equipment", "weapons", "wands"], 12: ["equipment", "weapons", "one-hand-maces"],
  13: ["equipment", "weapons", "bows"], 14: ["equipment", "weapons", "staves"],
  17: ["equipment", "weapons", "two-hand-maces"], 32: ["equipment", "weapons", "sceptres"],
  58: ["equipment", "weapons", "quarterstaves"], 79: ["equipment", "weapons", "spears"],
  80: ["equipment", "weapons", "crossbows"], 110: ["equipment", "weapons", "talismans"],
  20: ["equipment", "offhands", "quivers"], 26: ["equipment", "offhands", "shields"],
  81: ["equipment", "offhands", "foci"], 94: ["equipment", "offhands", "bucklers"],
  22: ["equipment", "armour", "gloves"], 23: ["equipment", "armour", "boots"],
  24: ["equipment", "armour", "body-armour"], 25: ["equipment", "armour", "helmets"],
  42: ["equipment", "jewels"], 86: ["equipment", "relics"],
  18: ["gems", "skill-gems"], 19: ["gems", "support-gems"], 78: ["gems", "gem-materials"],
  93: ["gems", "uncut", "skill-gems"], 103: ["gems", "uncut", "support-gems"], 104: ["gems", "uncut", "spirit-gems"],
  31: ["other", "quest-items"], 33: ["supplies", "charms"],
  38: ["endgame", "fragments"], 39: ["endgame", "fragments"], 88: ["endgame", "fragments"],
  47: ["endgame", "trials", "ultimatums"], 102: ["endgame", "trials", "ultimatums"],
  91: ["endgame", "trials", "baryas"], 90: ["endgame", "vault-keys"],
  74: ["endgame", "logbooks"], 75: ["endgame", "logbooks"], 76: ["endgame", "incubators"],
  107: ["endgame", "tablets"], 108: ["crafting", "omens"],
  116: ["other", "special-items"], 117: ["endgame", "pinnacle-keys"],
};
const matcherPaths = {
  "Body Armours": classPaths[24], Boots: classPaths[23], Gloves: classPaths[22], Helmets: classPaths[25],
  Bows: classPaths[13], Crossbows: classPaths[80], Wands: classPaths[8], Staves: classPaths[14],
  Sceptres: classPaths[32], Spears: classPaths[79], Quarterstaves: classPaths[58], Talismans: classPaths[110],
  "One Hand Maces": classPaths[12], "Two Hand Maces": classPaths[17],
  Amulets: classPaths[4], Rings: classPaths[5], Belts: classPaths[21],
  Shields: classPaths[26], Foci: classPaths[81], Quivers: classPaths[20], Bucklers: classPaths[94],
  "Life Flasks": classPaths[0], "Mana Flasks": classPaths[1], Charms: classPaths[33],
  "Skill Gems": classPaths[18], "Support Gems": classPaths[19], Jewels: classPaths[42],
  "Quest Items": classPaths[31], "Instance Local Items": classPaths[31],
  "Expedition Logbook": classPaths[74], "Vault Keys": classPaths[90], "Pinnacle Keys": classPaths[117],
  Waystones: ["endgame", "waystones"], Omen: classPaths[108], Augment: classPaths[107],
  Incubators: classPaths[76], "Stackable Currency": ["crafting", "currency"],
};
function categoryPath(item) {
  const record = records.get(item.name);
  if (record?.ItemClass === 30) {
    if (/\bEssence\b/.test(item.name)) return ["crafting", "essences"];
    if (/\bCatalyst\b/.test(item.name)) return ["crafting", "catalysts"];
    if (/\b(?:Splinter|Shard)\b/.test(item.name)) return ["crafting", "shards"];
    if (/\b(?:Liquid|Distilled)\b/.test(item.name)) return ["crafting", "emotions"];
    return ["crafting", "currency"];
  }
  if (record?.ItemClass === 106) {
    return ["crafting", "socketables", /\bRune\b/.test(item.name) ? "runes" : /Soul Core/.test(item.name) ? "soul-cores" : "socketables-other"];
  }
  if (record && classPaths[record.ItemClass]) return classPaths[record.ItemClass];
  if (item.matcher.class && matcherPaths[item.matcher.class]) return [...matcherPaths[item.matcher.class], "class-selection"];
  return ["other", item.matcher.class ? "class-selection" : "other-items"];
}
const catalogFile = path.resolve("data/item-catalog.json");
const catalog = JSON.parse(fs.readFileSync(catalogFile, "utf8"));
for (const item of catalog.items) item.categoryPath = categoryPath(item);
fs.writeFileSync(catalogFile, JSON.stringify(catalog, null, 2) + "\n");
console.log("Grouped " + catalog.items.length + " items using client ItemClass metadata");

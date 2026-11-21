/**
 * 通货与材料（crafting）分支的分组。
 *
 * 分组口径直接跟随 poe.ninja 的 PoE2 经济标签页（Currency / Fragments / Abyssal Bones /
 * Essences / Omens / Expedition / Liquid Emotions / Catalysts / Verisium），
 * 唯一新增的分组是从 Currency 里拆出来的「神庙」（阿兹里神庙专属通货）。
 *
 * 归属由 scripts/build-item-mechanics.mjs 生成：先取 poe.ninja 标签页，
 * 商店未收录的条目回落到 poe2wiki 的分类 / tags / drop_text 与名称族。
 */

export const GROUPS = {
  currency: { cn: "基础通货", tw: "基礎通貨", us: "Currency" },
  shards: { cn: "碎片", tw: "碎片", us: "Fragments" },
  bones: { cn: "深渊骨骸", tw: "深淵骨骸", us: "Abyssal Bones" },
  omens: { cn: "预兆", tw: "預兆", us: "Omens" },
  expedition: { cn: "探险", tw: "探險", us: "Expedition" },
  emotions: { cn: "液化情绪", tw: "液化情緒", us: "Liquid Emotions" },
  catalysts: { cn: "催化剂", tw: "催化劑", us: "Catalysts" },
  verisium: { cn: "维金", tw: "維金", us: "Verisium" },
  temple: { cn: "神庙", tw: "神廟", us: "Temple" },
  trial: { cn: "试炼钥匙", tw: "試煉鑰匙", us: "Trial Keys" },
};

/** 侧栏展示顺序：跟随 poe.ninja，精华与插槽物品保持在原位置。 */
export const GROUP_ORDER = [
  "currency",
  "shards",
  "bones",
  "essences",
  "omens",
  "expedition",
  "emotions",
  "catalysts",
  "verisium",
  "temple",
  "trial",
  "socketables",
];

/** poe.ninja 经济标签页 → 分组。未列出的标签页不参与本分支归类。 */
export const NINJA_TABS = {
  Currency: "currency",
  Fragments: "shards",
  Abyss: "bones",
  Ritual: "omens",
  Expedition: "expedition",
  Delirium: "emotions",
  Breach: "catalysts",
  Verisium: "verisium",
};

/** wiki 分类 → 分组，仅在 poe.ninja 未收录时兜底。 */
export const CATEGORY_GROUPS = {
  Abyss: "bones",
  Breach: "catalysts",
  Delirium: "emotions",
  Expedition: "expedition",
  Ritual: "omens",
  "Fate of the Vaal": "temple",
  Incursion: "temple",
};

/** 通货与材料分支里不参与归类的分组：精华、插槽物品与整类匹配标记各自独立。 */
export const UNMANAGED_GROUPS = new Set(["essences", "socketables", "class-selection"]);

const BONES = /(?:Jawbone|Rib|Collarbone|Cranium)$/;
const SPLINTER = /(?:Splinter|Shard)$/;
const ORE = /(?:Verisium|Starlit Ore)/;

/**
 * 判定分组，返回分组键与判定依据（依据写进 data/item-mechanics.json，便于复核）。
 * 顺序：人工校正 → 碎片（碎片类不随标签页漂移）→ 神庙（从 Currency 拆出）→
 * poe.ninja 标签页 → wiki 分类 → wiki tags → drop_text → 名称族 → 基础通货。
 * @param {{name: string, tags?: string|null, drop?: string|null, categories?: string[], ninjaTab?: string|null, override?: string, reason?: string}} item
 * @returns {{mechanic: keyof typeof GROUPS, evidence: string}}
 */
export function classifyItem(item) {
  const name = item.name;
  const tags = item.tags ?? "";
  const drop = item.drop ?? "";
  const categories = item.categories ?? [];

  if (item.override) return { mechanic: item.override, evidence: "manual: " + (item.reason ?? "人工校正") };

  // 碎片（通货碎片 / 裂痕与幻影碎片）统一进「碎片」，不让 Breach 标签页把它们带去催化剂。
  if (SPLINTER.test(name)) return { mechanic: "shards", evidence: "name: splinter or shard" };

  // 神庙：poe.ninja 把神庙通货放在 Currency 里，按需求单独拆出。
  if (/incursion_currency/.test(tags)) return { mechanic: "temple", evidence: "wiki-tag: incursion_currency" };
  if (/Atziri's Temple|Royal Trove/.test(drop)) return { mechanic: "temple", evidence: "wiki-drop: Atziri's Temple" };

  // poe.ninja 把同一族材料分在两个标签页（部分溶剂在 Verisium、部分星辉矿在 Expedition），
  // 这里按材料族归一，避免同一类东西被拆到两个分组。
  if (/Flux(?: \(Level \d+\))?$/.test(name)) return { mechanic: "expedition", evidence: "name: flux" };
  if (ORE.test(name)) return { mechanic: "verisium", evidence: "name: verisium ore" };

  const tab = item.ninjaTab ? NINJA_TABS[item.ninjaTab] : undefined;
  if (tab) return { mechanic: tab, evidence: "poe.ninja: " + item.ninjaTab };

  for (const category of categories) {
    const group = CATEGORY_GROUPS[category];
    if (group) return { mechanic: group, evidence: "wiki-category: " + category };
  }

  if (/verisium_/.test(tags)) return { mechanic: "verisium", evidence: "wiki-tag: verisium" };
  if (/catalyst/.test(tags)) return { mechanic: "catalysts", evidence: "wiki-tag: catalyst" };
  if (/mushrune/.test(tags)) return { mechanic: "emotions", evidence: "wiki-tag: mushrune" };

  if (/Verisium Remnant/.test(drop)) return { mechanic: "verisium", evidence: "wiki-drop: Verisium Remnant" };
  if (/Expedition|Logbook/.test(drop)) return { mechanic: "expedition", evidence: "wiki-drop: Expedition" };
  if (/Abyssal|Lichborn|\bAbyss\b/.test(drop)) return { mechanic: "bones", evidence: "wiki-drop: Abyss" };
  if (/\bRitual\b/.test(drop)) return { mechanic: "omens", evidence: "wiki-drop: Ritual" };
  if (/Delirium/.test(drop)) return { mechanic: "emotions", evidence: "wiki-drop: Delirium" };
  if (/Sekhemas/.test(drop)) return { mechanic: "trial", evidence: "wiki-drop: Trial of the Sekhemas" };

  // 名称族：poe.ninja 未收录的低价 / 不可交易条目。
  if (BONES.test(name)) return { mechanic: "bones", evidence: "name: abyssal bones" };
  if (/Alloy$|Crest of the/.test(name)) return { mechanic: "verisium", evidence: "name: verisium family" };
  if (/Saga$/.test(name)) return { mechanic: "expedition", evidence: "name: saga" };
  if (/^Liquid /.test(name)) return { mechanic: "emotions", evidence: "name: liquid emotion" };
  if (/Catalyst$/.test(name)) return { mechanic: "catalysts", evidence: "name: catalyst" };
  if (/^Omen of/.test(name)) return { mechanic: "omens", evidence: "name: omen" };
  if (/^[A-Z][a-z]+ Key$/.test(name)) return { mechanic: "trial", evidence: "name: trial key" };

  return { mechanic: "currency", evidence: "default: Currency" };
}

/** 生成 catalog 中的 categoryPath。 */
export function categoryPathFor(mechanic) {
  return ["crafting", mechanic];
}
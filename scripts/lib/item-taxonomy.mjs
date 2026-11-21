/**
 * 通货与材料（crafting）分支的来源玩法分类。
 *
 * 玩法归属来自 poe2wiki 条目的 tags / drop_text 与 poe.ninja PoE2 经济分类，
 * 由 scripts/build-item-mechanics.mjs 生成 data/item-mechanics.json，
 * scripts/apply-catalog-mechanics.mjs 再把结果写回 data/item-catalog.json 的 categoryPath。
 *
 * 这里只放「规则」和「词条」，不放具体物品，具体物品一律由离线数据文件决定。
 */

export const MECHANICS = {
  basic: { cn: "基础通货", tw: "基礎通貨", us: "Basic Currency" },
  abyss: { cn: "深渊", tw: "深淵", us: "Abyss" },
  expedition: { cn: "探险", tw: "探險", us: "Expedition" },
  breach: { cn: "裂痕", tw: "裂痕", us: "Breach" },
  ritual: { cn: "仪式", tw: "儀式", us: "Ritual" },
  delirium: { cn: "迷雾", tw: "迷霧", us: "Delirium" },
  temple: { cn: "神庙", tw: "神廟", us: "Temple" },
  trial: { cn: "试炼", tw: "試煉", us: "Trials" },
};

export const KINDS = {
  bones: { cn: "亵渎骨骸", tw: "褻瀆骨骸", us: "Desecration Bones" },
  omens: { cn: "预兆", tw: "預兆", us: "Omens" },
  alloys: { cn: "合金", tw: "合金", us: "Alloys" },
  flux: { cn: "溶剂", tw: "溶劑", us: "Flux" },
  verisium: { cn: "维金与矿石", tw: "維金與礦石", us: "Verisium & Ore" },
  crests: { cn: "徽记", tw: "徽記", us: "Crests" },
  sagas: { cn: "远征传说", tw: "遠征傳說", us: "Sagas" },
  splinters: { cn: "碎片", tw: "碎片", us: "Splinters" },
  catalysts: { cn: "催化剂", tw: "催化劑", us: "Catalysts" },
  emotions: { cn: "液化情绪", tw: "液化情緒", us: "Liquid Emotions" },
  infusers: { cn: "注能装置", tw: "注能裝置", us: "Infusers" },
  orbs: { cn: "宝珠", tw: "寶珠", us: "Orbs" },
  keys: { cn: "钥匙", tw: "鑰匙", us: "Keys" },
  misc: { cn: "其他产出", tw: "其他產出", us: "Misc" },
};

/** 本模块负责的旧分类路径：这些组里的物品会按玩法重新归类。 */
export const CLASSIFIED_GROUPS = new Set(["crafting/currency", "crafting/catalysts", "crafting/emotions", "crafting/omens", "crafting/shards"]);

/** wiki 条目分类 → 玩法。分类是 wiki 编辑者的显式标注，优先于掉落文本推断。 */
export const CATEGORY_MECHANICS = {
  Abyss: "abyss",
  Breach: "breach",
  Delirium: "delirium",
  Expedition: "expedition",
  Ritual: "ritual",
  "Fate of the Vaal": "temple",
  Incursion: "temple",
};

const BONES = /(?:Jawbone|Rib|Collarbone|Cranium)$/;
const ORE = /(?:Verisium|Starlit Ore)/;

/**
 * 判定来源玩法，返回玩法键与判定依据（依据会写进 data/item-mechanics.json，便于复核）。
 * 顺序：人工校正 → 骨骸族名（颚骨/肋骨/锁骨/头骨只在深渊产出）→ wiki 分类 →
 * wiki tags → drop_text → 名称族 → 基础通货。
 * @param {{name: string, tags?: string|null, drop?: string|null, categories?: string[]}} item
 * @returns {{mechanic: keyof typeof MECHANICS, evidence: string}}
 */
export function classifyItem(item) {
  const name = item.name;
  const tags = item.tags ?? "";
  const drop = item.drop ?? "";
  const categories = item.categories ?? [];

  if (item.override) return { mechanic: item.override, evidence: "manual: " + (item.reason ?? "人工校正") };

  // 骨骸是深渊专属材料：wiki 上 Altered Collarbone 误标为 Breach，这里以族名和掉落文本为准。
  if (BONES.test(name)) return { mechanic: "abyss", evidence: "name: abyssal bones" };

  for (const category of categories) {
    const mechanic = CATEGORY_MECHANICS[category];
    if (mechanic) return { mechanic, evidence: "wiki-category: " + category };
  }

  // 神庙：incursion 标签与神庙掉落文本。
  if (/incursion_currency/.test(tags)) return { mechanic: "temple", evidence: "wiki-tag: incursion_currency" };
  if (/Atziri's Temple|Royal Trove/.test(drop)) return { mechanic: "temple", evidence: "wiki-drop: Atziri's Temple" };

  // 探险：维金残迹、远征日志、合金 / 溶剂 / 星辉矿 / 徽记 / 传说。
  if (/verisium_/.test(tags)) return { mechanic: "expedition", evidence: "wiki-tag: verisium" };
  if (/Verisium Remnant/.test(drop)) return { mechanic: "expedition", evidence: "wiki-drop: Verisium Remnant" };
  if (/Expedition|Logbook/.test(drop)) return { mechanic: "expedition", evidence: "wiki-drop: Expedition" };

  if (/catalyst/.test(tags)) return { mechanic: "breach", evidence: "wiki-tag: catalyst" };
  if (/breachstone_splinter/.test(tags)) return { mechanic: "breach", evidence: "wiki-tag: breachstone_splinter" };

  if (/mushrune/.test(tags)) return { mechanic: "delirium", evidence: "wiki-tag: mushrune" };
  if (/affliction_orb/.test(tags)) return { mechanic: "delirium", evidence: "wiki-tag: affliction_orb" };
  if (/Delirium/.test(drop)) return { mechanic: "delirium", evidence: "wiki-drop: Delirium" };

  if (/Abyssal|Lichborn/.test(drop)) return { mechanic: "abyss", evidence: "wiki-drop: Abyssal/Lichborn" };
  if (/\bRitual\b/.test(drop)) return { mechanic: "ritual", evidence: "wiki-drop: Ritual" };
  if (/\bBreach\b/.test(drop)) return { mechanic: "breach", evidence: "wiki-drop: Breach" };
  if (/Abyss|Abyssal Depths/.test(drop)) return { mechanic: "abyss", evidence: "wiki-drop: Abyss" };
  if (/Sekhemas/.test(drop)) return { mechanic: "trial", evidence: "wiki-drop: Trial of the Sekhemas" };

  // 名称回落：这些词条只在对应玩法里产出。
  if (ORE.test(name)) return { mechanic: "expedition", evidence: "name: verisium ore" };
  if (/Alloy$/.test(name)) return { mechanic: "expedition", evidence: "name: alloy" };
  if (/Flux(?: \(Level \d+\))?$/.test(name)) return { mechanic: "expedition", evidence: "name: flux" };
  if (/Crest of the/.test(name)) return { mechanic: "expedition", evidence: "name: crest" };
  if (/Saga$/.test(name)) return { mechanic: "expedition", evidence: "name: saga" };
  if (/^Omen of/.test(name)) return { mechanic: "ritual", evidence: "name: omen" };
  if (/Catalyst$/.test(name)) return { mechanic: "breach", evidence: "name: catalyst" };
  if (/^Simulacrum Splinter$/.test(name)) return { mechanic: "delirium", evidence: "name: simulacrum splinter" };
  if (/^Petition Splinter$/.test(name)) return { mechanic: "ritual", evidence: "name: petition splinter" };
  if (/^Breach Splinter$/.test(name)) return { mechanic: "breach", evidence: "name: breach splinter" };
  if (/^Liquid /.test(name)) return { mechanic: "delirium", evidence: "name: liquid emotion" };

  return { mechanic: "basic", evidence: "default: 通用通货" };
}

/**
 * 依据物品名给出玩法内的细分小组；基础通货保持单层，避免常用通货多点一次。
 * @param {{name: string}} item
 * @param {keyof typeof MECHANICS} mechanic
 * @returns {keyof typeof KINDS | null}
 */
export function classifyKind(item, mechanic) {
  const name = item.name;
  switch (mechanic) {
    case "abyss":
      return BONES.test(name) ? "bones" : "omens";
    case "expedition":
      if (ORE.test(name)) return "verisium";
      if (/Alloy$/.test(name)) return "alloys";
      if (/Flux/.test(name)) return "flux";
      if (/Crest of the/.test(name)) return "crests";
      if (/Saga$/.test(name)) return "sagas";
      if (/Splinter/.test(name)) return "splinters";
      return "misc";
    case "breach":
      return /Catalyst$/.test(name) ? "catalysts" : "splinters";
    case "ritual":
      return /^Omen of/.test(name) ? "omens" : "splinters";
    case "delirium":
      return /Splinter$/.test(name) ? "splinters" : "emotions";
    case "temple":
      return /Infuser$/.test(name) ? "infusers" : "orbs";
    case "trial":
      return "keys";
    default:
      return null;
  }
}

/** 生成 catalog 中的 categoryPath。 */
export function categoryPathFor(item, mechanic) {
  const kind = classifyKind(item, mechanic);
  return kind ? ["crafting", mechanic, kind] : ["crafting", mechanic];
}

export function mechanicLabels() {
  return MECHANICS;
}

export function kindLabels() {
  return KINDS;
}
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

const BONES = /(?:Jawbone|Rib|Collarbone|Cranium)$/;
const ORE = /(?:Verisium|Starlit Ore)/;

/**
 * 依据 wiki 元数据判定来源玩法。
 * @param {{name: string, tags?: string|null, drop?: string|null}} item
 * @returns {keyof typeof MECHANICS}
 */
export function classifyMechanic(item) {
  const tags = item.tags ?? "";
  const drop = item.drop ?? "";
  const name = item.name;

  // 神庙：incursion 标签最可靠，其次是阿兹里神庙掉落文本。
  if (/incursion_currency/.test(tags) || /Atziri's Temple|Royal Trove/.test(drop)) return "temple";

  // 探险：维金残迹、远征日志、合金 / 溶剂 / 星辉矿 / 徽记 / 传说。先于深渊判定，
  // 因为「在创生之树孵化」会出现在多种玩法的掉落文本里，不能当作深渊证据。
  if (/verisium_/.test(tags) || ORE.test(name) || /Alloy$|Flux(?: \(Level \d+\))?$|Crest of the|Saga$/.test(name) || /Verisium Remnant|Expedition|Logbook/.test(drop)) return "expedition";

  // 催化剂带 catalyst / jewel_catalyst 标签，掉落文本里的创生之树只是替代来源。
  if (/catalyst/.test(tags) || /Catalyst$/.test(name)) return "breach";
  if (/breachstone_splinter/.test(tags) || /^Breach Splinter$/.test(name)) return "breach";

  // 液态情绪统一带 mushrune 标签；幻影碎片带 affliction_orb。
  if (/mushrune/.test(tags) || /^Liquid /.test(name)) return "delirium";
  if (/affliction_orb/.test(tags) || /^Simulacrum Splinter$/.test(name) || /Delirium/.test(drop)) return "delirium";

  // 预兆的来源分三类：深渊稀有怪、仪式祭坛、紫林祭坛。紫林归入仪式候选集。
  if (/^Omen of/.test(name)) return /Abyssal|Lichborn/.test(drop) ? "abyss" : "ritual";

  if (BONES.test(name)) return "abyss";

  if (/\bRitual\b/.test(drop)) return "ritual";
  if (/\bBreach\b/.test(drop)) return "breach";
  if (/Abyss|Abyssal Depths/.test(drop)) return "abyss";
  if (/Sekhemas/.test(drop)) return "trial";

  return "basic";
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
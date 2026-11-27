import { LIST_LEAF_PATHS, ITEM_CLASS_NAMES, classifiedRecord } from "./item-classes.mjs";

/**
 * 由物品列表（data/item-list.json）和客户端表生成参考数据：物品列表里每件物品所在的叶子，
 * 连同它客户端记录里定分类要用的字段（类别编号、标签、编号）。tests/item-categories.test.mjs 用它逐件核对分类规则。
 * 物品列表里的叶子到分类路径的对应写在 lib/item-classes.mjs 的 LIST_LEAF_PATHS。
 */

const norm = (name) => name.toLowerCase().replace(/\s+/g, " ").trim();
const facts = ({ ItemClass, Tags, Id, DropLevel }) => ({ itemClass: ItemClass, tags: Tags ?? [], id: String(Id).replace(/^Metadata\/Items\//, ""), dropLevel: DropLevel });

/**
 * 物品名在物品列表和客户端表里的写法按不区分大小写对应。两类物品不进参考数据，名字记在返回值的 skipped 里：
 * 客户端里是内部记录、规则不定分类的；只从未切割的辅助宝石里切出来的普通辅助宝石。
 * 物品列表把符文辅助宝石和普通辅助宝石放在同一个叶子里：带符文标签的是符文辅助宝石，归到 gems/runic。
 */
export function buildCategoryReference(client, list) {
  const recordOf = (name) => classifiedRecord(client.byLowerName.get(norm(name)), name);
  const firstRecord = (name) => client.byLowerName.get(norm(name))?.records[0];
  const items = [];
  const uniques = [];
  const uniqueBases = new Map();
  const skipped = { internal: [], cutOnly: [] };
  const missing = [];
  for (const entry of list.items) {
    const leaf = entry.category + "/" + entry.subcategory;
    if (entry.unique) {
      const shown = LIST_LEAF_PATHS[leaf];
      if (!shown) throw new Error("物品列表里的叶子还没有对应到分类树：" + leaf);
      uniques.push({ name: entry.name, base: entry.base, cn: entry.cn, tw: entry.tw, leaf, path: shown });
      const record = recordOf(entry.base) ?? firstRecord(entry.base);
      if (record && recordOf(entry.base)) uniqueBases.set(entry.base, facts(record));
      continue;
    }
    const record = recordOf(entry.name);
    if (!record) {
      if (firstRecord(entry.name)) skipped.internal.push(entry.name);
      else missing.push(entry.name);
      continue;
    }
    if (leaf === "skills_gem/support_gems" && record.ItemClass === 19) {
      if (record.Tags?.includes(1252)) items.push({ name: entry.name, ...facts(record), leaf, path: "gems/runic" });
      else skipped.cutOnly.push(entry.name);
      continue;
    }
    const shown = LIST_LEAF_PATHS[leaf];
    if (!shown) throw new Error("物品列表里的叶子还没有对应到分类树：" + leaf);
    items.push({ name: entry.name, ...facts(record), leaf, path: shown });
  }
  if (missing.length) throw new Error("客户端表里找不到物品列表里的这些物品：" + missing.join(", "));
  const referenced = new Set(items.map((item) => item.name));
  const knownClasses = new Set(items.map((item) => item.itemClass));
  return {
    version: list.version,
    captured: list.captured,
    hash: list.hash,
    items,
    uniques,
    // 只在传奇的基底里出现、物品列表里没有单列的几件基底。
    uniqueBases: [...uniqueBases].filter(([name]) => !referenced.has(name)).map(([name, value]) => ({ name, ...value })),
    skipped,
    unknownClasses: [...knownClasses].filter((id) => !ITEM_CLASS_NAMES[id]),
  };
}

/** 参考数据文件的写法：每条记录一行，记录增删时只有那一行在变。 */
export function formatCategoryReference(reference) {
  const line = (value) => JSON.stringify(value);
  const section = (key, rows) => '  ' + line(key) + ': [\n' + rows.map((row) => "    " + line(row)).join(",\n") + "\n  ]";
  return [
    "{",
    '  "version": ' + line(reference.version) + ",",
    '  "captured": ' + line(reference.captured) + ",",
    '  "hash": ' + line(reference.hash) + ",",
    section("items", reference.items) + ",",
    section("uniques", reference.uniques) + ",",
    section("uniqueBases", reference.uniqueBases),
    "}",
    "",
  ].join("\n");
}

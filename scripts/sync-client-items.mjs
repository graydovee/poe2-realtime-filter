import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { categoryPathFor, classifiedRecord, EQUIPMENT_CLASSES } from "./lib/item-classes.mjs";
import { isUniqueOnlyRecord, loadClient } from "./lib/client-data.mjs";
import { writeCatalogWithShareData } from "./lib/catalog-data.mjs";
import { CATEGORY_REFERENCE, ITEM_DETAILS } from "./lib/item-data.mjs";

/**
 * 按物品列表核对目录里的装备基底、药瓶和咒符，并用客户端数据刷新每件物品的繁体、简体名字、掉落等级、
 * 物品类别编号和「只出传奇」的判定。收哪些物品由物品列表决定（data/item-category-reference.json），
 * 三语名称、掉落等级和物品类别编号以客户端的 BaseItemTypes 表为准，每件物品的分类由 lib/item-classes.mjs 的规则按这条记录算出来。
 *
 *   node scripts/sync-client-items.mjs <client-version-directory>
 *
 * 可堆叠名单按物品详情（data/item-details.json）重写：有堆叠上限的物品可堆叠，详情里收录了却没有堆叠上限的不算；
 * 详情里没有的物品和按等级拆分的物品保持原样。
 */

const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
// 和数据文件里一行的写法一致：冒号和逗号后面各一个空格。
const record = (value) => value && typeof value === "object"
  ? "{" + Object.entries(value).map(([key, item]) => JSON.stringify(key) + ": " + record(item)).join(", ") + "}"
  : JSON.stringify(value);
const plain = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
/** 按原来的排法给出比较函数；原来的顺序不是同一种排法时返回 null。 */
const sorter = (names) => {
  const sorted = (compare) => names.every((name, index) => index === 0 || compare(names[index - 1], name) <= 0);
  return sorted(plain) ? plain : sorted((a, b) => a.localeCompare(b)) ? (a, b) => a.localeCompare(b) : null;
};

/** 一件物品在客户端表里用来定分类的那条记录；物品名的大小写可能和客户端不同，按不区分大小写查找。 */
const recordOf = (client, item) => classifiedRecord(client.byLowerName.get(item.name.toLowerCase()), item.name);

/** 目录里客户端类别属于给定类别的逐件物品的名字。 */
export const namesInClasses = (catalog, client, classes) => catalog.items
  .filter((item) => item.matcher.baseType && classes.has(recordOf(client, item)?.ItemClass))
  .map((item) => item.name);

/** 客户端类别属于装备、药瓶和咒符的物品：这些类别的每一行都是一个基底，选择器给它们分成普通基底和传奇两种条目。 */
export const BASE_CLASSES = new Set([...EQUIPMENT_CLASSES, 0, 1, 33]);

/** 目录里的基底清单：物品列表里客户端类别属于装备、药瓶和咒符的物品，加上只给它的传奇挂基底的几件。 */
export const referenceBases = (reference) => [
  ...reference.items.filter((item) => BASE_CLASSES.has(item.itemClass)).map((item) => item.name),
  ...reference.uniqueBases.map((item) => item.name),
];

/**
 * 按物品列表补全目录里的装备基底、药瓶和咒符，并把每件物品的繁体、简体名字换成客户端里的写法。
 * 返回新增的名字；物品的英文名是过滤器里的 BaseType，保持不变。
 */
export function syncCatalogItems(catalog, client, reference) {
  const items = catalog.items;
  const ids = new Set(items.map((item) => item.id));
  const known = new Set(items.map((item) => item.name.toLowerCase()));
  let renamed = 0;
  for (const item of items) {
    // 未切割宝石按等级拆成独立条目，本地化的名字用「Lv.N」的写法。
    if (item.matcher.class || item.searchNames) continue;
    const entry = client.byName.get(item.name);
    if (!entry) continue;
    for (const language of ["tw", "cn"]) {
      if (item.localeNames[language] !== entry.localeNames[language]) {
        item.localeNames[language] = entry.localeNames[language];
        renamed += 1;
      }
    }
  }

  const added = [];
  for (const listed of referenceBases(reference).sort((a, b) => a.localeCompare(b))) {
    const entry = client.byLowerName.get(listed.toLowerCase());
    if (!entry) throw new Error("物品列表里的基底在客户端表里找不到：" + listed);
    const name = entry.name;
    if (known.has(name.toLowerCase())) continue;
    const id = slug(name);
    if (ids.has(id)) throw new Error("新增装备基底 " + name + " 的 ID 与已有物品重复：" + id);
    ids.add(id);
    known.add(name.toLowerCase());
    // 定分类用基底自己的那条记录：有不止出传奇的记录时用它，只有出传奇的记录时用它。
    const base = entry.records.find((record) => BASE_CLASSES.has(record.ItemClass) && !isUniqueOnlyRecord(record))
      ?? entry.records.find((record) => BASE_CLASSES.has(record.ItemClass));
    items.push({
      id,
      name,
      localeNames: { ...entry.localeNames },
      category: "base",
      baseType: name,
      marketKey: name,
      known: true,
      priceable: true,
      matcher: { baseType: name },
      ambiguous: false,
      categoryPath: categoryPathFor(base, name),
    });
    added.push(name);
  }
  return { renamed, added };
}

/**
 * 改写数据文件里「一行一条记录」的分段。edit 收到解析好的记录数组，可以增删改；
 * 记录按分段原有的排法排序，原有顺序不是同一种排法时保持不动。
 */
function editRecords(text, header, edit) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const start = lines.indexOf(header);
  const end = lines.indexOf("  },", start);
  if (start < 0 || end < 0) throw new Error("item-drop-metadata.json 里找不到分段 " + header);
  const entry = /^    ("(?:[^"\\]|\\.)*"): (.*?)(,?)$/;
  const records = lines.slice(start + 1, end).map((line) => {
    const match = entry.exec(line);
    if (!match) throw new Error(header + " 里有无法识别的行：" + line);
    const item = { name: JSON.parse(match[1]), value: JSON.parse(match[2]) };
    if ("    " + match[1] + ": " + record(item.value) + match[3] !== line) throw new Error(header + " 里的写法和预期不同：" + line);
    return item;
  });
  const names = records.map((item) => item.name);
  const compare = sorter(names);
  const before = new Map(records.map((item) => [item.name, JSON.stringify(item.value)]));
  edit(records);
  if (compare) records.sort((a, b) => compare(a.name, b.name));
  const changed = records.filter((item) => before.get(item.name) !== JSON.stringify(item.value)).length + names.filter((name) => !records.some((item) => item.name === name)).length;
  lines.splice(start + 1, end - start - 1, ...records.map((item, index) => "    " + JSON.stringify(item.name) + ": " + record(item.value) + (index + 1 < records.length ? "," : "")));
  return { text: lines.join(eol), changed };
}

const itemsSection = '  "items": {';
const upsert = (records, name, value) => {
  const existing = records.find((item) => item.name === name);
  if (existing) existing.value = value;
  else records.push({ name, value });
};

/** 把 items 段的掉落等级换成客户端的数值，新物品补上记录。宝石的掉落等级都是 1，不记录。 */
export function syncDropLevels(text, catalog, client) {
  return editRecords(text, itemsSection, (records) => {
    const positions = new Map(records.map((item, index) => [item.name, index]));
    for (const item of catalog.items) {
      if (item.matcher.class || /\(Level \d+\)$/.test(item.name) || item.categoryPath[0] === "gems") continue;
      const entry = client.byName.get(item.name);
      if (!entry) continue;
      const previous = positions.has(item.name) ? records[positions.get(item.name)].value : {};
      const { dropLevel, ...rest } = previous;
      const value = { dropLevel: entry.dropLevel, ...rest };
      if (positions.has(item.name)) records[positions.get(item.name)].value = value;
      else {
        records.push({ name: item.name, value });
        positions.set(item.name, records.length - 1);
      }
    }
  });
}

/** 给 items 段的每件物品记上客户端的物品类别编号：取用来定分类的那条记录。 */
export function syncItemClasses(text, catalog, client) {
  return editRecords(text, itemsSection, (records) => {
    for (const item of catalog.items) {
      if (item.matcher.class) continue;
      const entry = client.byLowerName.get(item.name.toLowerCase());
      const record = classifiedRecord(entry, item.name) ?? entry?.records[0];
      if (!record) continue;
      const previous = records.find((known) => known.name === item.name)?.value ?? {};
      const { dropLevel, itemClass, ...rest } = previous;
      upsert(records, item.name, dropLevel === undefined ? { itemClass: record.ItemClass, ...rest } : { dropLevel, itemClass: record.ItemClass, ...rest });
    }
  });
}

/**
 * 重写 dropEnabled：每件装备基底一条。物品列表里列了它、而且它有不止出传奇的记录的记 true（普通基底），
 * 其余的记 false（只出传奇，只以传奇的身份出现在选择器里）。
 */
export function syncDropEnabled(text, catalog, client, reference) {
  const listed = new Set(reference.items.map((item) => item.name.toLowerCase()));
  const bases = namesInClasses(catalog, client, EQUIPMENT_CLASSES);
  return editRecords(text, '  "dropEnabled": {', (records) => {
    records.splice(0, records.length, ...bases.map((name) => ({
      name,
      value: listed.has(name.toLowerCase()) && Boolean(client.byLowerName.get(name.toLowerCase())?.records.some((record) => !isUniqueOnlyRecord(record))),
    })));
  });
}

/**
 * 按物品详情（data/item-details.json）重写 stackable：有堆叠上限的物品可堆叠，详情里收录了却没有堆叠上限的不算。
 * 详情里没有的物品和按等级拆分的物品保持原样。
 */
export function syncStackable(text, catalog, details = ITEM_DETAILS) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const start = lines.indexOf('  "stackable": [');
  const end = lines.findIndex((line, index) => index > start && line === "  ],");
  if (start < 0 || end < 0) throw new Error("item-drop-metadata.json 里找不到 stackable 段");
  const previous = lines.slice(start + 1, end).map((line) => JSON.parse(/^    (".*"),?$/.exec(line)?.[1] ?? "null"));
  const leveled = previous.filter((name) => name && /\(Level \d+\)$/.test(name) && catalog.items.some((item) => item.name === name));
  const names = catalog.items
    .filter((item) => !item.matcher.class && !/\(Level \d+\)$/.test(item.name))
    .filter((item) => details.items[item.name]?.stackSize || (!details.items[item.name]?.listed && previous.includes(item.name)))
    .map((item) => item.name)
    .concat(leveled);
  const compare = sorter(previous.filter(Boolean));
  if (compare) names.sort(compare);
  lines.splice(start + 1, end - start - 1, ...names.map((name, index) => "    " + JSON.stringify(name) + (index + 1 < names.length ? "," : "")));
  return { text: lines.join(eol), added: names.filter((name) => !previous.includes(name)).length, removed: previous.filter((name) => !names.includes(name)).length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [clientRoot] = process.argv.slice(2);
  if (!clientRoot) throw new Error("Usage: node scripts/sync-client-items.mjs <client-version-directory>");
  const client = loadClient(clientRoot);
  const catalogFile = path.resolve("data/item-catalog.json");
  const metadataFile = path.resolve("data/item-drop-metadata.json");
  const catalog = JSON.parse(fs.readFileSync(catalogFile, "utf8"));

  const gone = catalog.items
    .filter((item) => item.matcher.baseType && EQUIPMENT_CLASSES.has(recordOf(client, item)?.ItemClass) && !client.byName.has(item.name))
    .map((item) => item.name);
  if (gone.length) console.warn("客户端里已经没有这些装备基底：" + gone.join(", "));

  const { renamed, added } = syncCatalogItems(catalog, client, CATEGORY_REFERENCE);
  let metadata = fs.readFileSync(metadataFile, "utf8");
  const levels = syncDropLevels(metadata, catalog, client);
  const classes = syncItemClasses(levels.text, catalog, client);
  const drops = syncDropEnabled(classes.text, catalog, client, CATEGORY_REFERENCE);
  metadata = drops.text;
  const stackable = syncStackable(metadata, catalog);
  metadata = stackable.text;
  // 分享码的地址按选择器里的条目分配，条目要用掉落数据里的物品类别编号，所以先写掉落数据。
  fs.writeFileSync(metadataFile, metadata);
  await writeCatalogWithShareData(catalogFile, catalog);
  console.log("物品列表里的基底 " + referenceBases(CATEGORY_REFERENCE).length + " 件，新增 " + added.length + " 件：" + (added.join(", ") || "无"));
  console.log("本地化名字换成客户端写法 " + renamed + " 处，掉落等级更新 " + levels.changed + " 条，物品类别编号更新 " + classes.changed + " 条，掉落记录更新 " + drops.changed + " 条");
  console.log("可堆叠名单按物品详情更新：新增 " + stackable.added + " 条，去掉 " + stackable.removed + " 条");
}

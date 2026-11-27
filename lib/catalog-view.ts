import categoryTree from "../data/item-categories.json";
import type { ItemDefinition } from "./types";

type DropMetadata = {
  items: Record<string, { icon?: string; dropLevel?: number | null; itemClass?: number }>;
  uniques: Record<string, Record<string, string | null>>;
  localizedUniqueNames: Record<string, { cn: string; tw: string }>;
  stackable: string[];
  /** 装备基底会不会以普通、魔法或稀有掉落：客户端表里编号带 Unique 的基底只出传奇，记为 false。 */
  dropEnabled: Record<string, boolean>;
};

/** 图标记的是图片地址：PoE2 Wiki 的文件路径拼成该站的图片地址，其余是完整的地址。 */
const iconUrl = (path?: string | null) => {
  if (!path) return undefined;
  return path.startsWith("https://") ? path : `https://www.poe2wiki.net/images/${path}`;
};

type Category = { key: string; uniques?: string; children?: Category[] };
/** 客户端的物品类别编号里属于装备的这些类别：每一条记录都是一个装备基底，选择器把每件分成普通基底和传奇两种条目。 */
export const EQUIPMENT_CLASSES = new Set<number>(categoryTree.itemClasses.equipment);
/** 出传奇的叶子上，传奇所在的路径（分类树里叶子的 uniques）。 */
const UNIQUE_PATHS = new Map<string, string[]>();
const index = (nodes: Category[], prefix: string[]) => {
  for (const node of nodes) {
    const path = [...prefix, node.key];
    if (node.uniques) UNIQUE_PATHS.set(path.join("/"), node.uniques.split("/"));
    if (node.children) index(node.children, path);
  }
};
index(categoryTree.roots as Category[], []);

export type ClassMatch = { item: ItemDefinition; members: ItemDefinition[] };

/**
 * 整类匹配登记表：整类条目按游戏里的类名登记它覆盖的客户端类别编号，成员是这些类别里的逐件物品。
 * 规则把一个类别的成员全部选中时，生成器换成一条 Class 条件。没登记的不做整类匹配：
 * - Stackable Currency、Map Fragments、Tablet、Augment 的范围和选择器里的分类对不上；
 * - Fishing Rods、Instance Local Items 不是可选物品，Instance Local Items 还和 Quest Items 挤在同一个分类里。
 * 类别和物品的对应关系由 tests/class-matches.test.mjs 对照内置的 NeverSink 过滤器核对。
 */
const CLASS_ITEMS: Record<string, number[]> = {
  Charms: [33], "Life Flasks": [0], "Mana Flasks": [1], Omen: [108], Incubators: [76], "Pinnacle Keys": [109, 117], "Vault Keys": [90],
  "Skill Gems": [18, 78], "Support Gems": [19],
  Amulets: [4], Rings: [5], Belts: [21], Jewels: [42], Shields: [26], Foci: [81], Quivers: [20], Bucklers: [94],
  Wands: [8], Sceptres: [32], Spears: [79], "One Hand Maces": [12], Bows: [13], Staves: [14], Crossbows: [80],
  "Two Hand Maces": [17], Quarterstaves: [58], Talismans: [110], Gloves: [22], Boots: [23], "Body Armours": [24], Helmets: [25],
  "Expedition Logbook": [74, 75], "Quest Items": [31], Waystones: [35],
};

// 选择器、过滤器生成、分享码和目录更新使用同一套派生逻辑。此模块会在 QuickJS 里执行，只用 ES2021 的库函数。
export function deriveCatalogView(items: ItemDefinition[], metadata: DropMetadata) {
  const stackableNames = new Set(metadata.stackable);
  // 未切割宝石每个等级是一件独立物品，掉落数据和图标仍按不带等级后缀的基底名查。
  const itemCatalog = items.map((item) => {
    const metadataKey = item.name.replace(/ \(Level \d+\)$/, "");
    const record = metadata.items[metadataKey];
    return {
      ...item,
      stackable: stackableNames.has(metadataKey),
      dropLevel: record?.dropLevel ?? undefined,
      iconUrl: iconUrl(record?.icon),
      itemClass: record?.itemClass,
    };
  });

  // 普通基底只给会以普通、魔法或稀有掉落的装备基底出；只出传奇的基底（例如符文之叉）只以传奇的身份出现。
  const equipment = itemCatalog.filter((item) => EQUIPMENT_CLASSES.has(item.itemClass ?? -1) && !item.ambiguous && item.matcher.baseType);
  const equipmentIds = new Set(equipment.map((item) => item.id));
  const baseVariants = equipment.filter((item) => metadata.dropEnabled[item.name] !== false).map((item): ItemDefinition => ({
    ...item,
    id: `base:${item.id}`,
    marketItemId: item.id,
    matcher: { ...item.matcher, nonUnique: true },
  }));
  // 传奇条目每件出了传奇的基底一个，归到「传奇」下对应的叶子：装备、药瓶、咒符、石板和圣物都会出传奇。
  const uniqueVariants = itemCatalog.flatMap((item): ItemDefinition[] => {
    const names = metadata.uniques[item.name];
    const path = UNIQUE_PATHS.get(item.categoryPath.join("/"));
    if (!names || !path || item.ambiguous || !item.matcher.baseType) return [];
    const variants = Object.keys(names).sort();
    const label = variants.join(" / ");
    return [{
      ...item,
      id: `unique:${item.id}`,
      name: label,
      localeNames: {
        cn: variants.map((name) => metadata.localizedUniqueNames[name]?.cn ?? name).join(" / "),
        tw: variants.map((name) => metadata.localizedUniqueNames[name]?.tw ?? name).join(" / "),
        us: label,
      },
      baseLocaleNames: item.localeNames,
      searchNames: Object.values(item.localeNames),
      category: "unique",
      categoryPath: path,
      matcher: { ...item.matcher, rarity: "Unique" },
      priceable: false,
      dropLevel: undefined,
      iconUrl: (variants.length === 1 ? iconUrl(names[variants[0]]) : undefined) ?? item.iconUrl,
    }];
  });
  const concreteItems = [...itemCatalog.filter((item) => !equipmentIds.has(item.id) && !item.matcher.class), ...baseVariants, ...uniqueVariants];

  // 登记过的整类条目：成员是它的类别里的逐件物品。装备的每个类型按普通基底、传奇各派生一个带稀有度的整类变体。
  const inClasses = (ids: number[]) => (item: ItemDefinition) => item.itemClass !== undefined && ids.includes(item.itemClass);
  const registered = itemCatalog.filter((item) => item.matcher.class && CLASS_ITEMS[item.matcher.class]);
  const equipmentTypes = registered.filter((item) => CLASS_ITEMS[item.matcher.class!].every((id) => EQUIPMENT_CLASSES.has(id)));
  const others = registered.filter((item) => !equipmentTypes.includes(item));
  const typeVariants = equipmentTypes.map((item): [ItemDefinition, ItemDefinition] => [
    { ...item, id: `base:${item.id}`, categoryPath: item.categoryPath.slice(0, -1), matcher: { class: item.matcher.class, nonUnique: true }, ambiguous: false },
    { ...item, id: `unique:${item.id}`, categoryPath: item.categoryPath.slice(0, -1), matcher: { class: item.matcher.class, rarity: "Unique" }, ambiguous: false },
  ]);
  const equipmentClassVariants = typeVariants.flat();
  const classMatches: ClassMatch[] = [
    ...others.map((item) => ({ item, members: concreteItems.filter(inClasses(CLASS_ITEMS[item.matcher.class!])) })),
    ...equipmentTypes.flatMap((item, index) => {
      const members = concreteItems.filter(inClasses(CLASS_ITEMS[item.matcher.class!]));
      const [base, unique] = typeVariants[index];
      return [
        { item: base, members: members.filter((member) => member.matcher.nonUnique) },
        { item: unique, members: members.filter((member) => member.category === "unique") },
      ];
    }),
  ];

  const filterItems = [...itemCatalog, ...baseVariants, ...uniqueVariants, ...equipmentClassVariants];
  // 只能整类选择的分类（远征日志、任务物品）没有逐件物品，登记的整类条目就是选择器里的条目，放在它所代表的分类下。
  const classOnlyItems = classMatches
    .filter((match) => !match.members.length && !equipmentClassVariants.includes(match.item))
    .map((match) => ({ ...match.item, categoryPath: match.item.categoryPath.slice(0, -1) }));

  return { itemCatalog, filterItems, classMatches, classOnlyItems, pickerItems: [...concreteItems, ...classOnlyItems] };
}

export type CatalogNode = { key: string; path: string[]; items: ItemDefinition[]; children: CatalogNode[] };

export function buildCatalogTree(items: ItemDefinition[]): CatalogNode {
  const root: CatalogNode = { key: "root", path: [], items: [], children: [] };
  for (const item of items) {
    let node = root;
    for (const key of item.categoryPath) {
      let child = node.children.find((child) => child.key === key);
      if (!child) {
        child = { key, path: [...node.path, key], items: [], children: [] };
        node.children.push(child);
      }
      node = child;
    }
    node.items.push(item);
  }
  return root;
}

export function catalogItems(node: CatalogNode): ItemDefinition[] {
  return [...node.items, ...node.children.flatMap(catalogItems)];
}

// 分类号和槽位显式存储，调整 JSON 记录顺序不会改地址。path 为 null 的分类存放选择器未展示的合法 ID。
type ShareGroup = { path: string[] | null; slots: Record<string, number> };
type ShareGroups = Record<string, ShareGroup>;
type IndexedShareGroup = { id: number; path: ShareGroup["path"]; byItem: Map<string, number>; bySlot: string[] };
type ShareAddress = [groupId: number, slot: number];
// JSON 中的子分类以名称为键，序号从 0 起单独在每个父分类下分配。
type ShareTreeData = Record<string, { ordinal: number; children: ShareTreeData }>;
type ShareTree = { group: number | null; children: ShareTree[] };
type ShareCatalog = {
  groups: { id: number; slots: (string | null)[]; path: number[] | null; activeSlots: number[] }[];
  current: Record<string, ShareAddress>;
  tree: ShareTree;
};
type ShareItems = Pick<ReturnType<typeof deriveCatalogView>, "filterItems" | "pickerItems">;

const pathKey = (path: ShareGroup["path"]) => JSON.stringify(path);
const validPath = (path: unknown): path is string[] => Array.isArray(path) && path.length > 0
  && [...path].every((part) => typeof part === "string" && part.length > 0);
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

function currentPaths({ filterItems, pickerItems }: ShareItems) {
  const paths = new Map<string, ShareGroup["path"]>();
  for (const { id } of filterItems) {
    if (typeof id !== "string" || !id || paths.has(id)) throw new Error(`物品目录中的 ID 无效或重复：${id}`);
    paths.set(id, null);
  }
  for (const { id, categoryPath } of pickerItems) {
    if (paths.get(id) !== null || !validPath(categoryPath)) throw new Error(`选择器的物品 ID 或分类无效：${id}`);
    paths.set(id, categoryPath);
  }
  return paths;
}

function indexShareGroups(groups: ShareGroups) {
  if (!isRecord(groups)) throw new Error("物品目录缺少有效的 shareGroups，请保留已分配的分享码槽位");
  const indexed = new Map<string, IndexedShareGroup>();
  // 整数键按数值升序枚举。比较键与索引，拒绝重复路径、缺号和无效分类号。
  for (const [id, [key, group]] of Object.entries(groups).entries()) {
    if (key !== String(id)) throw new Error(`分享码分类号不连续或无效：${key}，预期 ${id}`);
    if (!group || (group.path !== null && !validPath(group.path)) || !isRecord(group.slots)) {
      throw new Error(`分享码分类 ${id} 的路径或槽位记录无效`);
    }
    const route = pathKey(group.path);
    if (indexed.has(route)) throw new Error(`分享码分类路径重复：${route}`);
    const entries = Object.entries(group.slots);
    if (!entries.length) throw new Error(`分享码分类 ${id} 缺少槽位`);
    const bySlot: string[] = Array(entries.length);
    for (const [itemId, slot] of entries) {
      if (!itemId || !Number.isInteger(slot) || slot < 0 || slot >= bySlot.length || bySlot[slot] !== undefined) {
        throw new Error(`分享码分类 ${id} 的槽位 ${slot} 无效或重复：${itemId}`);
      }
      bySlot[slot] = itemId;
    }
    indexed.set(route, { id, path: group.path, byItem: new Map(entries), bySlot });
  }
  return indexed;
}

/** 只给新分类或首次进入分类的 ID 追加槽位。已有分类、别名和退役 ID 都留在原处。 */
export function allocateShareGroups(previous: ShareGroups, view: ShareItems): ShareGroups {
  const indexed = indexShareGroups(previous);
  const groups = { ...previous };
  const paths = currentPaths(view);
  const additions = new Map<string, { path: ShareGroup["path"]; itemIds: string[] }>();
  for (const [itemId, path] of paths) {
    const key = pathKey(path);
    if (indexed.get(key)?.byItem.has(itemId)) continue;
    let group = additions.get(key);
    if (!group) {
      group = { path, itemIds: [] };
      additions.set(key, group);
    }
    group.itemIds.push(itemId);
  }
  let nextGroupId = indexed.size;
  for (const key of [...additions.keys()].sort()) {
    const { path, itemIds } = additions.get(key)!;
    const existing = indexed.get(key);
    const groupId = existing?.id ?? nextGroupId++;
    const startSlot = existing?.bySlot.length ?? 0;
    const addedSlots = Object.fromEntries(itemIds.sort().map((itemId, offset) => [itemId, startSlot + offset]));
    groups[groupId] = { path, slots: { ...groups[groupId]?.slots, ...addedSlots } };
  }
  return groups;
}

function currentAddresses(indexed: Map<string, IndexedShareGroup>, paths: ReturnType<typeof currentPaths>) {
  return Object.fromEntries([...paths].map(([itemId, path]): [string, ShareAddress] => {
    const group = indexed.get(pathKey(path));
    const slot = group?.byItem.get(itemId);
    if (!group || slot === undefined) throw new Error(`物品 ${itemId} 缺少当前分享码槽位（分类 ${pathKey(path)}）`);
    return [itemId, [group.id, slot]];
  }));
}

function indexShareTree(data: unknown, groups: Map<string, IndexedShareGroup>) {
  const groupPaths = new Map<number, number[]>();
  const walk = (siblings: unknown, path: string[], ordinals: number[]): ShareTree => {
    const route = pathKey(path);
    if (!isRecord(siblings)) throw new Error(`物品目录的 shareTree 分类 ${route} 缺少有效子分类记录`);
    const group = groups.get(route)?.id ?? null;
    if (group !== null) groupPaths.set(group, ordinals);
    const entries = Object.entries(siblings);
    const children: ShareTree[] = Array(entries.length);
    for (const [key, node] of Object.entries(siblings)) {
      const childPath = [...path, key];
      if (!key || !isRecord(node)) throw new Error(`分享码分类 ${pathKey(childPath)} 的记录无效`);
      const { ordinal } = node;
      if (typeof ordinal !== "number" || !Number.isInteger(ordinal)
        || ordinal < 0 || ordinal >= entries.length || children[ordinal]) {
        throw new Error(`分享码分类 ${pathKey(childPath)} 的同级序号无效、重复或不连续`);
      }
      children[ordinal] = walk(node.children, childPath, [...ordinals, ordinal]);
    }
    return { group, children };
  };
  const tree = walk(data, [], []);
  for (const { id, path } of groups.values()) {
    if (path !== null && !groupPaths.has(id)) throw new Error(`分享码分类 ${id} 缺少路径序号：${pathKey(path)}`);
  }
  return { tree, groupPaths };
}

const ROOT_SHARE_ORDER = new Map(["currency", "uniques", "gameplay", "endgame", "runes", "essences", "gems", "equipment", "other"].map((key, ordinal) => [key, ordinal]));
const rootShareOrder = (key: string) => ROOT_SHARE_ORDER.get(key) ?? ROOT_SHARE_ORDER.size;

/** 按选择器的分类树追加同级序号，分类移走或消失后仍保留原路径。 */
export function allocateShareTree(previous: ShareTreeData, previousGroups: ShareGroups, view: ShareItems): ShareTreeData {
  // 先校验已有分类的路径，避免丢失的序号被当成新路径重新分配。
  indexShareTree(previous, indexShareGroups(previousGroups));
  const merge = (existing: ShareTreeData, node: CatalogNode): ShareTreeData => {
    const siblings = new Map(Object.entries(existing));
    const children = [...node.children].sort((a, b) =>
      (node.path.length ? 0 : rootShareOrder(a.key) - rootShareOrder(b.key)) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    for (const child of children) {
      const old = siblings.get(child.key);
      siblings.set(child.key, { ordinal: old?.ordinal ?? siblings.size, children: merge(old?.children ?? {}, child) });
    }
    return Object.fromEntries([...siblings].sort(([, a], [, b]) => a.ordinal - b.ordinal));
  };
  return merge(previous, buildCatalogTree(view.pickerItems));
}

/**
 * 导出用当前槽位和分类树。导入可访问已有路径和别名，退役槽位投影为 null。
 * activeSlots 是地址表里仍然存在的物品的槽位：物品改类后，旧分享码里整选它原来的分类，展开的仍是原来那些物品。
 */
export function projectShareCatalog(groups: ShareGroups, view: ShareItems, ordinals: unknown): ShareCatalog {
  const indexed = indexShareGroups(groups);
  const { tree, groupPaths } = indexShareTree(ordinals, indexed);
  const paths = currentPaths(view);
  const current = currentAddresses(indexed, paths);
  return {
    groups: [...indexed.values()].map(({ id, path, bySlot }) => {
      const slots = bySlot.map((itemId) => paths.has(itemId) ? itemId : null);
      return {
        id,
        slots,
        path: path === null ? null : groupPaths.get(id)!,
        activeSlots: slots.flatMap((itemId, slot) => itemId === null ? [] : [slot]),
      };
    }),
    current,
    tree,
  };
}

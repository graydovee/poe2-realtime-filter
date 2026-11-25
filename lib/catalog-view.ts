import type { ItemDefinition } from "./types";

type DropMetadata = {
  items: Record<string, { icon?: string; dropLevel?: number | null }>;
  uniques: Record<string, Record<string, string | null>>;
  localizedUniqueNames: Record<string, { cn: string; tw: string }>;
  stackable: string[];
};

const wikiImage = (path?: string | null) => path ? `https://www.poe2wiki.net/images/${path}` : undefined;
const ONE_HAND_TYPES = new Set(["one-hand-maces", "wands", "sceptres", "spears"]);

/** 装备在选择器里的分类：普通基底和传奇各一棵树，武器再按单手 / 双手分开。入参是目录里的装备路径（装备 › 类别 › 类型）。 */
function equipmentPath(path: string[], group: "normal-bases" | "unique-equipment") {
  const [, kind, type] = path;
  const category = kind === "weapons" ? ONE_HAND_TYPES.has(type ?? "") ? "one-hand" : "two-hand" : kind;
  return ["equipment", group, category, ...(type ? [type] : [])];
}

/** 装备的整类条目都放在装备树里（珠宝直接在装备下，其余在类型下），对应选择器里的普通基底 / 传奇两棵树。 */
const isEquipmentType = (path: string[]) => path[0] === "equipment" && path.length >= 3;
/** 装备之外的整类条目：在分类末尾的 class-selection 分组里，或者在分类自己名下（远征日志）。根分类下的标记不算。 */
const classMatchPath = (path: string[]): string[] | undefined =>
  path[path.length - 1] === "class-selection" ? (path.length >= 3 ? path.slice(0, -1) : undefined) : path;

export type ClassMatch = { path: string[]; item: ItemDefinition; members: ItemDefinition[] };

/**
 * 整类匹配登记表只登记与选择器分类相符的 Class 条件，没登记的照旧跳过：
 * - Stackable Currency：它的范围比「通货与材料」小（符文、灵魂核心不属于这个类别）；
 * - 「其他」、通货与材料根分类下的几个标记，和那里的逐件物品不是一回事；
 * - Instance Local Items：不是任务物品，和 Quest Items 挤在同一个分类里；
 * - Augment：目录把它放在石板分类下，但它是符文、灵魂核心那一类（游戏在 2025 年 12 月把 Socketable
 *   改名成了 Augment，见 GGG 的过滤器更新公告；NeverSink 0.10.4 里 Class == "Augment" 搭配的也是符文
 *   和灵魂核心）。石板对应的是 Tablet，这里不登记，石板照旧逐件输出。
 * 类别和物品的对应关系由 tests/class-matches.test.mjs 对照内置的 NeverSink 过滤器核对。
 */
const UNREGISTERED_CLASSES = new Set(["Instance Local Items", "Augment"]);

// 选择器、过滤器生成、分享码和目录更新使用同一套派生逻辑。此模块会在 QuickJS 里执行，只用 ES2021 的库函数。
export function deriveCatalogView(items: ItemDefinition[], metadata: DropMetadata) {
  const stackableNames = new Set(metadata.stackable);
  // 未切割宝石每个等级是一件独立物品，掉落数据和图标仍按不带等级后缀的基底名查。
  const itemCatalog = items.map((item) => {
    const metadataKey = item.name.replace(/ \(Level \d+\)$/, "");
    return {
      ...item,
      stackable: stackableNames.has(metadataKey),
      dropLevel: metadata.items[metadataKey]?.dropLevel ?? undefined,
      iconUrl: wikiImage(metadata.items[metadataKey]?.icon),
    };
  });

  const equipment = itemCatalog.filter((item) => item.categoryPath[0] === "equipment" && !item.ambiguous && item.matcher.baseType);
  const equipmentIds = new Set(equipment.map((item) => item.id));
  const baseVariants = equipment.map((item): ItemDefinition => ({
    ...item,
    id: `base:${item.id}`,
    marketItemId: item.id,
    categoryPath: equipmentPath(item.categoryPath, "normal-bases"),
    matcher: { ...item.matcher, nonUnique: true },
  }));
  const uniqueVariants = equipment.flatMap((item): ItemDefinition[] => {
    const names = metadata.uniques[item.name];
    if (!names || !item.matcher.baseType) return [];
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
      searchNames: Object.values(item.localeNames),
      category: "unique",
      categoryPath: equipmentPath(item.categoryPath, "unique-equipment"),
      matcher: { ...item.matcher, rarity: "Unique" },
      priceable: false,
      dropLevel: undefined,
      iconUrl: (variants.length === 1 ? wikiImage(names[variants[0]]) : undefined) ?? item.iconUrl,
    }];
  });

  // 装备类型的整类条目按普通基底 / 传奇各派生一个带稀有度的变体。
  const classEntries = itemCatalog.filter((item) => item.matcher.class);
  const equipmentClassVariants = classEntries
    .filter((item) => isEquipmentType(item.categoryPath))
    // 去掉末尾的整类标记，剩下的就是目录里的装备路径；珠宝直接在装备下，没有类型段。
    .map((item) => ({ item, path: item.categoryPath.slice(0, -1) }))
    .flatMap(({ item, path }): ItemDefinition[] => [
      { ...item, id: `base:${item.id}`, categoryPath: equipmentPath(path, "normal-bases"), matcher: { class: item.matcher.class, nonUnique: true }, ambiguous: false },
      { ...item, id: `unique:${item.id}`, categoryPath: equipmentPath(path, "unique-equipment"), matcher: { class: item.matcher.class, rarity: "Unique" }, ambiguous: false },
    ]);

  const filterItems = [...itemCatalog, ...baseVariants, ...uniqueVariants, ...equipmentClassVariants];
  const concreteItems = [...itemCatalog.filter((item) => !equipmentIds.has(item.id) && !item.matcher.class), ...baseVariants, ...uniqueVariants];
  const classMatches: ClassMatch[] = [
    ...classEntries
      .filter((item) => !isEquipmentType(item.categoryPath) && !UNREGISTERED_CLASSES.has(item.name))
      .flatMap((item) => {
        const path = classMatchPath(item.categoryPath);
        return path ? [{ path, item }] : [];
      }),
    ...equipmentClassVariants.map((item) => ({ path: item.categoryPath, item })),
  ].map((match) => ({ ...match, members: concreteItems.filter((item) => item.categoryPath.join("/") === match.path.join("/")) }));

  // 没有逐件物品的分类（换界石、远征日志、任务物品）只能整类选择。选择器在有效路径下展示整类条目。
  const classOnlyItems = classMatches
    .filter((match) => !match.members.length && !equipmentClassVariants.includes(match.item))
    .map((match) => ({ ...match.item, categoryPath: match.path }));

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

/** 只给新分类或首次进入分类的 ID 追加槽位。旧分类、别名和退役 ID 都留在原处。 */
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
    for (const [key, node] of entries) {
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

const ROOT_SHARE_ORDER = new Map(["endgame", "crafting", "gems", "supplies", "equipment", "other"].map((key, ordinal) => [key, ordinal]));
const rootShareOrder = (key: string) => ROOT_SHARE_ORDER.get(key) ?? ROOT_SHARE_ORDER.size;

/** 按选择器的分类树追加同级序号，分类移走或消失后仍保留原路径。 */
export function allocateShareTree(previous: ShareTreeData, previousGroups: ShareGroups, view: ShareItems): ShareTreeData {
  // 先校验旧分类的路径，避免丢失的旧序号被当成新路径重新分配。
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

/** 导出用当前槽位和分类树。导入仍可访问旧路径和别名，退役槽位投影为 null。 */
export function projectShareCatalog(groups: ShareGroups, view: ShareItems, ordinals: unknown): ShareCatalog {
  const indexed = indexShareGroups(groups);
  const { tree, groupPaths } = indexShareTree(ordinals, indexed);
  const byId = [...indexed.values()];
  const paths = currentPaths(view);
  const current = currentAddresses(indexed, paths);
  const activeSlots = byId.map((): number[] => []);
  for (const [group, slot] of Object.values(current)) activeSlots[group].push(slot);
  return {
    groups: byId.map(({ id, path, bySlot }) => ({
      id,
      slots: bySlot.map((itemId) => paths.has(itemId) ? itemId : null),
      path: path === null ? null : groupPaths.get(id)!,
      activeSlots: activeSlots[id].sort((a, b) => a - b),
    })),
    current,
    tree,
  };
}

import categoryTree from "../data/item-categories.json";
import type { CatalogNode } from "./catalog-view";
import type { ItemDefinition, Locale } from "./types";

export { buildCatalogTree, catalogItems, type CatalogNode } from "./catalog-view";

type Category = { key: string; name: Record<Locale, string>; icon?: string; children?: Category[] };
const pathKey = (path: string[]) => path.join("/");

/** 分类树（data/item-categories.json）里的每个节点，按路径查：显示顺序是它在树里的先后，名字跟着节点走。 */
const CATEGORIES = new Map<string, { order: number; node: Category }>();
const index = (nodes: Category[], prefix: string[]) => {
  for (const node of nodes) {
    const path = [...prefix, node.key];
    CATEGORIES.set(pathKey(path), { order: CATEGORIES.size, node });
    if (node.children) index(node.children, path);
  }
};
index(categoryTree.roots, []);

/** 分类在菜单里的显示顺序：分类树里的先后。树里没有的路径排在最后，保持插入顺序。 */
export function groupOrder(path: string[]): number {
  return CATEGORIES.get(pathKey(path))?.order ?? CATEGORIES.size;
}

/** 分类的名字。整类条目的路径以 class-selection 结尾，去掉它再查；树里没有的路径用最后一段。 */
export function groupName(path: string[], locale: Locale): string {
  const lookup = path[path.length - 1] === "class-selection" ? path.slice(0, -1) : path;
  return CATEGORIES.get(pathKey(lookup))?.node.name[locale] ?? path[path.length - 1] ?? "";
}

/** 分类自己的图标，是分类树（data/item-categories.json）里记着的图片地址；分类没有单独的图标时返回 undefined。 */
export function categoryIcon(path: string[]): string | undefined {
  const lookup = path[path.length - 1] === "class-selection" ? path.slice(0, -1) : path;
  return CATEGORIES.get(pathKey(lookup))?.node.icon;
}

/**
 * 每个分类用的图标，键是分类路径（"a/b/c"）：分类自己的图片，没有的用分类下第一件带图标的物品的图标，
 * 再没有的用子分类的（按显示顺序找第一个有的）。
 */
export function catalogIcons(tree: CatalogNode): Map<string, string | undefined> {
  const map = new Map<string, string | undefined>();
  const walk = (node: CatalogNode): string | undefined => {
    const fromChildren = [...node.children].sort((a, b) => groupOrder(a.path) - groupOrder(b.path)).map(walk).find(Boolean);
    const icon = categoryIcon(node.path) ?? node.items.find((item) => item.iconUrl)?.iconUrl ?? fromChildren;
    map.set(node.path.join("/"), icon);
    return icon;
  };
  walk(tree);
  return map;
}

/** 物品在选择器里的名字。远征日志、任务物品这类条目代表它所在的整个分类，目录里记着按分类叫的名字。 */
export function itemLabel(item: ItemDefinition, locale: Locale): string {
  return item.localeNames[locale] || item.name;
}

export function catalogNode(root: CatalogNode, path: string[]): CatalogNode | undefined {
  let node = root;
  for (const key of path) { const next = node.children.find((child) => child.key === key); if (!next) return undefined; node = next; }
  return node;
}
export function searchCatalog(items: ItemDefinition[], query: string): ItemDefinition[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return items;
  return items.filter((item) => [item.name, item.matcher.baseType, ...(item.searchNames ?? []), ...Object.values(item.localeNames)].some((name) => name?.toLocaleLowerCase().includes(normalized)));
}

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { catalogIcons, catalogView, categoryIcon, cleanup, data } from "./helpers.mjs";

test.after(cleanup);

const tree = JSON.parse(readFileSync("data/item-categories.json", "utf8"));
const catalog = catalogIcons(catalogView.buildCatalogTree(data.PICKER_ITEMS));

test("分类树里记着的图标都是图床地址，顶层分类和各个分组都有", () => {
  const own = [];
  const walk = (nodes, prefix) => {
    for (const node of nodes) {
      const path = [...prefix, node.key];
      if (node.icon) own.push(path.join("/"));
      walk(node.children ?? [], path);
    }
  };
  walk(tree.roots, []);
  for (const path of own) assert.match(categoryIcon(path.split("/")), /^https:\/\/cdn\.poe2db\.tw\/image\/\S+\.webp$/, path);
  // 顶层九个分类，和下面还有子分类的分组，各自都有图标。
  for (const root of tree.roots) {
    assert.ok(root.icon, root.key);
    for (const child of root.children ?? []) if (child.children?.length) assert.ok(child.icon, root.key + "/" + child.key);
  }
});

test("每个分类都有图标，包括自己有图标的分类下面的子分类", () => {
  // 选择器里出现的每个分类（含整类条目所在的分类）都在表里，并且都有一张图。
  const paths = new Set(data.PICKER_ITEMS.map((item) => item.categoryPath.join("/").replace(/\/class-selection$/, "")));
  for (const path of paths) {
    assert.ok(catalog.has(path), path + " 不在表里");
    assert.ok(catalog.get(path), path + " 没有图标");
  }
});

test("图标怎么选：分类自己的图片，没有的用分类下第一件带图标的物品的图标，再没有的用子分类的", () => {
  const built = catalogView.buildCatalogTree(data.PICKER_ITEMS);
  const endgame = built.children.find((node) => node.key === "endgame");
  // 分组自己的图片优先于从子分类、物品里找出来的。
  assert.equal(catalog.get("endgame"), categoryIcon(["endgame"]));
  // 「头盔」分组有自己的图片；它下面的「头盔(力)」没有，用列表里第一件带头盔图标的物品的图标。
  const equipment = built.children.find((node) => node.key === "equipment");
  const helmets = equipment.children.find((node) => node.key === "helmets");
  assert.equal(catalog.get("equipment/helmets"), categoryIcon(["equipment", "helmets"]));
  const str = helmets.children.find((node) => node.key === "str");
  assert.equal(categoryIcon(str.path), undefined);
  assert.equal(catalog.get("equipment/helmets/str"), str.items.find((item) => item.iconUrl).iconUrl);
});

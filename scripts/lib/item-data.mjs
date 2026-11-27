import fs from "node:fs";

/**
 * 物品目录的输入数据，都在 data/ 下：
 * - item-list.json：物品列表。收哪些物品和传奇、传奇挂在哪件基底上、传奇的译名，都以它为准；
 * - item-details.json：每件物品的堆叠上限和图标；
 * - item-category-reference.json：参考数据，由物品列表和客户端表生成（lib/category-reference.mjs），
 *   每件物品带着定分类要用的客户端记录。
 * 前两个文件由 poe2-filter-data skill（https://git.graydove.cn/graydove/poe2-spider）生成，怎么取数据见 docs/filter-generation.md。
 */
const read = (name) => JSON.parse(fs.readFileSync(new URL("../../data/" + name, import.meta.url), "utf8"));

export const ITEM_LIST = read("item-list.json");
export const ITEM_DETAILS = read("item-details.json");
export const CATEGORY_REFERENCE = read("item-category-reference.json");

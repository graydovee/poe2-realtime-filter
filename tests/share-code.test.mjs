import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";
import { catalogView, cleanup, data, newRuleId } from "./helpers.mjs";

test.after(cleanup);

const root = fileURLToPath(new URL("../", import.meta.url));
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const catalog = readJson(path.join(root, "data/item-catalog.json"));
const metadata = readJson(path.join(root, "data/item-drop-metadata.json"));
const { allocateShareGroups, allocateShareTree, buildCatalogTree, catalogItems, deriveCatalogView, projectShareCatalog } = catalogView;
const resolve = ({ groups }, [group, slot]) => groups[group]?.slots[slot];
const selectable = (items) => ({ filterItems: items, pickerItems: items });
const ordinalPath = (siblings, path) => path.map((key) => {
  const node = siblings[key];
  siblings = node.children;
  return node.ordinal;
});
const shareNode = (tree, path) => path.reduce((node, ordinal) => node.children[ordinal], tree);
const activeAddresses = (projection, { group, children }) => [
  ...(group === null ? [] : projection.groups[group].activeSlots.map((slot) => [group, slot])),
  ...children.flatMap((child) => activeAddresses(projection, child)),
];
const sortAddresses = (addresses) => addresses.sort(([a, x], [b, y]) => a - b || x - y);
const selectedIds = (projection, node) => activeAddresses(projection, node).map((address) => resolve(projection, address)).sort();

test("桌面引擎的分享码目录与选择器及合法物品一致", async () => {
  const { outputFiles: [bundle] } = await build({
    entryPoints: [path.join(root, "scripts/desktop-engine.ts")],
    bundle: true, write: false, globalName: "desktopEngine", format: "iife", target: "es2021",
  });
  const dispatch = runInNewContext(bundle.text + "\ndesktopEngine.dispatch");
  const projection = JSON.parse(dispatch("shareCatalog", "null"));
  assert.deepEqual(projection, data.shareCatalog());
  assert.deepEqual(Object.keys(projection).sort(), ["current", "groups", "tree"]);
  const picker = new Map(data.PICKER_ITEMS.map((item) => [item.id, item.categoryPath]));
  assert.deepEqual(Object.keys(projection.current).sort(), [...data.FILTER_ITEMS_BY_ID.keys()].sort());
  const activeSlots = projection.groups.map(() => []);
  for (const [itemId, [groupId, slot]] of Object.entries(projection.current)) {
    activeSlots[groupId].push(slot);
    assert.equal(resolve(projection, [groupId, slot]), itemId);
    assert.deepEqual(catalog.shareGroups[groupId].path, picker.get(itemId) ?? null, itemId);
  }
  for (const [id, group] of projection.groups.entries()) {
    assert.deepEqual(Object.keys(group).sort(), ["activeSlots", "id", "path", "slots"]);
    assert.equal(group.id, id);
    assert.deepEqual(group.activeSlots, activeSlots[id].sort((a, b) => a - b));
    const { path } = catalog.shareGroups[id];
    assert.deepEqual(group.path, path === null ? null : ordinalPath(catalog.shareTree, path));
    if (path !== null) assert.equal(shareNode(projection.tree, group.path).group, id);
  }
  const groupPath = (itemId) => catalog.shareGroups[projection.current[itemId][0]].path;
  assert.deepEqual(groupPath("class-quest-items"), ["other", "quest-items"]);
  assert.deepEqual(groupPath("base:omen-crest-shield"), ["equipment", "normal-bases", "offhands", "shields"]);
  assert.deepEqual(groupPath("unique:omen-crest-shield"), ["equipment", "unique-equipment", "offhands", "shields"]);
  assert.equal(groupPath("omen-crest-shield"), null);
  assert.equal(groupPath("base:class-shields"), null);
  // 固定几处已分配地址，目录后续更新继续保留这些号码。
  assert.equal(catalog.shareGroups[2].slots["divine-orb"], 7);
  assert.equal(catalog.shareGroups[22].slots["class-waystones"], 0);
  assert.equal(catalog.shareGroups[80].slots["omen-crest-shield"], 421);

  const rootKeys = ["endgame", "crafting", "gems", "supplies", "equipment", "other"];
  assert.deepEqual(rootKeys.map((key) => catalog.shareTree[key].ordinal), [0, 1, 2, 3, 4, 5]);
  const nodes = [buildCatalogTree(data.PICKER_ITEMS)];
  for (const node of nodes) {
    const path = ordinalPath(catalog.shareTree, node.path);
    const projected = shareNode(projection.tree, path);
    assert.deepEqual(Object.keys(projected).sort(), ["children", "group"]);
    assert.equal(projected.group, node.items.length ? projection.current[node.items[0].id][0] : null, node.path.join("/"));
    const expected = sortAddresses(catalogItems(node).map(({ id }) => projection.current[id]));
    assert.deepEqual(sortAddresses(activeAddresses(projection, projected)), expected, node.path.join("/"));
    nodes.push(...node.children);
  }
});

test("实际通货规则和分类组合恰好覆盖完整的可见物品组", () => {
  const projection = data.shareCatalog();
  const nodeAt = (path) => shareNode(projection.tree, ordinalPath(catalog.shareTree, path));
  for (const rule of data.DEFAULT_RULES) {
    assert.deepEqual(selectedIds(projection, nodeAt(["crafting"])), [...rule.target.itemIds].sort(), rule.id);
  }
  const paths = [["crafting", "socketables"], ["equipment", "normal-bases", "one-hand"]];
  const addresses = sortAddresses(paths.flatMap((path) => activeAddresses(projection, nodeAt(path))));
  const ids = [...new Set(addresses.map(([id]) => id))];
  assert.deepEqual(ids, [8, 9, 10, 35, 36, 37, 38]);
  const expected = data.PICKER_ITEMS.filter(({ categoryPath }) => paths.some((path) =>
    path.every((key, index) => key === categoryPath[index])));
  assert.deepEqual(addresses.map((address) => resolve(projection, address)).sort(), expected.map(({ id }) => id).sort());
});

test("调整目录、选择器和数据记录的顺序不会改变组号、槽位或路径序号", () => {
  const view = deriveCatalogView([...catalog.items].reverse(), metadata);
  view.pickerItems.reverse();
  const reordered = Object.fromEntries(Object.entries(catalog.shareGroups).reverse().map(([id, group]) => [id, {
    ...group, slots: Object.fromEntries(Object.entries(group.slots).reverse()),
  }]));
  const reverseTree = (siblings) => Object.fromEntries(Object.entries(siblings).reverse().map(([key, node]) => [key, {
    children: reverseTree(node.children), ordinal: node.ordinal,
  }]));
  const reorderedTree = reverseTree(catalog.shareTree);
  assert.deepEqual(allocateShareGroups(reordered, view), catalog.shareGroups);
  assert.deepEqual(allocateShareTree(reorderedTree, reordered, view), catalog.shareTree);
  assert.deepEqual(projectShareCatalog(reordered, view, reorderedTree), data.shareCatalog());
});

test("组号、组内槽位和同级序号跨过 127 后仍只追加", () => {
  const items = Array.from({ length: 128 }, (_, index) => ({
    id: `first-${index}`, categoryPath: ["branch", String(index).padStart(3, "0")],
  }));
  const firstGroup = items[0].categoryPath;
  for (let index = 1; index < 128; index++) items.push({ id: `item-${index}`, categoryPath: firstGroup });
  const initialView = selectable(items);
  const previous = allocateShareGroups({}, initialView);
  const tree = allocateShareTree({}, {}, initialView);
  const old = projectShareCatalog(previous, initialView, tree);
  assert.equal(old.groups[0].slots.length, 128);
  assert.deepEqual(old.groups[127].path, [0, 127]);
  assert.deepEqual(allocateShareTree({}, {}, selectable([...items].reverse())), tree);

  const extension = selectable([
    { id: "a-earlier-in-sorting", categoryPath: firstGroup },
    { id: "new-root", categoryPath: ["aaa-before-all-existing-paths"] },
    { id: "new-sibling", categoryPath: ["branch", "!before-all-existing-siblings"] },
    ...items,
  ]);
  const extendedGroups = allocateShareGroups(previous, extension);
  const extendedTree = allocateShareTree(tree, previous, extension);
  const next = projectShareCatalog(extendedGroups, extension, extendedTree);
  assert.deepEqual(next.current["a-earlier-in-sorting"], [0, 128]);
  assert.deepEqual(next.current["new-root"], [128, 0]);
  assert.deepEqual(next.current["new-sibling"], [129, 0]);
  assert.deepEqual(next.groups[128].path, [1]);
  assert.deepEqual(next.groups[129].path, [0, 128]);
  assert.equal(shareNode(next.tree, [0, 128]).group, 129);
  assert.equal(shareNode(next.tree, [1]).group, 128);
  assert.deepEqual(next.groups[0].slots.slice(0, old.groups[0].slots.length), old.groups[0].slots);
  assert.deepEqual(next.groups[0].activeSlots, [...old.groups[0].activeSlots, 128]);
  assert.deepEqual(next.groups.slice(1, 128), old.groups.slice(1));
  assert.deepEqual(next.tree.children[0].children.slice(0, 128), old.tree.children[0].children);
  for (const [id, address] of Object.entries(old.current)) assert.deepEqual(next.current[id], address);
});

function catalogFixture(t) {
  const workspace = mkdtempSync(path.join(tmpdir(), "poe2-share-catalog-"));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  mkdirSync(path.join(workspace, "data"));
  return {
    workspace,
    catalogFile: path.join(workspace, "data/item-catalog.json"),
    writeFixture: (name, contents) => writeFileSync(path.join(workspace, "data", name), JSON.stringify(contents)),
  };
}

test("玩法与掉落数据更新时追加新路径，保留旧别名和退役槽位", (t) => {
  const { workspace, catalogFile, writeFixture } = catalogFixture(t);
  const mechanics = readJson(path.join(root, "data/item-mechanics.json"));
  mechanics.items["Divine Orb"].mechanic = "omens";
  const changedMetadata = structuredClone(metadata);
  delete changedMetadata.uniques["Omen Crest Shield"];
  changedMetadata.uniques["Avian Targe"] = { "Catalog Test Unique": null };
  const newKey = "aaa-test-waystones";
  const items = catalog.items.map((item) => item.id === "class-waystones"
    ? { ...item, categoryPath: ["endgame", newKey, "class-selection"] } : item);
  writeFixture("item-catalog.json", { ...catalog, items });
  writeFixture("item-mechanics.json", mechanics);
  writeFixture("item-drop-metadata.json", changedMetadata);

  const addedId = "unique:avian-targe";
  assert.throws(() => projectShareCatalog(catalog.shareGroups, deriveCatalogView(catalog.items, changedMetadata), catalog.shareTree), new RegExp(addedId));
  const updater = path.join(root, "scripts/apply-catalog-mechanics.mjs");
  execFileSync(process.execPath, [updater], { cwd: workspace });
  const updated = readJson(catalogFile);
  const updatedView = deriveCatalogView(updated.items, changedMetadata);
  assert.throws(() => projectShareCatalog(updated.shareGroups, updatedView, catalog.shareTree), /缺少路径序号/);
  const next = projectShareCatalog(updated.shareGroups, updatedView, updated.shareTree);
  const previous = data.shareCatalog();
  const oldSiblings = catalog.shareTree.endgame.children;
  assert.deepEqual(updated.shareTree.endgame.children, {
    ...oldSiblings, [newKey]: { ordinal: Object.keys(oldSiblings).length, children: {} },
  });
  const oldWaystones = previous.current["class-waystones"];
  const newWaystones = next.current["class-waystones"];
  assert.deepEqual(next.groups[newWaystones[0]].path, [0, Object.keys(oldSiblings).length]);
  assert.equal(shareNode(next.tree, previous.groups[oldWaystones[0]].path).group, oldWaystones[0]);
  assert.deepEqual(next.groups[oldWaystones[0]].activeSlots, []);
  assert.equal(resolve(next, oldWaystones), "class-waystones");

  const movedId = "divine-orb";
  const retiredId = "unique:omen-crest-shield";
  const movedFrom = previous.current[movedId];
  const movedTo = next.current[movedId];
  assert.notEqual(movedFrom[0], movedTo[0]);
  assert.deepEqual(updated.shareGroups[movedTo[0]].path, ["crafting", "omens"]);
  assert.equal(movedTo[1], previous.groups[movedTo[0]].slots.length);
  assert.equal(resolve(next, movedFrom), movedId);
  assert.equal(resolve(next, movedTo), movedId);
  assert.ok(!next.groups[movedFrom[0]].activeSlots.includes(movedFrom[1]));
  assert.ok(next.groups[movedTo[0]].activeSlots.includes(movedTo[1]));

  const [retiredGroup, retiredSlot] = previous.current[retiredId];
  assert.equal(updated.shareGroups[retiredGroup].slots[retiredId], retiredSlot);
  assert.equal(next.current[retiredId], undefined);
  assert.equal(resolve(next, [retiredGroup, retiredSlot]), null);
  assert.ok(!next.groups[retiredGroup].activeSlots.includes(retiredSlot));
  assert.equal(resolve(next, [retiredGroup, next.groups[retiredGroup].slots.length]), undefined);
  assert.equal(resolve(next, [next.groups.length, 0]), undefined);
  assert.deepEqual(next.current[addedId], [retiredGroup, previous.groups[retiredGroup].slots.length]);
  assert.equal(resolve(next, next.current[addedId]), addedId);

  const updatedBytes = readFileSync(catalogFile, "utf8");
  execFileSync(process.execPath, [updater, "--share-only"], { cwd: workspace });
  assert.equal(readFileSync(catalogFile, "utf8"), updatedBytes);

  const retiredView = deriveCatalogView(updated.items.filter(({ id }) => id !== movedId), changedMetadata);
  const retired = projectShareCatalog(updated.shareGroups, retiredView, updated.shareTree);
  assert.equal(resolve(retired, movedFrom), null);
  assert.equal(resolve(retired, movedTo), null);
});

test("客户端分类写入器也追加路径序号并保留原路径", (t) => {
  const { workspace, catalogFile, writeFixture } = catalogFixture(t);
  const items = [catalog.items.find(({ id }) => id === "divine-orb")];
  const view = deriveCatalogView(items, metadata);
  const shareGroups = allocateShareGroups({}, view);
  const shareTree = allocateShareTree({}, {}, view);
  writeFixture("item-catalog.json", { items, shareGroups, shareTree });
  writeFixture("item-drop-metadata.json", metadata);
  const clientRoot = path.join(workspace, "client");
  const localeDir = path.join(clientRoot, "us");
  mkdirSync(localeDir, { recursive: true });
  writeFileSync(path.join(localeDir, "BaseItemTypes.jsonl"), JSON.stringify({ Name: "Divine Orb", ItemClass: 31 }) + "\n");
  execFileSync(process.execPath, [path.join(root, "scripts/build-catalog-groups.mjs"), clientRoot, "--skip-mechanics"], { cwd: workspace });
  const updated = readJson(catalogFile);
  const next = projectShareCatalog(updated.shareGroups, deriveCatalogView(updated.items, metadata), updated.shareTree);
  assert.deepEqual(updated.shareTree.crafting, shareTree.crafting);
  assert.deepEqual(next.groups.map(({ path }) => path), [[0, 0], [1, 0]]);
  assert.deepEqual(next.current["divine-orb"], [1, 0]);
  assert.deepEqual(next.groups[0].activeSlots, []);
  assert.equal(resolve(next, [0, 0]), "divine-orb");
});

test("父类和子类按当前槽位全选，移动与退役保留历史路径", () => {
  const branch = ["branch"];
  const child = [...branch, "child"];
  const retiredPath = [...branch, "retired"];
  const other = ["other"];
  const items = [
    { id: "a-direct", categoryPath: branch },
    { id: "moved", categoryPath: branch },
    { id: "z-direct", categoryPath: branch },
    { id: "child-item", categoryPath: child },
    { id: "retired", categoryPath: retiredPath },
    { id: "untouched", categoryPath: other },
  ];
  const withHidden = (pickerItems) => ({ filterItems: [...pickerItems, { id: "hidden" }], pickerItems });
  const initialView = withHidden(items);
  const groups = allocateShareGroups({}, initialView);
  const tree = allocateShareTree({}, {}, initialView);
  const before = projectShareCatalog(groups, initialView, tree);
  const [directGroup] = before.current.moved;
  const [retiredGroup, retiredSlot] = before.current.retired;
  const [hiddenGroup, hiddenSlot] = before.current.hidden;
  const branchPath = before.groups[directGroup].path;
  const branchNode = shareNode(before.tree, branchPath);
  assert.equal(branchNode.group, directGroup);
  assert.ok(branchNode.children.length);
  assert.deepEqual(before.groups[directGroup].activeSlots, [0, 1, 2]);
  assert.deepEqual(selectedIds(before, branchNode), ["a-direct", "child-item", "moved", "retired", "z-direct"]);
  assert.deepEqual(selectedIds(before, before.tree), items.map(({ id }) => id).sort());
  assert.equal(before.groups[hiddenGroup].path, null);
  assert.deepEqual(before.groups[hiddenGroup].activeSlots, [hiddenSlot]);

  const changed = withHidden(items.filter(({ id }) => id !== "retired").map((item) =>
    item.id === "moved" ? { ...item, categoryPath: child } : item,
  ));
  const changedGroups = allocateShareGroups(groups, changed);
  const changedTree = allocateShareTree(tree, groups, changed);
  const next = projectShareCatalog(changedGroups, changed, changedTree);
  assert.deepEqual(changedTree, tree);
  assert.deepEqual(next.tree, before.tree);
  assert.deepEqual(next.groups[directGroup].activeSlots, [0, 2]);
  assert.deepEqual(selectedIds(next, shareNode(next.tree, branchPath)), ["a-direct", "child-item", "moved", "z-direct"]);
  assert.notDeepEqual(next.current.moved, before.current.moved);
  assert.equal(resolve(next, before.current.moved), "moved");
  assert.equal(shareNode(next.tree, next.groups[retiredGroup].path).group, retiredGroup);
  assert.deepEqual(next.groups[retiredGroup].activeSlots, []);
  assert.equal(resolve(next, [retiredGroup, retiredSlot]), null);

  const restoredGroups = allocateShareGroups(changedGroups, initialView);
  const restoredTree = allocateShareTree(changedTree, changedGroups, initialView);
  const restored = projectShareCatalog(restoredGroups, initialView, restoredTree);
  assert.deepEqual(restoredTree, tree);
  assert.deepEqual(restored.current, before.current);
  assert.deepEqual(restored.groups.map(({ activeSlots }) => activeSlots), before.groups.map(({ activeSlots }) => activeSlots));
  assert.equal(resolve(restored, next.current.moved), "moved");
  assert.equal(resolve(restored, [retiredGroup, retiredSlot]), "retired");
});

const shareEntry = (ordinal, children = {}) => ({ ordinal, children });

test("数据校验拒绝缺号、重复路径和冲突的槽位", () => {
  const empty = selectable([]);
  const group = { path: ["valid"], slots: { "retired-id": 0 } };
  const tree = { valid: shareEntry(0) };
  assert.throws(() => projectShareCatalog({ 1: group }, empty, tree), /分类号不连续/);
  assert.throws(() => projectShareCatalog({ 0: group, 1: group }, empty, tree), /分类路径重复/);
  assert.throws(() => projectShareCatalog({ 0: { ...group, slots: { item: 1 } } }, empty, tree), /槽位 .*无效/);
  assert.throws(() => projectShareCatalog({ 0: { ...group, slots: { item: 0, other: 0 } } }, empty, tree), /槽位 .*重复/);
});

test("数据校验要求同级序号连续、唯一，历史分类也必须保留路径", () => {
  const groups = {
    0: { path: ["branch", "a"], slots: { a: 0 } },
    1: { path: ["branch", "b"], slots: { b: 0 } },
    2: { path: null, slots: { hidden: 0 } },
    3: { path: ["other"], slots: { retired: 0 } },
  };
  const branch = shareEntry(0, { b: shareEntry(1), a: shareEntry(0) });
  const tree = { other: shareEntry(1), branch };
  const project = (ordinals) => projectShareCatalog(groups, selectable([]), ordinals);
  assert.deepEqual(project(tree).tree, { group: null, children: [
    { group: null, children: [{ group: 0, children: [] }, { group: 1, children: [] }] },
    { group: 3, children: [] },
  ] });
  for (const invalid of [undefined, null, []]) assert.throws(() => project(invalid), /shareTree/);
  assert.throws(() => project({ ...tree, branch: { ordinal: 0 } }), /子分类记录/);
  for (const invalid of [-1, 0.5, "0", 2]) {
    assert.throws(() => project({ ...tree, branch: { ...branch, ordinal: invalid } }), /同级序号/);
  }
  assert.throws(() => project({ ...tree, branch: shareEntry(0, { a: shareEntry(0), b: shareEntry(0) }) }), /同级序号/);
  assert.throws(() => project({ ...tree, "": shareEntry(2) }), /分享码分类/);
  const missing = { branch };
  assert.throws(() => project(missing), /分类 3 缺少路径序号/);
  // 即使旧分类再次有当前成员，更新目录也不能重新分配丢失的历史路径。
  assert.throws(() => allocateShareTree(missing, groups, selectable([{ id: "retired", categoryPath: ["other"] }])), /分类 3 缺少路径序号/);
});

test("新规则的 id 是 8 位字母数字，并在方案内唯一", () => {
  const taken = new Set();
  for (let index = 0; index < 2000; index += 1) {
    const id = newRuleId(taken);
    assert.match(id, /^[0-9A-Za-z]{8}$/);
    assert.ok(!taken.has(id), id);
    taken.add(id);
  }
});

test("规则 id 的取值不偏，撞上已占用的 id 时重新抽取", () => {
  // 固定的随机源：按顺序循环给出这些字节。
  const source = (bytes) => {
    let at = 0;
    return (length) => Uint8Array.from({ length }, () => bytes[at++ % bytes.length]);
  };
  assert.equal(newRuleId([], source([0, 1, 2, 3, 4, 5, 6, 7])), "01234567");
  // 248 及以上的取值直接丢弃，免得取模后前几个字符偏多；62 取模后是 0。
  assert.equal(newRuleId([], source([255, 61, 62])), "z0z0z0z0");
  // 第一轮抽到 "01234567"，已被占用；第二轮是 8, 0, 1, 2, 3, 4, 5, 6。
  assert.equal(newRuleId(["01234567"], source([0, 1, 2, 3, 4, 5, 6, 7, 8])), "80123456");
  assert.throws(() => newRuleId(["00000000"], source([0])), /无法生成不重复的规则 id/);
  assert.throws(() => newRuleId([], source([255])), /随机源/);
});

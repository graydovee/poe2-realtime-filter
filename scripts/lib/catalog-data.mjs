import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

async function catalogShareInputs(catalog) {
  // 用当前磁盘上的原始数据和应用的派生逻辑，不依赖已打包的桌面引擎。
  const { outputFiles: [bundle] } = await build({
    entryPoints: [fileURLToPath(new URL("../../lib/catalog-view.ts", import.meta.url))],
    bundle: true,
    write: false,
    format: "esm",
    target: "es2021",
  });
  const { deriveCatalogView, allocateShareGroups, allocateShareTree, projectShareCatalog } = await import(
    `data:text/javascript;base64,${Buffer.from(bundle.contents).toString("base64")}`
  );
  const metadata = JSON.parse(fs.readFileSync("data/item-drop-metadata.json", "utf8"));
  return { view: deriveCatalogView(catalog.items, metadata), allocateShareGroups, allocateShareTree, projectShareCatalog };
}

export async function writeCatalogWithShareData(file, catalog) {
  const { view, allocateShareGroups, allocateShareTree } = await catalogShareInputs(catalog);
  const shareGroups = allocateShareGroups(catalog.shareGroups, view);
  const shareTree = allocateShareTree(catalog.shareTree, catalog.shareGroups, view);
  fs.writeFileSync(file, JSON.stringify({ ...catalog, shareGroups, shareTree }, null, 2) + "\n");
  Object.assign(catalog, { shareGroups, shareTree });
}

export async function validateCatalogShareData(catalog) {
  const { view, projectShareCatalog } = await catalogShareInputs(catalog);
  return projectShareCatalog(catalog.shareGroups, view, catalog.shareTree);
}

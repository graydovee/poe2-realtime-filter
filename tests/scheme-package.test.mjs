import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";
import { cleanup, DEFAULT_PROFILE, validateProfile } from "./helpers.mjs";

test.after(cleanup);

const root = fileURLToPath(new URL("../", import.meta.url));
const imported = (id = "3f2a91bea8b3c1d40e7f6a5b4c3d2e1f") => ({
  kind: "imported",
  id,
  entry: "OnlineFilters/4pQrzmUJ",
  name: "NeverSink-6uberplu-poe2",
});

test("方案包导入的基础过滤器通过方案校验", () => {
  const profile = validateProfile({ ...DEFAULT_PROFILE, baseFilter: imported() });
  assert.deepEqual(profile.baseFilter, imported());
});

test("方案包导入的基础过滤器要有合法的 ID 和入口路径", () => {
  for (const baseFilter of [
    imported("short"),
    imported("3F2A91BEA8B3C1D40E7F6A5B4C3D2E1F"),
    imported("g".repeat(32)),
    { ...imported(), entry: "" },
    { ...imported(), entry: "../OnlineFilters/4pQrzmUJ\u0000" },
    { ...imported(), name: "" },
  ]) {
    assert.throws(() => validateProfile({ ...DEFAULT_PROFILE, baseFilter }), /无效的基础过滤器来源/);
  }
});

test("方案库用本名显示方案包导入的基础过滤器", async () => {
  const { outputFiles: [bundle] } = await build({
    entryPoints: [path.join(root, "app/components/manager/scheme-meta.ts")],
    bundle: true, write: false, format: "iife", globalName: "schemeMeta", target: "es2021",
  });
  const { baseLabel } = runInNewContext(bundle.text + "\nschemeMeta");
  assert.equal(baseLabel(imported()), "NeverSink-6uberplu-poe2 · 来自方案包");
  assert.equal(baseLabel({ kind: "local", path: "D:\\a.filter", name: "a.filter" }), "a.filter");
});

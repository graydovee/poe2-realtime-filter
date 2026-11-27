import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));

test("行情时间：今年带时分，跨年只留日期，没有行情或无效的值为空", async () => {
  const { outputFiles: [bundle] } = await build({
    entryPoints: [path.join(root, "lib/time.ts")],
    bundle: true, write: false, format: "iife", globalName: "time", target: "es2021",
  });
  const { formatMarketTime, formatMarketTimeFull } = runInNewContext(bundle.text + "\ntime");
  // 时间都用本地时间构造和格式化，结果不依赖机器的时区。
  const now = new Date(2026, 10, 26, 16, 40).getTime();
  assert.equal(formatMarketTime(new Date(2026, 10, 26, 8, 5).toISOString(), now), "11-26 08:05");
  assert.equal(formatMarketTime(new Date(2025, 11, 30, 23, 59).toISOString(), now), "2025-12-30");
  // 完整时间和状态栏、预览里的行情时间用同一种本地格式。
  assert.equal(formatMarketTimeFull(new Date(2026, 0, 2, 3, 4, 5).toISOString()), "2026/1/2 03:04:05");
  for (const missing of [null, undefined, "", "not a time", "1970-01-01T00:00:00.000Z"]) {
    assert.equal(formatMarketTime(missing, now), null);
    assert.equal(formatMarketTimeFull(missing), null);
  }
});

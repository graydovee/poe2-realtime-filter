import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const root = process.cwd();

test("NeverSink baseline files are vendored", () => {
  execFileSync(process.execPath, ["scripts/validate-data.mjs"], { cwd: root, stdio: "pipe" });
  assert.equal(existsSync("vendor/neversink/NeverSink's filter 2 - 2-SEMI-STRICT.filter"), true);
});

test("generated safety policy is documented", () => {
  const readme = readFileSync("README.md", "utf8");
  assert.match(readme, /未知物品/);
  assert.match(readme, /白名单/);
});

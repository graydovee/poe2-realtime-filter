import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

// 只编译界面用到的两个纯函数模块（不依赖 DOM），做法与 helpers.mjs 一致。
const require = createRequire(import.meta.url);
const output = mkdtempSync(path.join(tmpdir(), "poe2-ui-"));
execFileSync(
  process.execPath,
  [
    "node_modules/typescript/bin/tsc",
    "lib/effect-labels.ts",
    "lib/filter-highlight.ts",
    "--outDir", output,
    "--rootDir", "lib",
    "--module", "commonjs",
    "--target", "es2021",
    "--skipLibCheck",
  ],
  { stdio: "pipe" },
);

export const labels = require(path.join(output, "effect-labels.js"));
export const highlight = require(path.join(output, "filter-highlight.js"));
export const cleanup = () => rmSync(output, { recursive: true, force: true });

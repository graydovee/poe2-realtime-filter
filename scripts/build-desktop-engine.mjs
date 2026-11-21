import { build } from "esbuild";

await build({ entryPoints: ["scripts/desktop-engine.ts"], outfile: "src-tauri/generated/engine.js", bundle: true, globalName: "desktopEngine", format: "iife", target: "es2021", legalComments: "none" });

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const root = path.resolve("vendor/neversink");
const items = { "exalted-orb": "Exalted Orb", "chaos-orb": "Chaos Orb", "orb-of-annulment": "Orb of Annulment", "divine-orb": "Divine Orb" };
const variants = { default: "", aura: "AURA", cobalt: "COBALT", darkmode: "DARKMODE", mythic: "MYTHIC", vaal: "VAAL", zen: "ZEN", customsounds: "CUSTOMSOUNDS" };
const tiers = ["0-SOFT", "1-REGULAR", "2-SEMI-STRICT", "3-STRICT", "4-VERY-STRICT", "5-UBER-STRICT", "6-UBER-PLUS-STRICT"];
const files = {};
for (const [style, directory] of Object.entries(variants)) {
  for (const tier of tiers) {
    const file = directory ? `(STYLE) ${directory}/NeverSink's filter 2 - ${tier} (${style}) .filter` : `NeverSink's filter 2 - ${tier}.filter`;
    const source = fs.readFileSync(path.join(root, file), "utf8");
    const blocks = [...source.matchAll(/^(?:Show|Hide)\b[^\n]*\n[\s\S]*?(?=^(?:#?(?:Show|Hide))\b|(?![\s\S]))/gm)];
    const appearances = {};
    for (const [id, name] of Object.entries(items)) {
      const block = blocks.find((match) => match[0].split("\n")[0].includes("$type->currency $tier->") && [...match[0].matchAll(/^\s*BaseType == (.+)$/gm)].some((line) => [...line[1].matchAll(/"([^"]+)"/g)].some((value) => value[1] === name)));
      if (!block) throw new Error(`Currency rule missing: ${name} in ${file}`);
      const command = (key) => block[0].match(new RegExp("^\\s*" + key + "\\s+([^\\n]+)", "m"))?.[1].trim();
      const builtin = command("PlayAlertSound");
      const custom = command("CustomAlertSound");
      const sound = builtin ? { type: "builtin", id: Number(builtin.split(/\s+/)[0]), volume: Number(builtin.split(/\s+/)[1] || 300) } : custom ? { type: "neversink", fileName: custom.match(/"([^"]+)"/)[1] } : undefined;
      if (!sound || !command("PlayEffect")) throw new Error(`Incomplete currency appearance: ${name} in ${file}`);
      appearances[id] = { name, effect: command("PlayEffect"), minimapIcon: command("MinimapIcon"), textColor: command("SetTextColor"), borderColor: command("SetBorderColor"), backgroundColor: command("SetBackgroundColor"), fontSize: Number(command("SetFontSize")), sound, line: source.slice(0, block.index).split("\n").length };
    }
    files[`${style}:${Number(tier[0])}`] = { file, sha256: crypto.createHash("sha256").update(source).digest("hex"), appearances };
  }
}
const data = { version: "0.10.4a", releaseUrl: "https://github.com/NeverSinkDev/NeverSink-Filter-for-PoE2/releases/tag/0.10.4a", files };
const target = path.resolve("data/neversink-currency-appearances.json");
const output = JSON.stringify(data, null, 2) + "\n";
if (process.argv.includes("--check")) {
  if (fs.readFileSync(target, "utf8") !== output) throw new Error("Currency appearances are stale; run node scripts/extract-neversink-appearances.mjs");
} else fs.writeFileSync(target, output);
console.log(`Verified currency appearances from ${Object.keys(files).length} NeverSink templates`);

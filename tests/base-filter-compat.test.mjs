import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { DEFAULT_PROFILE, cleanup, engine, generateOnBase, makeRule, snapshot, validateProfile } from "./helpers.mjs";

test.after(cleanup);

const build = (rules) => ({ ...DEFAULT_PROFILE, rules });
const rule = (id, itemIds) => makeRule({ id, name: id, target: { itemIds }, effects: { beam: "Blue" } });
const current = readFileSync("vendor/neversink/NeverSink's filter 2 - 2-SEMI-STRICT.filter", "utf8");
// 行号以最终文本为准：取第一条生效的旧类别条件所在的行。
const firstUseLine = (filter) => filter.split("\n").findIndex((line) => /^\s*Class\b.*"Socketable"/.test(line)) + 1;

test("参考版本号和内置 NeverSink 的文件头一致", () => {
  const header = current.match(/^#\s*VERSION:\s*(\S+)/m);
  assert.ok(header, "内置的 NeverSink 没有版本行");
  assert.equal(engine.NEVERSINK_REFERENCE_VERSION, header[1]);
});

test("内置的 NeverSink 里没有已改名的类别", () => {
  assert.deepEqual(Object.keys(engine.RENAMED_ITEM_CLASSES), ["Socketable"]);
  const output = generateOnBase(build([rule("orb", ["divine-orb"])]), current, snapshot);
  assert.deepEqual(output.safetyReport.baselineIssues, []);
  assert.equal(output.safetyReport.passed, true);
  assert.ok(!output.safetyReport.warnings.some((line) => line.includes("NeverSink")), output.safetyReport.warnings.join(" / "));
});

test("基础过滤器用了已改名的类别：报出行号，并且不通过安全检查", () => {
  // 模拟 2025 年 12 月之前的 NeverSink：注释行里的旧名字不算，只有生效的条件才算。
  const stale = [
    "# NeverSink's filter (fixture)", "# VERSION:  0.8.3", "",
    "Show # currency", "\tClass == \"Stackable Currency\"", "\tSetFontSize 40", "",
    "#\tClass == \"Socketable\"",
    "Show # runes", "\tClass == \"Socketable\"", "\tSetFontSize 40", "",
    "Show # more", "\tClass == \"Socketable\" \"Stackable Currency\"", "\tSetFontSize 42", "",
  ].join("\n");
  const output = generateOnBase(build([rule("orb", ["divine-orb"])]), stale, snapshot);
  const line = firstUseLine(output.filterFile);
  assert.ok(line > 1, "测试用的基础过滤器里应该有一条生效的 Socketable 条件");
  assert.deepEqual(output.safetyReport.baselineIssues, [
    `第 ${line} 行：物品类别 "Socketable" 已被游戏改名为 "Augment"，游戏会拒绝加载整份过滤器。基础过滤器需要更新到当前游戏版本。（共 2 行用了旧名字）`,
  ]);
  assert.equal(output.safetyReport.passed, false);
  // 文件头写着 0.8.3，比内置的参考版本旧：给出不阻断的提醒。
  assert.ok(output.safetyReport.warnings.some((entry) => entry.includes("NeverSink 0.8.3") && entry.includes(engine.NEVERSINK_REFERENCE_VERSION)), output.safetyReport.warnings.join(" / "));
});

test("报出的行号跟着最终文本走：规则越多，行号越大", () => {
  const stale = "Show # runes\n\tClass == \"Socketable\"\n\tSetFontSize 40\n";
  const short = generateOnBase(build([rule("orb", ["divine-orb"])]), stale, snapshot);
  const long = generateOnBase(build([rule("orb", ["divine-orb"]), rule("more", ["exalted-orb", "chaos-orb"])]), stale, snapshot);
  const shortLine = Number(/\d+/.exec(short.safetyReport.baselineIssues[0])[0]);
  const longLine = Number(/\d+/.exec(long.safetyReport.baselineIssues[0])[0]);
  assert.equal(shortLine, firstUseLine(short.filterFile));
  assert.equal(longLine, firstUseLine(long.filterFile));
  assert.ok(longLine > shortLine, `${longLine} 应该大于 ${shortLine}`);
});

test("不带引号、不带运算符的 Class 写法也能查出来；没有版本行的过滤器不提醒版本", () => {
  const other = "Show # runes\n\tClass Socketable\n\tSetFontSize 40\n";
  const output = generateOnBase(build([rule("orb", ["divine-orb"])]), other, snapshot);
  assert.equal(output.safetyReport.baselineIssues.length, 1);
  assert.ok(!output.safetyReport.warnings.some((entry) => entry.includes("NeverSink")), output.safetyReport.warnings.join(" / "));
});

test("没有基础过滤器时不会有基础过滤器的问题", () => {
  const output = generateOnBase(validateProfile(build([rule("orb", ["divine-orb"])])), null, snapshot);
  assert.deepEqual(output.safetyReport.baselineIssues, []);
});

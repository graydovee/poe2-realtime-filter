import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, highlight, labels } from "./ui-helpers.mjs";

test.after(cleanup);

test("过滤器文本按行分类：规则起点、条件、动作、注释与空行", () => {
  const lines = highlight.tokenizeFilter(
    [
      "# poe2-filter generated overlay",
      "Hide # poe2-filter rule: demo",
      '    BaseType == "Breach Splinter"',
      "",
      "Show",
      '    BaseType "Waystones"',
      "    ItemLevel >= 75",
      "    SetFontSize 45",
      "    MinimapIcon 1 Blue Circle",
      "    PlayAlertSound 6 300",
      "    Continue",
    ].join("\n"),
  );
  assert.deepEqual(
    lines.map((line) => line.type),
    ["comment", "rule", "condition", "blank", "rule", "condition", "condition", "action", "action", "action", "action"],
  );
  // 首个规则之前的注释不属于任何规则，之后按规则序号归组。
  assert.deepEqual(lines.map((line) => line.block), [null, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1]);
  assert.equal(lines[0].tokens[0].kind, "comment");
  assert.deepEqual(lines[1].tokens, [{ text: "Hide", kind: "rule" }, { text: "# poe2-filter rule: demo", kind: "comment" }]);
  assert.deepEqual(lines[2].tokens, [
    { text: "BaseType", kind: "prop" },
    { text: "==", kind: "op" },
    { text: '"Breach Splinter"', kind: "str" },
  ]);
  assert.deepEqual(lines[6].tokens, [{ text: "ItemLevel", kind: "prop" }, { text: ">=", kind: "op" }, { text: "75", kind: "num" }]);
  assert.deepEqual(lines[8].tokens, [
    { text: "MinimapIcon", kind: "prop" },
    { text: "1", kind: "num" },
    { text: "Blue", kind: "value" },
    { text: "Circle", kind: "value" },
  ]);
  assert.deepEqual(lines[10].tokens, [{ text: "Continue", kind: "prop" }]);
  assert.equal(lines[2].indent, "    ");
});

test("过滤器文本兼容 CRLF，未知动作名按条件行处理", () => {
  const lines = highlight.tokenizeFilter("Show\r\n    Rarity Unique\r\n    CustomAlertSound \"x.mp3\"\r\n    FutureAction 1");
  assert.deepEqual(lines.map((line) => line.type), ["rule", "condition", "action", "condition"]);
  assert.equal(lines[1].indent, "    ");
});

test("特效描述把光柱、图标、字体、音效逐项翻成中文", () => {
  assert.equal(labels.describeEffects({}), "跟随基础过滤器");
  assert.equal(labels.describeEffects({ beam: "Blue Temp" }), "蓝色光柱（临时）");
  assert.equal(labels.describeEffects({ icon: "1 Yellow Star" }), "黄色星形图标·1");
  // 字体固定列出字号 / 文字色 / 边框色 / 背景色，没设置的显示为「—」。
  assert.equal(labels.describeEffects({ font: { fontSize: 42, textColor: "0 0 0 255", borderColor: "255 255 255 128" } }), "字体 42号 / #000000 / #ffffff / —");
  assert.equal(labels.describeEffects({ sound: { type: "builtin", id: 6, volume: 300 } }), "音效 6");
  assert.equal(labels.describeEffects({ sound: { type: "custom", fileName: "a.mp3" } }), "音效 a.mp3");
  assert.equal(labels.describeIcon("0 Red Diamond"), "红色菱形 · 尺寸 0");
  assert.deepEqual(labels.iconParts("2 Green Hexagon"), { size: "2", color: "Green", shape: "Hexagon" });
});

test("颜色转换：过滤器的 R G B (A) 与预览用的十六进制", () => {
  assert.equal(labels.rgba("255 0 0 255"), "rgba(255, 0, 0, 1)");
  assert.equal(labels.rgba("10 20 30 128"), "rgba(10, 20, 30, 0.5019607843137255)");
  assert.equal(labels.rgba("1 2 3"), "rgba(1, 2, 3, 1)");
  assert.equal(labels.rgba(undefined), "transparent");
  assert.equal(labels.rgba("bad value", "fallback"), "fallback");
  assert.equal(labels.hex("255 0 0 255"), "#ff0000");
  assert.equal(labels.hex(undefined), "—");
  assert.equal(labels.hex("not rgb"), "not rgb");
  assert.equal(labels.rgbaFromHex("#fff", 0.5), "rgba(255,255,255,0.5)");
  assert.equal(labels.rgbaFromHex("#ff4040", 1), "rgba(255,64,64,1)");
  assert.equal(labels.rgbaFromHex("oops", 1), "rgba(255,255,255,1)");
});

test("套用预设时只写入填写的特效项", () => {
  assert.deepEqual(labels.pickEffects({ id: "p", beam: "Red", icon: "1 Red Star" }), { beam: "Red", icon: "1 Red Star" });
  assert.deepEqual(labels.pickEffects({ id: "p" }), {});
});

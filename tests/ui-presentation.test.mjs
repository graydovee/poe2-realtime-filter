import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, color, highlight, icons, labels, sound } from "./ui-helpers.mjs";

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
  // 尺寸按界面上的叫法显示：0 最大，2 最小。
  assert.equal(labels.describeEffects({ icon: "1 Yellow Star" }), "黄色星形图标·中");
  // 字体固定列出字号 / 文字色 / 边框色 / 背景色，没设置的显示为「—」。
  assert.equal(labels.describeEffects({ font: { fontSize: 42, textColor: "0 0 0 255", borderColor: "255 255 255 128" } }), "字体 42号 / #000000 / #ffffff / —");
  assert.equal(labels.describeEffects({ sound: { type: "builtin", id: 6, volume: 300 } }), "音效 6");
  assert.equal(labels.describeEffects({ sound: { type: "custom", fileName: "a.mp3" } }), "音效 a.mp3");
  assert.equal(labels.describeIcon("0 Red Diamond"), "红色菱形 · 大");
  assert.deepEqual(labels.iconParts("2 Green Hexagon"), { size: "2", color: "Green", shape: "Hexagon" });
  assert.equal(labels.describeIcon("1 Purple Moon"), "紫色月亮 · 中");
  assert.equal(labels.describeEffects({ icon: "2 Blue Raindrop" }), "蓝色水滴图标·小");
});

test("地图图标分项修改：改一项不动另外两项，缺的项用默认值补", () => {
  const defaults = { size: "1", color: "Red", shape: "Star" };
  assert.equal(labels.withIconPart("0 Blue Circle", "shape", "Hexagon", defaults), "0 Blue Hexagon");
  assert.equal(labels.withIconPart("0 Blue Circle", "size", "2", defaults), "2 Blue Circle");
  assert.equal(labels.withIconPart("0 Blue Circle", "shape", "", defaults), "");
  assert.equal(labels.withIconPart(undefined, "shape", "Kite", defaults), "1 Red Kite");
  assert.equal(labels.withIconPart("1 Red", "color", "Blue", defaults), "1 Blue Star");
  assert.equal(labels.mapIconSizeName("0"), "大");
  assert.equal(labels.mapIconSizeName("2"), "小");
  assert.equal(labels.mapIconSizeName("7"), "7");
  assert.equal(labels.mapIconSizeName(undefined), undefined);
  assert.deepEqual(labels.beamColors.map((entry) => entry.name), Object.keys(labels.beamColorNames));
});

test("过滤器颜色：读写 R G B (A)，换算成 CSS", () => {
  assert.deepEqual(color.parseFilterColor("255 0 128"), { r: 255, g: 0, b: 128, a: 255, hasAlpha: false });
  assert.deepEqual(color.parseFilterColor(" 10 20 30 128 "), { r: 10, g: 20, b: 30, a: 128, hasAlpha: true });
  // 透明度不是 255，或原文写了透明度时，写回才带第四个分量。
  assert.equal(color.formatFilterColor({ r: 255, g: 0, b: 128, a: 255, hasAlpha: false }), "255 0 128");
  assert.equal(color.formatFilterColor({ r: 255, g: 0, b: 128, a: 255, hasAlpha: true }), "255 0 128 255");
  assert.equal(color.formatFilterColor({ r: 255, g: 0, b: 128, a: 200, hasAlpha: false }), "255 0 128 200");
  for (const bad of [undefined, "", "255 0", "256 0 0", "300 0 0 255", "-1 0 0", "1.5 0 0", "255 0 0 255 1", "abc", "1e2 0 0"]) {
    assert.equal(color.parseFilterColor(bad), undefined, String(bad) + " 应判为无效");
  }
  assert.equal(color.cssColor({ r: 255, g: 0, b: 128, a: 128 }), "rgba(255, 0, 128, 0.5019607843137255)");
  assert.equal(color.rgbToHex({ r: 255, g: 0, b: 128 }), "#ff0080");
  assert.deepEqual(color.hexToRgb("#ff0080"), { r: 255, g: 0, b: 128 });
  assert.deepEqual(color.hexToRgb("#AbC"), { r: 170, g: 187, b: 204 });
  assert.equal(color.hexToRgb("#ff00"), undefined);
  assert.equal(color.hexToRgb("red"), undefined);
});

test("取色器换算：RGB 和色相、饱和度、明度来回一致", () => {
  const primaries = {
    red: [[255, 0, 0], 0], yellow: [[255, 255, 0], 60], green: [[0, 255, 0], 120],
    cyan: [[0, 255, 255], 180], blue: [[0, 0, 255], 240], magenta: [[255, 0, 255], 300],
  };
  for (const [name, [[r, g, b], hue]] of Object.entries(primaries)) {
    const hsv = color.rgbToHsv({ r, g, b });
    assert.ok(Math.abs(hsv.h - hue) < 1e-9 && hsv.s === 1 && hsv.v === 1, name + " 的色相应为 " + hue);
    assert.deepEqual(color.hsvToRgb(hsv), { r, g, b });
  }
  assert.deepEqual(color.rgbToHsv({ r: 128, g: 128, b: 128 }), { h: 0, s: 0, v: 128 / 255 });
  assert.deepEqual(color.hsvToRgb({ h: 0, s: 0, v: 1 }), { r: 255, g: 255, b: 255 });
  assert.deepEqual(color.hsvToRgb({ h: 0, s: 1, v: 0.5 }), { r: 128, g: 0, b: 0 });
  // 走一趟来回，每个分量的误差不超过 1。
  for (let r = 0; r <= 255; r += 17) {
    for (let g = 0; g <= 255; g += 17) {
      for (let b = 0; b <= 255; b += 17) {
        const back = color.hsvToRgb(color.rgbToHsv({ r, g, b }));
        assert.ok(
          [r, g, b].every((value, index) => Math.abs(value - [back.r, back.g, back.b][index]) <= 1),
          `${r} ${g} ${b} 往返后变成 ${back.r} ${back.g} ${back.b}`,
        );
      }
    }
  }
});

test("地图图标：GGG 文档里的 12 种形状都有轮廓和中文名", () => {
  const shapes = ["Circle", "Star", "Diamond", "Square", "Pentagon", "Hexagon", "Triangle", "Cross", "Kite", "UpsideDownHouse", "Moon", "Raindrop"];
  assert.deepEqual(labels.mapIconShapes, shapes);
  assert.deepEqual(Object.keys(labels.mapIconShapeNames), shapes);
  // 轮廓和游戏图标一致：菱形阵由 4 个小菱形组成，五边形是空心的，三角形被一条缝分成上下两段。
  const parts = Object.fromEntries(shapes.map((shape) => [shape, icons.mapIconPath(shape).split("M").length - 1]));
  assert.deepEqual(parts, {
    Circle: 1, Star: 1, Diamond: 4, Square: 1, Pentagon: 2, Hexagon: 1, Triangle: 2, Cross: 1, Kite: 1, UpsideDownHouse: 1, Moon: 1, Raindrop: 1,
  });
  for (const shape of shapes) {
    const numbers = icons.mapIconPath(shape).match(/-?\d+(?:\.\d+)?/g).map(Number);
    assert.equal(numbers.length % 2, 0, shape + " 的轮廓坐标应成对");
    assert.ok(numbers.every((value) => value >= 0 && value <= 24), shape + " 的轮廓应落在 24×24 画布内");
  }
  assert.equal(icons.mapIconPath("Hex"), undefined);
  assert.equal(icons.mapIconPath("constructor"), undefined);
  assert.equal(icons.mapIconPath(""), undefined);
  assert.equal(icons.mapIconPath(undefined), undefined);
});

test("自定义音效：方案里选过的文件别的规则可以直接选，同名的另一个文件另起名字", () => {
  const first = { name: "alert.mp3", size: 10 };
  const second = { name: "alert.mp3", size: 20 };
  const rule = (id, effects, followsBase = false) => ({ id, effects, ...(followsBase ? { baselineEffectItemId: "divine-orb" } : {}) });
  const rules = [
    rule("r1", { sound: { type: "custom", fileName: "alert.mp3" } }),
    rule("r2", { sound: { type: "custom", fileName: "alert-2.mp3" } }),
    rule("r3", { sound: { type: "builtin", id: 3, volume: 300 } }),
    rule("r4", { sound: { type: "custom", fileName: "missing.mp3" } }),
    rule("r5", { sound: { type: "custom", fileName: "base-style.mp3" } }, true),
    rule("r6", {}),
  ];
  // 没有文件的和跟随基础特效的规则不提供选项；同一个文件被多条规则使用时只列一次。
  const files = { r1: first, r2: second, r5: first, r6: first };
  const options = sound.customSoundOptions(rules, files);
  assert.deepEqual(options.map((option) => option.fileName), ["alert.mp3", "alert-2.mp3"]);
  assert.equal(options[0].file, first);
  const used = [{ fileName: "alert.mp3", file: first }];
  // 同名同大小是同一个文件；同名但大小不同时在扩展名前加序号。
  assert.equal(sound.customSoundFileName(first, used), "alert.mp3");
  assert.equal(sound.customSoundFileName(second, used), "alert-2.mp3");
  assert.equal(sound.customSoundFileName(second, [...used, { fileName: "alert-2.mp3", file: second }]), "alert-3.mp3");
  assert.equal(sound.customSoundFileName({ name: "fresh.ogg", size: 1 }, used), "fresh.ogg");
  assert.equal(sound.safeSoundName("my alert (1).mp3"), "my_alert__1_.mp3");
});

test("对基础规则的修改里的自定义音效也在方案的音效库里，规则和别的修改可以直接选", () => {
  const alert = { name: "alert.mp3", size: 10 };
  const chime = { name: "chime.ogg", size: 30 };
  const rules = [{ id: "r1", effects: { sound: { type: "custom", fileName: "alert.mp3" } } }];
  const overlays = [
    { id: "o1", effects: { sound: { type: "custom", fileName: "alert.mp3" } } },
    { id: "o2", effects: { sound: { type: "custom", fileName: "chime.ogg" } } },
    { id: "o3", effects: { sound: { type: "builtin", id: 2, volume: 300 } } },
    { id: "o4", effects: { sound: { type: "custom", fileName: "missing.mp3" } } },
  ];
  // 规则和修改用同一个文件时只列一次；没有文件的修改不提供选项。
  const options = sound.customSoundOptions(rules, { r1: alert, o1: alert, o2: chime }, overlays);
  assert.deepEqual(options.map((option) => option.fileName), ["alert.mp3", "chime.ogg"]);
  assert.equal(options[1].file, chime);
  // 给修改新选的音效和方案里已有的同名但内容不同时，另起名字。
  assert.equal(sound.customSoundFileName({ name: "chime.ogg", size: 40 }, options), "chime-2.ogg");
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

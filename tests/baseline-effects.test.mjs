import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { baseStyles, blockFor, cleanup, data, DEFAULT_PROFILE, generateOnBase, inspectBaseFilter, makeRule, ruleBlocks, snapshot, validateProfile, withPrice } from './helpers.mjs';

const { DEFAULT_EFFECT_ITEMS } = data;

const snapshotRules = JSON.parse(readFileSync('data/default-rules.json', 'utf8')).rules;
const validWith = (...rules) => validateProfile({ ...DEFAULT_PROFILE, rules });

test.after(cleanup);

const text = `Show
  Class == "Stackable Currency"
  SetTextColor 200 200 200 255
  Continue
Show
  BaseType == "Exalted Orb" "Orb of Annulment"
  SetFontSize 35
  CustomAlertSoundOptional "shared # sound.ogg" 85 # comment
  Continue
Show
  BaseType == "Exalted Orb"
  SetFontSize 42
  PlayEffect Red Temp
  MinimapIcon 0 Red Star
Hide
  BaseType == "Chaos Orb"
Show
  BaseType == "Divine Orb"
  PlayAlertSoundPositional 6 100
Show`;

test('inherited effects follow first match, Continue, quoted custom paths and Hide', () => {
  const styles = baseStyles(text);
  const exalted = styles['exalted-orb'];
  assert.equal(exalted.effects.font.fontSize, 42);
  assert.equal(exalted.effects.font.textColor, '200 200 200 255');
  assert.equal(exalted.effects.beam, 'Red Temp');
  assert.equal(exalted.effects.icon, '0 Red Star');
  assert.ok(exalted.actions.includes('\tCustomAlertSoundOptional "shared # sound.ogg" 85'));
  assert.equal(styles['orb-of-annulment'].effects.font.fontSize, 35);
  assert.ok(styles['chaos-orb'].warning);
  assert.ok(styles['divine-orb'].actions.includes('\tPlayAlertSoundPositional 6 100'));
  assert.equal(styles['default-exalted'], undefined);
});

test('unknown conditions that affect the result warn instead of guessing', () => {
  const style = baseStyles(`Show\n BaseType == "Exalted Orb"\n AreaLevel >= 10\n SetFontSize 45\nShow`)['exalted-orb'];
  assert.ok(style.warning);
  assert.deepEqual(style.effects, {});
});

test('four real NeverSink currency styles can be determined', () => {
  const baseline = readFileSync("vendor/neversink/NeverSink's filter 2 - 2-SEMI-STRICT.filter", 'utf8');
  const styles = baseStyles(baseline);
  assert.deepEqual(Object.keys(styles), Object.values(DEFAULT_EFFECT_ITEMS));
  for (const [itemId, style] of Object.entries(styles)) {
    assert.equal(style.warning, undefined, itemId);
    assert.ok(style.effects.font?.fontSize, itemId);
  }
});

test('changing the base updates inherited rules but keeps manual effects', () => {
  const rules = DEFAULT_PROFILE.rules.map((rule) => rule.id === 'default-divine'
    ? { ...rule, baselineEffectItemId: undefined, followBaseline: false, effects: { font: { fontSize: 19 } } }
    : rule);
  const profile = validWith(...rules);
  const generate = baseline => generateOnBase(profile, baseline, snapshot, { baselineName: 'Test.filter' });
  const exalted = rule => blockFor(rule.filterFile, '# poe2-filter rule: default-exalted');
  assert.match(exalted(generate(text)), /SetFontSize 42/);
  assert.match(exalted(generate(text.replace('SetFontSize 42', 'SetFontSize 44'))), /SetFontSize 44/);
  assert.match(blockFor(generate(text).filterFile, '# poe2-filter rule: default-divine'), /SetFontSize 19/);
});

test('presets are deduplicated by effect and include combinations reached through Continue', () => {
  const source = 'shared # sound.ogg';
  const base = inspectBaseFilter(text + `\nShow\n SetFontSize 30\n PlayEffect Green\nShow\n PlayEffect Green\n SetFontSize 30\n`, { [source]: 'audio/shared # sound.ogg' });
  assert.equal(base.presets.filter((preset) => preset.beam === 'Green').length, 1);
  const combined = base.presets.find((preset) => preset.font?.fontSize === 42 && preset.sound);
  assert.deepEqual(combined.sound, { type: 'baseline', fileName: 'audio/shared # sound.ogg', volume: 85, optional: true });
  assert.deepEqual(combined.sourceItemIds, ['exalted-orb']);
  assert.deepEqual(base.styles['divine-orb'].effects.sound, { type: 'builtin', id: 6, volume: 100, positional: true });
  const other = inspectBaseFilter('Show\n SetFontSize 31\n PlayEffect Blue', {});
  assert.equal(other.presets.length, 1);
  assert.equal(other.presets[0].beam, 'Blue');
  assert.equal(other.styles['exalted-orb'].effects.font.fontSize, 31);
});

test('only resolved catalog styles add source candidates to the gallery', () => {
  const baseline = `Show
    Class == "Stackable Currency"
    BaseType == "Regal Orb" "Orb of Alchemy"
    SetFontSize 36
    Continue
  Show
    BaseType == "Regal Orb" "Orb of Alchemy"
    PlayEffect Green
  Show
    BaseType == "Not In Catalog"
    PlayEffect Pink
  Show
    BaseType == "Chaos Orb"
    AreaLevel >= 10
    PlayEffect Red
  Show`;
  const { presets, styles } = inspectBaseFilter(baseline, {});
  const combined = presets.filter((preset) => preset.beam === 'Green' && preset.font?.fontSize === 36);
  assert.equal(combined.length, 1);
  assert.deepEqual(combined[0].sourceItemIds, ['orb-of-alchemy', 'regal-orb']);
  assert.equal(presets.find((preset) => preset.beam === 'Pink').sourceItemIds, undefined);
  assert.equal(presets.find((preset) => preset.beam === 'Red').sourceItemIds, undefined);
  assert.match(styles['chaos-orb'].warning, /Chaos Orb/);
});

test('general catalog probes use known rarity and gem level without assuming gear rarity', () => {
  // 取一件既有普通基底、也有传奇的装备，两种变体都要在。
  const unique = data.FILTER_ITEMS.find((item) => item.id.startsWith('unique:') && item.matcher.baseType
    && data.FILTER_ITEMS_BY_ID.has(item.id.replace('unique:', 'base:')));
  const baseId = unique.id.replace('unique:', 'base:');
  const rawId = unique.id.slice('unique:'.length);
  const styles = baseStyles(`Show
    BaseType == "${unique.matcher.baseType}"
    Rarity Unique
    PlayEffect Yellow
  Show
    BaseType == "${unique.matcher.baseType}"
    Rarity < Unique
    PlayEffect White
  Show
    BaseType == "Uncut Skill Gem"
    GemLevel >= 20
    PlayEffect Blue
  Show`, [rawId, baseId, unique.id, 'uncut-skill-gem-20', 'uncut-skill-gem-19']);
  assert.match(styles[rawId].warning, /无法确定/);
  assert.equal(styles[baseId].effects.beam, 'White');
  assert.equal(styles[unique.id].effects.beam, 'Yellow');
  assert.equal(styles['uncut-skill-gem-20'].effects.beam, 'Blue');
  assert.equal(styles['uncut-skill-gem-19'].warning, undefined);
  assert.deepEqual(styles['uncut-skill-gem-19'].effects, {});
  assert.equal(validWith(makeRule({ baselineEffectItemId: unique.id, target: { itemIds: ['chaos-orb'] } })).rules[0].baselineEffectItemId, unique.id);
});

test('an explicit reference supplies full current actions and sound to a different target', () => {
  const audio = { 'child/tone.ogg': 'child/tone.ogg', 'second.ogg': 'second.ogg' };
  const baseline = `Show
    Class == "Stackable Currency"
    BaseType == "Regal Orb"
    SetFontSize 36
    PlayEffect None
    MinimapIcon -1
    DisableDropSound
    PlayAlertSoundPositional 3 70
    Continue
  Show
    BaseType == "Regal Orb"
    CustomAlertSoundOptional "child/tone.ogg;second.ogg" 85
    EnableDropSoundIfAlertSound
  Show`;
  const copy = makeRule({
    id: 'rule-copy', baselineEffectItemId: 'regal-orb', effectPresetId: 'base-5',
    target: { itemIds: ['chaos-orb'] }, effects: { beam: 'Red' },
  });
  const profile = validWith(copy);
  assert.equal(profile.rules[0].baselineEffectItemId, 'regal-orb');
  assert.equal(profile.rules[0].effectPresetId, undefined);
  assert.deepEqual(profile.rules[0].effects, {});
  const inspected = inspectBaseFilter(baseline, audio).styles['regal-orb'];
  assert.deepEqual(inspected.effects.sound, {
    type: 'baseline', fileName: 'child/tone.ogg;second.ogg', volume: 85, optional: true,
    fallback: { type: 'builtin', id: 3, volume: 70, positional: true },
  });
  const generate = (base) => generateOnBase(profile, base, snapshot, { distinguishCustom: true });
  const output = generate(baseline);
  const [block] = ruleBlocks(output.filterFile);
  assert.match(block, /rule-copy \/ Chaos Orb\n\tBaseType == "Chaos Orb"/);
  assert.deepEqual(block.split('\n').slice(2), inspected.actions);
  assert.deepEqual(inspected.actions, [
    '\tSetFontSize 36', '\tPlayEffect None', '\tMinimapIcon -1', '\tDisableDropSound', '\tPlayAlertSoundPositional 3 70',
    '\tCustomAlertSoundOptional "child/tone.ogg;second.ogg" 85', '\tEnableDropSoundIfAlertSound',
  ]);
  assert.deepEqual(output.soundFiles, ['child/tone.ogg;second.ogg']);
  assert.match(ruleBlocks(generate(baseline.replace('SetFontSize 36', 'SetFontSize 37')).filterFile)[0], /SetFontSize 37/);
  for (const [base, warning] of [['Hide\n BaseType == "Regal Orb"\nShow', /Regal Orb/], [null, /规则使用游戏默认样式/]]) {
    const result = generate(base);
    assert(result.safetyReport.warnings.some((value) => warning.test(value)));
    assert.equal(ruleBlocks(result.filterFile)[0].split('\n').length, 2);
    assert.deepEqual(result.soundFiles, []);
  }
});

test('follow flags and matching effect snapshots resolve to item references', () => {
  // JSON object order can change when saved by the desktop store.
  const reverseKeys = (value) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).reverse().map(([key, entry]) => [key, reverseKeys(entry)])) : value;
  const snapshots = snapshotRules.map((rule) => ({
    ...rule, name: `Edited ${rule.id}`, target: { ...rule.target, itemIds: ['regal-orb'] }, effects: reverseKeys(rule.effects),
  }));
  const migrated = validWith(...snapshots).rules;
  for (const [i, rule] of migrated.entries()) {
    assert.equal(rule.baselineEffectItemId, DEFAULT_EFFECT_ITEMS[rule.id]);
    assert.equal(rule.followBaseline, undefined);
    assert.equal(rule.effectPresetId, undefined);
    assert.deepEqual(rule.effects, {});
    assert.equal(rule.name, snapshots[i].name);
    assert.deepEqual(rule.target.range, snapshots[i].target.range);
    assert.deepEqual(rule.target.itemIds, snapshots[i].target.itemIds);
  }
  assert.deepEqual(validWith(...migrated).rules, migrated);
  const [explicit] = validWith({ ...snapshotRules[0], followBaseline: true, effects: { beam: 'Green' } }).rules;
  assert.equal(explicit.baselineEffectItemId, DEFAULT_EFFECT_ITEMS[explicit.id]);
  assert.equal(explicit.effectPresetId, undefined);
  assert.deepEqual(explicit.effects, {});
});

test('edited and unrelated snapshots remain fixed, including a matching snapshot marked false', () => {
  const [old] = snapshotRules;
  for (const candidate of [
    { ...old, effectPresetId: 'look-default-0' },
    { ...old, effectPresetId: undefined },
    { ...old, id: 'rule-copied-default' },
    { ...old, effects: { ...old.effects, font: { ...old.effects.font, fontSize: 41 } } },
    { ...old, effects: { ...old.effects, sound: { ...old.effects.sound, positional: false } } },
    { ...old, followBaseline: false },
  ]) {
    const [result] = validWith(candidate).rules;
    assert.equal(result.baselineEffectItemId, undefined);
    assert.equal(result.effectPresetId, candidate.effectPresetId);
    assert.equal(result.followBaseline, candidate.followBaseline);
    assert.deepEqual(result.effects, candidate.effects);
    assert.deepEqual(validWith(result).rules, [result]);
  }
});

test('profile validation accepts a wire reference without an effect snapshot and rejects invalid sources', () => {
  const rule = makeRule({ target: { itemIds: ['chaos-orb'] } });
  const [anchored] = validWith({ ...rule, effects: undefined, baselineEffectItemId: 'regal-orb' }).rules;
  assert.equal(anchored.baselineEffectItemId, 'regal-orb');
  assert.deepEqual(anchored.effects, {});
  for (const source of ['not-a-catalog-id', 'class-life-flasks', 'base:class-amulets', null, 42]) {
    assert.throws(() => validWith({ ...rule, baselineEffectItemId: source }), /无效的基础特效参考物品/);
  }
  assert.throws(() => validWith({ ...rule, followBaseline: true }), /无效的基础特效跟随设置/);
});

test('new price tiers cover currency, gameplay, runes and essences, skipping equipment', () => {
  // 整类条目没有行情，不在默认价格档的物品范围里。
  const pricedRoots = ['currency', 'gameplay', 'runes', 'essences'];
  const priced = data.ITEM_CATALOG.filter((item) => pricedRoots.includes(item.categoryPath[0]) && !item.matcher.class);
  const equipment = data.ITEM_CATALOG.find((item) => item.categoryPath[0] === 'equipment' && item.categoryPath[1] === 'one-hand' && item.priceable && !item.ambiguous);
  for (const rule of DEFAULT_PROFILE.rules) {
    assert.deepEqual(rule.target.itemIds, priced.map((item) => item.id));
    assert.equal(rule.target.itemEnabled, true);
    assert.equal(rule.baselineEffectItemId, DEFAULT_EFFECT_ITEMS[rule.id]);
    assert.equal(rule.followBaseline, undefined);
    assert.deepEqual(rule.effects, {});
  }
  const market = withPrice(snapshot, equipment.id, 10);
  const output = generateOnBase(DEFAULT_PROFILE, null, market);
  assert.equal(ruleBlocks(output.filterFile).length, 4);
  assert.ok(!output.filterFile.includes(equipment.name));
});

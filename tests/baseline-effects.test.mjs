import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { baseStyles, blockFor, cleanup, data, DEFAULT_PROFILE, generateOnBase, inspectBaseFilter, ruleBlocks, snapshot, withPrice } from './helpers.mjs';

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
  const exalted = styles['default-exalted'];
  assert.equal(exalted.effects.font.fontSize, 42);
  assert.equal(exalted.effects.font.textColor, '200 200 200 255');
  assert.equal(exalted.effects.beam, 'Red Temp');
  assert.equal(exalted.effects.icon, '0 Red Star');
  assert.ok(exalted.actions.includes('\tCustomAlertSoundOptional "shared # sound.ogg" 85'));
  assert.equal(styles['default-annulment'].effects.font.fontSize, 35);
  assert.ok(styles['default-chaos'].warning);
  assert.ok(styles['default-divine'].actions.includes('\tPlayAlertSoundPositional 6 100'));
});

test('unknown conditions that affect the result warn instead of guessing', () => {
  const style = baseStyles(`Show\n BaseType == "Exalted Orb"\n AreaLevel >= 10\n SetFontSize 45\nShow`)['default-exalted'];
  assert.ok(style.warning);
  assert.deepEqual(style.effects, {});
});

test('four real NeverSink currency styles can be determined', () => {
  const baseline = readFileSync("vendor/neversink/NeverSink's filter 2 - 2-SEMI-STRICT.filter", 'utf8');
  const styles = baseStyles(baseline);
  for (const [rule, style] of Object.entries(styles)) {
    assert.equal(style.warning, undefined, rule);
    assert.ok(style.effects.font?.fontSize, rule);
  }
});

test('changing the base updates inherited rules but keeps manual effects', () => {
  const profile = { ...DEFAULT_PROFILE, rules: DEFAULT_PROFILE.rules.map(rule => ({ ...rule, followBaseline: rule.id !== 'default-divine', effects: { font: { fontSize: 19 } } })) };
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
  assert.deepEqual(base.presets.find((preset) => preset.font?.fontSize === 42 && preset.sound)?.sound,
    { type: 'baseline', fileName: 'audio/shared # sound.ogg', volume: 85, optional: true });
  assert.deepEqual(base.styles['default-divine'].effects.sound, { type: 'builtin', id: 6, volume: 100, positional: true });
  const other = inspectBaseFilter('Show\n SetFontSize 31\n PlayEffect Blue', {});
  assert.equal(other.presets.length, 1);
  assert.equal(other.presets[0].beam, 'Blue');
  assert.equal(other.styles['default-exalted'].effects.font.fontSize, 31);
});

test('new price tiers cover all crafting items, skipping equipment and unquoted crafting items', () => {
  const crafting = data.ITEM_CATALOG.filter((item) => item.categoryPath[0] === 'crafting');
  const equipment = data.ITEM_CATALOG.find((item) => item.categoryPath[0] === 'equipment' && item.priceable && !item.ambiguous);
  for (const rule of DEFAULT_PROFILE.rules) {
    assert.deepEqual(rule.target.itemIds, crafting.map((item) => item.id));
    assert.equal(rule.target.itemEnabled, true);
    assert.equal(rule.followBaseline, true);
    assert.deepEqual(rule.effects, {});
  }
  const market = withPrice(snapshot, equipment.id, 10);
  const output = generateOnBase(DEFAULT_PROFILE, null, market);
  assert.equal(ruleBlocks(output.filterFile).length, 4);
  assert.ok(!output.filterFile.includes(equipment.name));
});

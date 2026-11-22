import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { baseStyles, blockFor, cleanup, DEFAULT_PROFILE, generateOnBase, snapshot } from './helpers.mjs';

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

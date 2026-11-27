import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blocks, cleanup, data, DEFAULT_PROFILE, generateOnBase, hiddenByOverlays, itemByName, makeRule, normalizeProfile, overlays, snapshot, validateProfile } from './helpers.mjs';

const { applyOverlays, blockKey, conditionLineIssue, inspectBaseRules, resolveOverlays } = overlays;
const { parseFilterBlocks } = blocks;

test.after(cleanup);

const BASE = [
  '# My Filter',
  '# [[0100]] Currency',
  '# ====',
  '',
  'Show # $type->currency $tier->t1',
  '\tBaseType == "Divine Orb" "Exalted Orb"',
  '\tStackSize >= 5',
  '\tSetFontSize 45',
  '\tSetTextColor 255 255 255',
  '\tPlayEffect Blue',
  '\tContinue',
  '',
  'Show # tail comment inside block',
  '\tBaseType == "Gold"',
  '\t# a comment line inside',
  '\tSetFontSize 30',
  '# trailing comment of the block',
  '',
  'Hide',
  '\tBaseType == "Chaos Orb"',
  '\tDisableDropSound',
  '',
  'Show',
  '\tSetFontSize 32',
].join('\n');
const NAME = 'My.filter';
const T1 = ['BaseType == "Divine Orb" "Exalted Orb"', 'StackSize >= 5'];
const edit = (overrides = {}) => ({ id: 'edit-1', baseName: NAME, conditions: T1, enabled: true, effects: {}, ...overrides });
const patch = (text, entries) => applyOverlays(parseFilterBlocks(text), new Map(entries));
const cn = (name) => itemByName(name).localeNames.cn;

test('规则按 Show / Hide 切开，带着分节、块头注释和规范化后的条件', () => {
  const parsed = parseFilterBlocks(BASE);
  const [divine, gold, chaos, rest] = parsed.blocks;
  assert.equal(parsed.blocks.length, 4);
  assert.equal(divine.start, 4);
  assert.equal(divine.end, 10);
  assert.equal(divine.section, 'Currency');
  assert.equal(divine.comment, '$type->currency $tier->t1');
  assert.deepEqual(divine.conditions, T1);
  assert.deepEqual(divine.actions.map(({ command, value }) => [command, value]), [['SetFontSize', '45'], ['SetTextColor', '255 255 255'], ['PlayEffect', 'Blue']]);
  assert.equal(divine.continue, true);
  // 没有新的分节注释时沿用上一节的。
  assert.equal(gold.section, 'Currency');
  assert.equal(gold.end, 15);
  assert.equal(chaos.show, false);
  assert.deepEqual(rest.conditions, []);
  assert.deepEqual(rest.actions.map(({ key }) => key), ['fontSize']);
  const messy = parseFilterBlocks(['#   [2401] Generic Decorators', '#', '# !! Waypoint c0.start : "Gold"', '#================================================================', '\uFEFFShow', '\tBaseType=="Gold"   # piles', '\tAreaLevel\t<= 24', '\t# note', '\tSetFontSize 40', ''].join('\r\n'));
  assert.equal(messy.blocks[0].section, 'Generic Decorators');
  assert.equal(messy.blocks[0].start, 4);
  assert.deepEqual(messy.blocks[0].conditions, ['BaseType== "Gold"', 'AreaLevel <= 24']);
  assert.equal(messy.blocks[0].end, 8);
  assert.equal(messy.crlf, true);
});

test('修改按基础过滤器名和原有条件找到对应的规则', () => {
  const parsed = parseFilterBlocks(BASE);
  const twins = ['Show', '\tBaseType == "Gold"', 'Show', '\tbaseType == "gold"', 'Show', '\tBaseType == "Gold"', '\tRarity Unique'].join('\n');
  const gold = ['BaseType == "Gold"'];
  assert.deepEqual(resolveOverlays([edit({ conditions: gold })], NAME, parseFilterBlocks(twins).blocks).get('edit-1'), { state: 'ok', blocks: [0, 1] });
  assert.equal(resolveOverlays([edit()], undefined, parsed.blocks).get('edit-1').reason, 'noBase');
  assert.equal(resolveOverlays([edit()], 'Other.filter', parsed.blocks).get('edit-1').reason, 'baseChanged');
  assert.equal(resolveOverlays([edit({ conditions: ['BaseType == "Regal Orb"'] })], NAME, parsed.blocks).get('edit-1').reason, 'ruleChanged');
  // 改过的条件不参与匹配；换回原来的基础过滤器后恢复。
  const retargeted = edit({ conditionLines: ['BaseType == "Chaos Orb"'] });
  assert.equal(resolveOverlays([retargeted], NAME, parsed.blocks).get('edit-1').state, 'ok');
  assert.equal(resolveOverlays([retargeted], 'Other.filter', parsed.blocks).get('edit-1').state, 'invalid');
  assert.equal(blockKey(['A == "B"']), 'a == "b"');
});

test('修改原地替换：换显示或隐藏、替换改过的动作，其余的行和换行风格不变', () => {
  const lines = BASE.split('\n');
  const out = patch(BASE, [[0, edit({ hidden: true, effects: { beam: 'Red Temp', icon: '1 Red Star', font: { fontSize: 40, textColor: '0 0 0' } } })]]);
  assert.ok(out.startsWith(lines.slice(0, 4).join('\n') + '\n'));
  assert.ok(out.endsWith(lines.slice(11).join('\n')));
  assert.deepEqual(out.split('\n').slice(4, 12), [
    'Hide # $type->currency $tier->t1',
    '\tBaseType == "Divine Orb" "Exalted Orb"',
    '\tStackSize >= 5',
    '\tSetFontSize 40',
    '\tSetTextColor 0 0 0',
    '\tPlayEffect Red Temp',
    '\tContinue',
    // 原规则没有的动作加在块尾。
    '\tMinimapIcon 1 Red Star',
  ]);
  // 原规则没有的动作加在块尾；换成显示时块头的注释还在。
  const shown = patch(BASE, [[2, edit({ conditions: ['BaseType == "Chaos Orb"'], hidden: false, effects: { sound: { type: 'custom', fileName: 'mine.mp3' } } })]]);
  assert.deepEqual(shown.split('\n').slice(18, 22), ['Show', '\tBaseType == "Chaos Orb"', '\tDisableDropSound', '\tCustomAlertSound "@poe2rf-custom/mine.mp3" 300']);
  // 只写改过的项；去掉光柱写成 None。
  const none = patch(BASE, [[0, edit({ effects: { beam: 'None', font: { borderColor: '255 0 0' } } })]]);
  assert.deepEqual(none.split('\n').slice(4, 12), [
    'Show # $type->currency $tier->t1', ...T1.map((line) => '\t' + line),
    '\tSetFontSize 45', '\tSetTextColor 255 255 255', '\tPlayEffect None', '\tContinue', '\tSetBorderColor 255 0 0',
  ]);
  // 换音效：原来两条音效指令一起换掉，备用音效写成两行。
  const sound = patch('Show\n\tBaseType == "Gold"\n\tPlayAlertSound 5 200\n\tCustomAlertSound "a.mp3"\n\tSetFontSize 30', [[0, edit({ conditions: ['BaseType == "Gold"'], effects: { sound: { type: 'builtin', id: 2, volume: 150, positional: true } } })]]);
  assert.equal(sound, 'Show\n\tBaseType == "Gold"\n\tPlayAlertSoundPositional 2 150\n\tSetFontSize 30');
  // 块内和块尾的注释原样留着。
  assert.deepEqual(patch(BASE, [[1, edit({ conditions: ['BaseType == "Gold"'], effects: { beam: 'Green' } })]]).split('\n').slice(12, 18), [
    'Show # tail comment inside block', '\tBaseType == "Gold"', '\t# a comment line inside', '\tSetFontSize 30', '\tPlayEffect Green', '# trailing comment of the block',
  ]);
});

test('改过的条件整组替换原有的条件', () => {
  const edited = patch(BASE, [[0, edit({ conditionLines: ['BaseType == "Exalted Orb"', 'StackSize >= 10', 'AreaLevel >= 66'] })]]);
  assert.deepEqual(edited.split('\n').slice(4, 11), [
    'Show # $type->currency $tier->t1', '\tBaseType == "Exalted Orb"', '\tStackSize >= 10', '\tAreaLevel >= 66',
    '\tSetFontSize 45', '\tSetTextColor 255 255 255', '\tPlayEffect Blue',
  ]);
  assert.ok(edited.includes('\tContinue\n\nShow # tail comment inside block'));
  // 原规则没有条件时接在块头后面；文件最后一行没有换行符，后面接了内容才补上。
  const added = patch(BASE, [[3, edit({ conditions: [], conditionLines: ['BaseType == "Gold"'] })]]);
  assert.ok(added.endsWith('Show\n\tBaseType == "Gold"\n\tSetFontSize 32'));
  const appended = patch(BASE, [[3, edit({ conditions: [], effects: { beam: 'Green' } })]]);
  assert.ok(appended.endsWith('\tSetFontSize 32\n\tPlayEffect Green'));
  assert.equal(appended.split('\n').length, BASE.split('\n').length + 1);
  // 去掉全部条件后这条规则匹配所有物品。
  assert.ok(patch(BASE, [[3, edit({ conditions: [], conditionLines: [] })]]).endsWith('Show\n\tSetFontSize 32'));
});

test('保留原文件的换行风格，多条规则一起改', () => {
  const entries = [[0, edit({ hidden: true, effects: { beam: 'Red' } })], [2, edit({ conditions: ['BaseType == "Chaos Orb"'], effects: { sound: { type: 'builtin', id: 1, volume: 100 } } })]];
  const lf = patch(BASE, entries);
  const crlf = patch(BASE.replace(/\n/g, '\r\n'), entries);
  assert.equal(crlf, lf.replace(/\n/g, '\r\n'));
  assert.equal(patch('\uFEFFShow\n\tBaseType == "Gold"', [[0, edit({ conditions: ['BaseType == "Gold"'], hidden: true })]]), '\uFEFFHide\n\tBaseType == "Gold"');
});

test('改过的条件行只查语法', () => {
  for (const line of ['StackSize >= 10', 'BaseType == "Exalted Orb" "Chaos Orb"', 'Rarity Normal Magic', 'Identified True', 'AreaLevel<=67', 'Sockets = 0', 'ItemLevel >= 67']) {
    assert.equal(conditionLineIssue(line), undefined, line);
  }
  for (const [line, pattern] of [
    ['', /不能为空/], ['123 >= 4', /条件名/], ['SetFontSize 45', /显示动作/], ['Hide', /显示动作/], ['Continue', /显示动作/],
    ['StackSize', /要有值/], ['BaseType ==', /要有值/], ['StackSize >= 10 # big', /注释/], ['BaseType == "Exalted Orb', /引号要成对/],
    ['BaseType == ""', /引号里/], ['x'.repeat(301), /最多/], ['StackSize >=\t10\n', /换行/],
  ]) {
    assert.match(conditionLineIssue(line) ?? '', pattern, JSON.stringify(line));
  }
});

test('基础规则表描述基础过滤器本身，并给出每处修改的状态', () => {
  const gold = ['BaseType == "Gold"'];
  const result = inspectBaseRules(BASE, {}, NAME, [
    edit({ hidden: true, effects: { font: { fontSize: 40 } } }),
    edit({ id: 'edit-2', baseName: 'Other.filter', conditions: gold }),
    edit({ id: 'edit-3', conditions: gold, enabled: false, effects: { beam: 'Red' } }),
    edit({ id: 'edit-4', conditions: gold, conditionLines: ['BaseType == "Gold"', 'AreaLevel >= 66'] }),
  ]);
  const [divine, pile] = result.rules;
  assert.equal(divine.label, `${cn('Divine Orb')}、${cn('Exalted Orb')}`);
  assert.equal(divine.detail, 'StackSize >= 5');
  assert.equal(divine.section, 'Currency');
  // 规则说的都是基础过滤器里的样子；生效的显示由使用方把修改叠上去算。
  assert.equal(divine.hidden, false);
  assert.deepEqual(divine.conditions, T1);
  assert.deepEqual(divine.effects, { beam: 'Blue', font: { fontSize: 45, textColor: '255 255 255' } });
  assert.deepEqual(pile.effects, { font: { fontSize: 30 } });
  const { mergeEffects } = overlays;
  assert.deepEqual(mergeEffects(divine.effects, { font: { fontSize: 40 }, sound: { type: 'builtin', id: 2, volume: 300 } }), {
    beam: 'Blue', font: { fontSize: 40, textColor: '255 255 255' }, sound: { type: 'builtin', id: 2, volume: 300 },
  });
  assert.deepEqual(mergeEffects({ beam: 'Blue', font: { fontSize: 45 } }, { beam: 'None', font: {} }), { beam: 'None', font: { fontSize: 45 } });
  assert.deepEqual(mergeEffects({}, { icon: '0 Red Star' }), { icon: '0 Red Star' });
  // 同一条规则上的多处修改都指向它；换了基础过滤器的那处失效。
  assert.deepEqual(result.overlays['edit-2'], { state: 'invalid', reason: '它是对基础过滤器「Other.filter」做的，当前是「My.filter」。' });
  assert.deepEqual(result.overlays['edit-1'], { state: 'ok', blocks: [0] });
  assert.deepEqual(result.overlays['edit-3'], { state: 'ok', blocks: [1] });
  assert.deepEqual(result.overlays['edit-4'], { state: 'ok', blocks: [1] });
  assert.deepEqual(result.conditionNames, ['basetype', 'stacksize']);
  // 类名和块头注释兜底。
  const plain = inspectBaseRules(['Show', '\tClass == "Stackable Currency"', 'Show # anything left', '\tItemLevel >= 5', 'Show'].join('\n'), {}, NAME, []);
  assert.deepEqual(plain.rules.map((rule) => rule.label), ['Stackable Currency', 'anything left', '第 3 条规则']);
  assert.deepEqual(plain.overlays, {});
});

test('生成时把生效的修改写进基础过滤器，失效和关闭的不写', () => {
  const base = { kind: 'local', path: 'C:/filters/My.filter', name: NAME };
  const plan = (overlays, editsEnabled = true) => validateProfile({ ...DEFAULT_PROFILE, rules: [], baseFilter: base, overlays, editsEnabled });
  const on = (profile) => generateOnBase(profile, BASE, snapshot);
  const result = on(plan([edit({ hidden: true, effects: { beam: 'Red' } })]));
  assert.equal(result.safetyReport.passed, true);
  assert.ok(result.filterFile.endsWith(result.baseText));
  assert.match(result.baseText, /^Hide # \$type->currency \$tier->t1/m);
  assert.match(result.filterFile, /^# Base rule edits: 1 applied$/m);
  const invalid = on(plan([
    edit({ baseName: 'Other.filter' }),
    edit({ id: 'edit-2', conditions: ['BaseType == "Regal Orb"'] }),
    edit({ id: 'edit-3', conditions: ['BaseType == "Gold"'], enabled: false }),
  ]));
  assert.equal(invalid.baseText, BASE);
  assert.match(invalid.filterFile, /^# Base rule edits: 0 applied, 1 disabled, 2 invalid$/m);
  assert.deepEqual(invalid.safetyReport.warnings.filter((warning) => /修改不生效/.test(warning)), [
    '1 处对基础规则的修改不生效：它是对基础过滤器「Other.filter」做的，当前是「My.filter」。',
    '1 处对基础规则的修改不生效：基础过滤器「My.filter」里找不到条件相同的规则，它可能已经改动或删除。',
  ]);
  // 没有修改的方案，正文和以前一样。
  assert.equal(on(plan([])).baseText, BASE);
  assert.ok(!on(plan([])).filterFile.includes('Base rule edits'));
  // 总开关关闭时全部修改按关闭处理，失效的也不再提示；每处修改自己的启用状态保留着。
  const switchedOff = on(plan([edit({ hidden: true }), edit({ id: 'edit-2', baseName: 'Other.filter', conditions: ['BaseType == "Gold"'] })], false));
  assert.equal(switchedOff.baseText, BASE);
  assert.match(switchedOff.filterFile, /^# Base rule edits: 0 applied, 2 disabled$/m);
  assert.ok(!switchedOff.safetyReport.warnings.some((warning) => /修改不生效/.test(warning)));
  assert.deepEqual(plan([edit()], false).overlays, [edit()]);
  // 没有基础过滤器时修改全部不生效，方案照常生成。
  const standalone = generateOnBase({ ...plan([edit()]), baseFilter: undefined }, null, snapshot);
  assert.equal(standalone.baseText, '');
  assert.ok(standalone.safetyReport.warnings.join('\n').includes('方案没有选择基础过滤器'));
  assert.ok(standalone.filterFile.endsWith('\nShow\n'));
});

test('改成隐藏的规则会命中高价值物品时，安全检查不通过', () => {
  const base = { kind: 'local', path: 'C:/filters/My.filter', name: NAME };
  const text = ['Hide', '\tBaseType == "Gold"', 'Show', '\tBaseType == "Divine Orb"', '\tSetFontSize 45', ''].join('\n');
  const generate = (overlays) => generateOnBase(validateProfile({ ...DEFAULT_PROFILE, rules: [], baseFilter: base, overlays }), text, snapshot);
  const hide = generate([edit({ conditions: ['BaseType == "Divine Orb"'], hidden: true })]);
  assert.deepEqual(hide.safetyReport.hiddenHighValueItems, ['Divine Orb']);
  assert.equal(hide.safetyReport.passed, false);
  // 原本就隐藏的规则、改条件前命中不到高价值物品的规则、仍然显示的规则都不算。
  assert.equal(generate([edit({ conditions: ['BaseType == "Gold"'] })]).safetyReport.passed, true);
  const retargeted = generate([edit({ conditions: ['BaseType == "Gold"'], conditionLines: ['BaseType == "Divine Orb"'] })]);
  assert.deepEqual(retargeted.safetyReport.hiddenHighValueItems, ['Divine Orb']);
  assert.equal(generate([edit({ conditions: ['BaseType == "Divine Orb"'], effects: { beam: 'Red' } })]).safetyReport.passed, true);
  assert.deepEqual(hiddenByOverlays(text, new Set([1]), ['divine-orb']), []);
});

test('读取和校验', () => {
  assert.deepEqual(normalizeProfile({ ...DEFAULT_PROFILE, overlays: undefined }).overlays, []);
  const valid = { ...DEFAULT_PROFILE, rules: [], overlays: [edit()] };
  assert.equal(normalizeProfile({ ...DEFAULT_PROFILE, editsEnabled: undefined }).editsEnabled, true);
  assert.equal(validateProfile(valid).editsEnabled, true);
  assert.equal(validateProfile({ ...valid, editsEnabled: false }).editsEnabled, false);
  assert.throws(() => validateProfile({ ...valid, editsEnabled: 'no' }), /基础规则修改设置/);
  assert.equal(validateProfile(valid).schemaVersion, 3);
  assert.equal(validateProfile({ ...valid, overlays: [] }).schemaVersion, 2);
  const broken = (overlays, pattern) => assert.throws(() => validateProfile({ ...valid, overlays }), pattern);
  broken([edit({ id: 'bad id' })], /无效修改/);
  broken([edit(), edit({ id: 'edit-2' })], /同一条基础规则只能有一处修改/);
  broken([edit({ baseName: '' })], /修改来源/);
  broken([edit({ conditions: [] })], /规则条件无效/);
  broken([edit({ conditions: ['ItemLevel >= 1\n'] })], /规则条件无效/);
  broken([edit({ hidden: 'yes' })], /无效修改/);
  broken([edit({ conditionLines: ['SetFontSize 45'] })], /修改的条件无效：.*显示动作/);
  broken([edit({ conditionLines: ['StackSize >='] })], /修改的条件无效：.*要有值/);
  broken([edit({ effects: { beam: 'Sparkle' } })], /无效光柱/);
  broken([edit({ effects: { font: { fontSize: 99 } } })], /字体范围/);
  broken([edit({ effects: { sound: { type: 'custom', fileName: 'bad name.mp3' } } })], /无效音效/);
  assert.deepEqual(validateProfile({ ...valid, overlays: [edit({ effects: { beam: 'None' } })] }).overlays[0].effects, { beam: 'None' });
  assert.throws(() => validateProfile({ ...DEFAULT_PROFILE, rules: [makeRule({ effects: { beam: 'None' }, target: { itemIds: ['chaos-orb'] } })] }), /无效光柱/);
  // 修改的 ID 和规则共用一个空间。
  assert.throws(() => validateProfile({ ...valid, rules: [makeRule({ id: 'edit-1', target: { itemIds: ['chaos-orb'] } })] }), /无效修改/);
  assert.throws(() => validateProfile({ ...valid, overlays: Array.from({ length: 501 }, (_, index) => edit({ id: `e${index}`, conditions: [`ItemLevel >= ${index}`] })) }), /修改过多/);
  assert.deepEqual(normalizeProfile(validateProfile(valid)).overlays, [edit()]);
});

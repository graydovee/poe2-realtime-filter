/**
 * 浏览器预览用的数据垫片。
 * 只在开发构建且地址带 ?mock=1 时接入（见 lib/desktop.ts）：界面逻辑走真实的 lib/，
 * Tauri 命令返回内存里的演示数据。生产构建不会包含这个文件。
 */
import effectData from "../../data/neversink-effects.json";
import type { BaseInspection } from "../../lib/baseline-effects";
import type { Library } from "../../lib/desktop";
import { DEFAULT_RULES } from "../../lib/data";
import { pickEffects } from "../../lib/effect-labels";
import { generateFilter } from "../../lib/filter-engine";
import type {
  BaseFilter,
  Currency,
  EffectPreset,
  FilterProfile,
  FilterRule,
  GameServer,
  LeagueCatalog,
  MarketSnapshot,
} from "../../lib/types";

type Args = Record<string, unknown>;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const LEAGUE: LeagueCatalog = {
  leagues: [
    { id: "Forbidden Rites", label: "Forbidden Rites", hardcore: false, permanent: false },
    { id: "Hardcore Forbidden Rites", label: "Hardcore Forbidden Rites", hardcore: true, permanent: false },
    { id: "Runes of Aldur", label: "Runes of Aldur", hardcore: false, permanent: false },
    { id: "Hardcore Runes of Aldur", label: "Hardcore Runes of Aldur", hardcore: true, permanent: false },
    { id: "Standard", label: "Standard", hardcore: false, permanent: true },
    { id: "Hardcore", label: "Hardcore", hardcore: true, permanent: true },
  ],
  defaultLeague: "Forbidden Rites",
  capturedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
};

const BASE: BaseFilter = {
  kind: "downloaded",
  source: "neversink",
  version: "2.3.1",
  entry: "NeverSink's filter 2 - 2-SEMI-STRICT.filter",
  name: "NeverSink's filter 2 - 2-SEMI-STRICT",
};

/** 从游戏目录里选出来的本地文件：名字就是文件名，路径很长，用来检查界面会不会被长路径撑坏。 */
const LOCAL_BASE: BaseFilter = {
  kind: "local",
  path: "C:\\Users\\grayd\\Documents\\My Games\\Path of Exile 2\\NeverSink's filter 2 - 6-UBER-PLUS-STRICT.filter",
  name: "NeverSink's filter 2 - 6-UBER-PLUS-STRICT.filter",
};

/**
 * 上面那份本地文件的缩影：一份过期的 NeverSink。游戏在 2025 年 12 月把物品类别 Socketable 改名成了 Augment，
 * 0.8.3 还在用旧名字，游戏会拒绝加载。选了它的方案，预览里就能看到「基础过滤器与当前游戏版本不兼容」。
 */
const STALE_BASE_TEXT = [
  "# NeverSink's Indepth Loot Filter - for Path of Exile 2 (fixture)",
  "# VERSION:  0.8.3",
  "",
  "Show # $type->currency $tier->high",
  "\tClass == \"Stackable Currency\"",
  "\tBaseType == \"Divine Orb\" \"Exalted Orb\"",
  "\tSetFontSize 45",
  "",
  "Show # $type->sockets->general $tier->s",
  "\tClass == \"Socketable\"",
  "\tBaseType == \"Amanamu's Gaze\"",
  "\tSetFontSize 45",
  "",
  "Show",
  "\tSetFontSize 32",
  "",
].join("\n");

const BASES: BaseFilter[] = [
  BASE,
  {
    kind: "downloaded",
    source: "neversink",
    version: "2.3.1",
    entry: "NeverSink's filter 2 - 1-REGULAR.filter",
    name: "NeverSink's filter 2 - 1-REGULAR",
  },
  {
    kind: "subscribed",
    source: "online",
    directory: "C:\\Users\\grayd\\Documents\\My Games\\Path of Exile 2",
    entry: "Subscribed/Neversink.filter",
    name: "订阅的过滤器",
  },
];

/** 行情照着 2026-11 的 poe.ninja 抄的（单位 E）：未切割宝石只有部分等级有报价，而且各等级价格互不相干。 */
const PRICES: Array<[itemId: string, exalted: number]> = [
  ["exalted-orb", 1],
  ["chaos-orb", 33.55],
  ["orb-of-annulment", 107.4],
  ["divine-orb", 450.2],
  ["regal-orb", 2.414],
  ["vaal-orb", 7.827],
  ["uncut-skill-gem-1", 745.1],
  ["uncut-skill-gem-10", 346.3],
  ["uncut-skill-gem-18", 15.01],
  ["uncut-skill-gem-19", 16.85],
  ["uncut-skill-gem-20", 3764],
  ["uncut-spirit-gem-10", 105.9],
  ["uncut-spirit-gem-20", 4962],
  ["uncut-support-gem-1", 3.063],
  ["uncut-support-gem-5", 23.97],
];

function market(league: string, server: GameServer = "international"): MarketSnapshot {
  const capturedAt = new Date(Date.now() - 2 * 60_000).toISOString();
  const source = server === "tencent" ? "poecurrency.top" : "poe.ninja";
  // 腾讯服的行情源没有宝石报价。
  const prices = Object.fromEntries(
    PRICES.filter(([itemId]) => server !== "tencent" || !itemId.startsWith("uncut-")).map(([itemId, amount]) => [
      itemId,
      { itemId, amount, currency: "exalted" as Currency, confidence: 0.9, capturedAt, source },
    ]),
  );
  return {
    server,
    league,
    capturedAt,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    source: `${source} PoE2 exchange`,
    rates: { divineToChaos: 13.42, divineToExalted: 450.2, capturedAt, source: `${source} currency stats` },
    prices,
  };
}

const CUSTOM_RULES: FilterRule[] = [
  {
    id: "rule-demo-gems",
    name: "满级未切割宝石",
    enabled: true,
    hidden: false,
    target: { itemIds: ["uncut-skill-gem-20", "uncut-spirit-gem-20"], itemEnabled: true, priceEnabled: false },
    effects: {
      beam: "Green",
      icon: "1 Green Star",
      font: { fontSize: 45, textColor: "180 255 200 255", borderColor: "0 80 40 255" },
      sound: { type: "builtin", id: 9, volume: 300 },
    },
  },
  {
    id: "rule-demo-maps",
    name: "高价值地图与远征日志",
    enabled: true,
    hidden: false,
    target: { itemIds: ["class-waystones", "class-expedition-logbook"], itemEnabled: true, priceEnabled: false },
    effects: {
      beam: "Blue",
      icon: "1 Blue Circle",
      font: { fontSize: 42, textColor: "200 200 255 255" },
      sound: { type: "builtin", id: 6, volume: 300 },
    },
  },
  {
    id: "rule-demo-splinters",
    name: "隐藏低价值裂片",
    enabled: true,
    hidden: true,
    target: { itemIds: ["breach-splinter", "animus-splinters"], itemEnabled: true, priceEnabled: false },
    effects: {},
  },
];

function profile(league: string, base?: BaseFilter, extra: Partial<FilterProfile> = {}): FilterProfile {
  return {
    schemaVersion: 3,
    league,
    strictness: 2,
    style: "default",
    locale: "cn",
    rules: [...clone(DEFAULT_RULES), ...clone(CUSTOM_RULES)],
    skippedItemIds: ["exalted-orb", "chaos-orb"],
    ...(base ? { baseFilter: base } : {}),
    ...extra,
  };
}

let library: Library = {
  server: "international",
  settings: { intervalMinutes: 120, paused: false },
  filterDirectory: "C:\\Users\\grayd\\Documents\\My Games\\Path of Exile 2",
  customDirectory: false,
  schemes: [
    {
      id: "scheme-1",
      name: "崇高石开荒",
      profile: profile("Runes of Aldur", BASE),
      autoRefresh: true,
      installed: { name: "崇高石开荒.filter", directory: "C:\\Users\\grayd\\Documents\\My Games\\Path of Exile 2" },
      status: "过滤器已写入游戏目录",
    },
    {
      id: "scheme-2",
      name: "终局刷图 · 半严格",
      profile: profile("Runes of Aldur", BASES[1], { strictness: 4 }),
      autoRefresh: false,
      installed: null,
      status: "请先选择基础过滤器",
    },
    {
      id: "scheme-3",
      name: "朋友的分享方案",
      profile: profile("Standard", undefined, { baseFilterHint: "NeverSink's filter 2 - 3-STRICT" }),
      autoRefresh: false,
      installed: null,
      status: "",
    },
    {
      id: "scheme-4",
      name: "方案一",
      profile: profile("Forbidden Rites", LOCAL_BASE, { rules: clone(DEFAULT_RULES) }),
      autoRefresh: false,
      installed: null,
      status: "",
    },
    {
      // 名字达到 80 字上限，用来检查再长的文字也不会把列表撑坏。
      id: "scheme-5",
      name: "名字特别长的方案".repeat(10),
      profile: profile("Forbidden Rites", BASE, { rules: clone(DEFAULT_RULES) }),
      autoRefresh: false,
      installed: null,
      status: "",
    },
  ],
};

let nextId = 6;

const schemeById = (id: unknown) => library.schemes.find((entry) => entry.id === id);

/** 给基础过滤器自带的四个价格档各配一套「跟随基础过滤器」时的特效，外加完整预设画廊。 */
function inspection(): BaseInspection {
  const presets = effectData.styles.default as EffectPreset[];
  const styles: BaseInspection["styles"] = {};
  DEFAULT_RULES.forEach((rule, index) => {
    styles[rule.id] = { effects: pickEffects(presets[(index * 14 + 3) % presets.length]), actions: [] };
  });
  return { styles, presets };
}

type Handler = (args: Args) => unknown | Promise<unknown>;

const handlers: Record<string, Handler> = {
  library: () => clone(library),
  select_server: ({ server }) => void (library.server = server as GameServer),
  save_settings: ({ intervalMinutes, paused }) =>
    void (library.settings = { intervalMinutes: Number(intervalMinutes), paused: Boolean(paused) }),
  local_catalog: () => clone(LEAGUE),
  local_market: ({ league, server }) => market(String(league), server as GameServer | undefined),
  refresh_market: async () => delay(900),
  base_styles: () => inspection(),
  preview: ({ profile: value }) => {
    const profile = value as FilterProfile;
    // 选了那份过期的本地文件时，带着它的正文生成，用来演示基础过滤器与游戏版本不兼容的提示。
    const baseline = JSON.stringify(profile.baseFilter) === JSON.stringify(LOCAL_BASE) ? STALE_BASE_TEXT : null;
    return { ...generateFilter(profile, baseline, market(profile.league, profile.server ?? "international")), market: market(profile.league) };
  },
  scheme_save: ({ edit }) => {
    const value = edit as { id: string | null; name: string; profile: FilterProfile };
    const existing = value.id ? schemeById(value.id) : undefined;
    if (existing) {
      existing.name = value.name;
      existing.profile = clone(value.profile);
      return value.id;
    }
    const id = `scheme-${nextId++}`;
    library.schemes.push({ id, name: value.name, profile: clone(value.profile), autoRefresh: false, installed: null, status: "" });
    return id;
  },
  scheme_copy: ({ id }) => {
    const scheme = schemeById(id);
    if (scheme) {
      library.schemes.push({ ...clone(scheme), id: `scheme-${nextId++}`, name: `${scheme.name} 副本`, installed: null });
    }
  },
  scheme_rename: ({ id, name }) => {
    const scheme = schemeById(id);
    if (scheme) scheme.name = String(name);
  },
  scheme_remove: ({ id }) => void (library.schemes = library.schemes.filter((entry) => entry.id !== id)),
  scheme_uninstall: ({ id }) => {
    const scheme = schemeById(id);
    if (scheme) {
      scheme.installed = null;
      scheme.status = "过滤器已卸载";
    }
  },
  scheme_install: ({ id }) => {
    const scheme = schemeById(id);
    if (scheme) {
      scheme.installed = { name: `${scheme.name}.filter`, directory: library.filterDirectory };
      scheme.status = "过滤器已写入游戏目录";
    }
  },
  scheme_auto: ({ id, enabled }) => {
    const scheme = schemeById(id);
    if (scheme) scheme.autoRefresh = Boolean(enabled);
  },
  scheme_share: ({ id }) => `POE2F1.${btoa(String(id))}`,
  scheme_download: () => false,
  scheme_download_base: ({ id, source }) => {
    const scheme = schemeById(id);
    const hint = scheme?.profile.baseFilterHint;
    if (scheme && hint) {
      scheme.profile.baseFilter = { kind: "downloaded", source: String(source), version: "2.3.1", entry: hint, name: hint };
      scheme.profile.baseFilterHint = undefined;
    }
  },
  base_download_offers: () => ({ "NeverSink's filter 2 - 3-STRICT": [{ source: "neversink", label: "NeverSink" }] }),
  inspect_share: ({ code }) => ({
    server: "international",
    name: `分享方案 ${String(code).slice(-4)}`,
    league: "Standard",
    hasServer: true,
    catalog: LEAGUE,
  }),
  scheme_import: ({ name }) => {
    library.schemes.push({
      id: `scheme-${nextId++}`,
      name: String(name || "导入的方案"),
      profile: profile("Standard", BASE),
      autoRefresh: false,
      installed: null,
      status: "",
    });
    return { missing: [] };
  },
  scan_base_filters: async () => {
    await delay(700);
    return clone(BASES);
  },
  source_filters: async ({ cachedOnly }) => {
    await delay(cachedOnly ? 200 : 900);
    return clone(BASES.slice(0, 2));
  },
  pick_base_filter: () => null,
  pick_filter_directory: () => "D:\\PoE2\\Filters",
  save_filter_directory: ({ directory }) => {
    library.customDirectory = directory !== null;
    if (typeof directory === "string") library.filterDirectory = directory;
  },
  update_status: () => ({ phase: "current" }),
  check_update: async () => {
    await delay(600);
    return { phase: "current" };
  },
};

/** 接住界面发出的 Tauri 命令，返回演示数据。 */
export async function mockInvoke<T>(cmd: string, args?: Args): Promise<T> {
  await delay(100 + Math.random() * 150);
  const handler = handlers[cmd];
  if (!handler) throw new Error(`演示模式没有实现命令 ${cmd}`);
  return handler(args ?? {}) as T;
}

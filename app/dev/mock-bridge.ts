/**
 * 浏览器预览用的数据垫片。
 * 只在开发构建且地址带 ?mock=1 时接入（见 lib/desktop.ts）：界面逻辑走真实的 lib/，
 * Tauri 命令返回内存里的演示数据。生产构建不会包含这个文件。
 */
import { inspectBaseFilter } from "../../lib/baseline-effects";
import type { Library } from "../../lib/desktop";
import { DEFAULT_RULES } from "../../lib/data";
import { generateFilter } from "../../lib/filter-engine";
import { DOWNLOAD_CANCELLED, reportDownloadProgress } from "../state/downloads";
import type {
  BaseFilter,
  Currency,
  FilterProfile,
  FilterRule,
  GameServer,
  LeagueCatalog,
  MarketSnapshot,
} from "../../lib/types";

type Args = Record<string, unknown>;
/** 选择列表比方案里存的来源多一个登记时间，只有方案包导入的副本带。 */
type ScannedFilter = BaseFilter & { registeredAt?: number };

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
 * 0.8.3 用的是游戏改名前的类别名，游戏会拒绝加载。选了它的方案，预览里就能看到「基础过滤器与当前游戏版本不兼容」。
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

/** 方案包带进来的副本，只出现在选择列表里。 */
const IMPORTED: ScannedFilter = {
  kind: "imported",
  id: "3f2a91bea8b3c1d40e7f6a5b4c3d2e1f",
  entry: "OnlineFilters/4pQrzmUJ",
  name: "NeverSink-6uberplu-poe2",
  registeredAt: Date.now() / 1000,
};

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
    target: {
      itemIds: ["waystone-tier-16", "waystone-tier-15", "waystone-tier-14", "waystone-tier-13", "waystone-tier-12", "waystone-tier-11", "class-expedition-logbook"],
      itemEnabled: true,
      priceEnabled: false,
    },
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
  autostart: false,
  schemes: [
    {
      id: "scheme-1",
      name: "崇高石开荒",
      description: "开荒期用，崇高石以上保留光柱，其余交给基础过滤器。",
      profile: profile("Runes of Aldur", BASE),
      autoRefresh: true,
      installed: {
        name: "崇高石开荒.filter",
        directory: "C:\\Users\\grayd\\Documents\\My Games\\Path of Exile 2",
        marketCapturedAt: "2026-11-26T08:40:00.000Z",
      },
      status: "过滤器已写入游戏目录",
    },
    {
      id: "scheme-2",
      name: "终局刷图 · 半严格",
      description: "终局刷图：只留高价值掉落，低阶通货全部隐藏。",
      profile: profile("Runes of Aldur", BASES[1], { strictness: 4 }),
      autoRefresh: false,
      installed: null,
      status: "请先选择基础过滤器",
    },
    {
      id: "scheme-3",
      name: "朋友的分享方案",
      description: "",
      profile: profile("Standard", undefined, { baseFilterHint: "NeverSink's filter 2 - 3-STRICT" }),
      autoRefresh: false,
      installed: null,
      status: "",
    },
    {
      id: "scheme-4",
      name: "方案一",
      description: "",
      profile: profile("Forbidden Rites", LOCAL_BASE, { rules: clone(DEFAULT_RULES) }),
      autoRefresh: false,
      installed: null,
      status: "",
    },
    {
      // 名称达到 80 字上限、描述也很长，用来检查再长的文字也不会把列表撑坏。
      id: "scheme-5",
      name: "名字特别长的方案".repeat(10),
      description: "这是一段很长的描述，用来检查卡片在窄窗口里不会被撑坏：超出宽度的部分应当截断并以省略号结尾，完整的内容在方案详情里能看到。".repeat(2),
      profile: profile("Forbidden Rites", BASE, { rules: clone(DEFAULT_RULES) }),
      autoRefresh: false,
      installed: null,
      status: "",
    },
  ],
};

/** 描述和后端一样存成一行。 */
const oneLine = (text: unknown) => String(text).trim().split(/\s+/).join(" ");

let nextId = 6;
/** 最近一次解析的分享码里的描述，导入时带给新方案。 */
let sharedDescription = "";
/** 演示里的下载是否被取消。 */
let downloadStopped = false;

const schemeById = (id: unknown) => library.schemes.find((entry) => entry.id === id);

/** 画廊和生成预览读取同一份演示用的基础过滤器，涵盖单一来源、多个来源和无法绑定的预设。 */
function mockBaseline(base: BaseFilter) {
  if (base.kind === "local") return STALE_BASE_TEXT;
  const regular = base.kind === "downloaded" && base.entry.endsWith("1-REGULAR.filter");
  return [
    "Show",
    '\tBaseType == "Divine Orb"',
    "\tSetFontSize 45",
    regular ? "\tPlayEffect Purple" : "\tPlayEffect Red",
    regular ? "\tMinimapIcon 1 Purple Star" : "\tMinimapIcon 0 Red Star",
    "\tPlayAlertSound 6 300",
    "",
    "Show",
    '\tBaseType == "Orb of Annulment"',
    regular ? "\tSetFontSize 38" : "\tSetFontSize 42",
    "\tSetBorderColor 0 240 190 255",
    "\tPlayEffect Green",
    "",
    "Show",
    '\tBaseType == "Exalted Orb" "Chaos Orb"',
    regular ? "\tSetFontSize 40" : "\tSetFontSize 44",
    "\tPlayEffect Blue",
    "\tMinimapIcon 1 Blue Diamond",
    "\tPlayAlertSound 3 300",
    "",
    "Show",
    '\tBaseType == "Vaal Orb"',
    "\tItemLevel >= 60",
    "\tSetFontSize 34",
    "\tSetBorderColor 255 140 0 255",
    "",
    "Show",
    "",
  ].join("\n");
}

type Handler = (args: Args) => unknown | Promise<unknown>;

const handlers: Record<string, Handler> = {
  library: () => clone(library),
  select_server: ({ server }) => void (library.server = server as GameServer),
  save_settings: ({ intervalMinutes, paused }) =>
    void (library.settings = { intervalMinutes: Number(intervalMinutes), paused: Boolean(paused) }),
  set_autostart: ({ enabled }) => void (library.autostart = Boolean(enabled)),
  local_catalog: () => clone(LEAGUE),
  local_market: ({ league, server }) => market(String(league), server as GameServer | undefined),
  refresh_market: async () => delay(900),
  base_styles: ({ base }) => inspectBaseFilter(mockBaseline(base as BaseFilter), {}),
  preview: ({ profile: value }) => {
    const profile = value as FilterProfile;
    const baseline = profile.baseFilter ? mockBaseline(profile.baseFilter) : null;
    const snapshot = market(profile.league, profile.server ?? "international");
    return { ...generateFilter(profile, baseline, snapshot), market: snapshot };
  },
  scheme_save: ({ edit }) => {
    const value = edit as { id: string | null; name: string; description: string; profile: FilterProfile; baseFilterChanged?: boolean };
    const existing = value.id ? schemeById(value.id) : undefined;
    const draft = clone(value.profile);
    if (existing) {
      if (value.baseFilterChanged === false) {
        draft.baseFilter = existing.profile.baseFilter;
        draft.baseFilterHint = existing.profile.baseFilterHint;
      }
      existing.description = oneLine(value.description);
      existing.profile = draft;
      return existing.id;
    }
    const id = `scheme-${nextId++}`;
    library.schemes.push({ id, name: value.name, description: oneLine(value.description), profile: draft, autoRefresh: false, installed: null, status: "" });
    return id;
  },
  scheme_copy: ({ id }) => {
    const scheme = schemeById(id);
    if (scheme) {
      library.schemes.push({ ...clone(scheme), id: `scheme-${nextId++}`, name: `${scheme.name} 副本`, installed: null });
    }
  },
  scheme_update_info: ({ id, name, description }) => {
    const scheme = schemeById(id);
    if (!scheme) throw new Error("方案不存在");
    const next = String(name).trim();
    if (library.schemes.some((entry) => entry !== scheme && entry.name.toLowerCase() === next.toLowerCase())) {
      throw new Error("已有同名方案，请选择其他名称");
    }
    scheme.name = next;
    if (scheme.installed) scheme.installed.name = `${next}.filter`;
    scheme.description = oneLine(description);
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
      scheme.installed = { name: `${scheme.name}.filter`, directory: library.filterDirectory, marketCapturedAt: new Date().toISOString() };
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
  inspect_share: ({ code }) => {
    sharedDescription = "分享者写的说明：开荒到中期都适用，崇高石以上高亮。";
    return {
      // 分享码里带 tencent 的当作腾讯服的方案，用来演示跨服务器的确认框。
      server: /tencent/i.test(String(code)) ? "tencent" : "international",
      name: `分享方案 ${String(code).slice(-4)}`,
      description: sharedDescription,
      league: "Standard",
      hasServer: true,
      catalog: LEAGUE,
    };
  },
  scheme_import: ({ name }) => {
    library.schemes.push({
      id: `scheme-${nextId++}`,
      name: String(name || "导入的方案"),
      description: sharedDescription,
      profile: profile("Standard", BASE),
      autoRefresh: false,
      installed: null,
      status: "",
    });
    return { missing: [] };
  },
  scan_base_filters: async () => {
    await delay(700);
    return clone([...BASES, IMPORTED]);
  },
  scheme_export_package: () => false,
  scheme_import_package: () => ({ ids: [] }),
  /** 确认框的每一种情况：新导入、重名、更新、被占用、最新、另一个服务器，以及两种基础过滤器选择。 */
  pick_scheme_package: () => ({
    path: "D:\\Downloads\\开荒到终局 方案包.zip",
    title: "开荒到终局",
    current: "international" as GameServer,
    catalog: LEAGUE,
    plan: {
      server: "international" as GameServer,
      sounds: 2,
      review: true,
      needsLeague: true,
      schemes: [
        { state: "new", index: 0, name: "开荒速刷", rules: 6, conflict: null },
        { state: "new", index: 1, name: "终极打宝-自动更新物价", rules: 6, conflict: "终极打宝-自动更新物价 副本" },
        { state: "update", index: 2, name: "终极打法", localName: "终局策略", blocked: false },
        { state: "update", index: 3, name: "赛季冲刺", localName: "中期发育", blocked: true },
        { state: "latest", index: 4, name: "日常清图" },
        { state: "foreign", index: 5, name: "Boss 农场", localName: "Boss 农场" },
      ],
      bases: [
        { state: "updateCopy", index: 0, name: "NeverSink-6uberplu-poe2" },
        { state: "choose", index: 1, name: "订阅的过滤器", source: "国际服订阅" },
      ],
    },
  }),
  source_filters: async ({ source, cachedOnly }) => {
    const cached = clone(BASES.slice(0, 2));
    if (cachedOnly) {
      await delay(200);
      return cached;
    }
    // 分阶段推送进度，让对话框里的进度显示和取消可以演示。
    downloadStopped = false;
    reportDownloadProgress(String(source), { state: "checking" });
    await delay(900);
    const total = 4_700_000;
    for (let step = 1; step <= 5 && !downloadStopped; step += 1) {
      await delay(450);
      reportDownloadProgress(String(source), { state: "downloading", received: (total * step) / 5, total });
    }
    if (downloadStopped) throw new Error(DOWNLOAD_CANCELLED);
    reportDownloadProgress(String(source), { state: "extracting" });
    await delay(900);
    if (downloadStopped) throw new Error(DOWNLOAD_CANCELLED);
    return cached;
  },
  base_download_cancel: () => void (downloadStopped = true),
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

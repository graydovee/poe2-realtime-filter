import type { LocalScheme } from "../../lib/desktop";
import type { GameServer, LeagueCatalog, MarketSnapshot } from "../../lib/types";

export type View = "manager" | "editor";

/** 物品选择器正在编辑的条件、跳过物品或特效来源。 */
export type PickerTarget = "rule" | "skipped" | { kind: "effect-source"; ruleId: string; itemIds?: string[] };

export type EditorDialog = "saveName" | "nameDescription" | "discard";

export type ManagerDialogKind = "nameDescription" | "remove" | "uninstall";
export type ManagerDialog = { kind: ManagerDialogKind; scheme: LocalScheme };

export type ShareDetails = {
  server: GameServer;
  name: string;
  description: string;
  league: string | null;
  hasServer: boolean;
  catalog: LeagueCatalog;
};

export type DownloadOffer = { source: string; label: string };

/** 方案包导入前，后端对包里一个方案的判断。`index` 是包内下标。 */
export type SchemePlan =
  | { state: "new"; index: number; name: string; rules: number; /** 本机有同名方案时，后端给的空闲名称。 */ conflict: string | null }
  | { state: "latest"; index: number; name: string }
  /** 同一个方案 ID，内容不同。`blocked` 表示包里的名称已被本机另一个方案占用。 */
  | { state: "update"; index: number; name: string; localName: string; blocked: boolean }
  /** 同一个方案 ID 在另一个服务器，只能跳过或另存为副本。 */
  | { state: "foreign"; index: number; name: string; localName: string };

/** 后端对包里一份基础过滤器的判断。`source` 是本机那份的来源说明。 */
export type BasePlan =
  | { state: "bound"; index: number; name: string; source: string }
  | { state: "current"; index: number; name: string }
  | { state: "updateCopy"; index: number; name: string }
  | { state: "same"; index: number; name: string; source: string }
  /** 本机有同名但内容不同的过滤器。 */
  | { state: "choose"; index: number; name: string; source: string }
  | { state: "copy"; index: number; name: string };

export type PackagePlan = {
  server: GameServer;
  schemes: SchemePlan[];
  bases: BasePlan[];
  /** 包里自定义音效的文件数。 */
  sounds: number;
  /** 有需要用户决定或确认的事项。 */
  review: boolean;
  /** 包里的赛季在本机已不存在。 */
  needsLeague: boolean;
};

/** 选好方案包后后端返回的内容。 */
export type PickedPackage = {
  path: string;
  title: string | null;
  /** 当前所在的服务器；与包不一致时导入后会切换过去。 */
  current: GameServer;
  plan: PackagePlan;
  catalog: LeagueCatalog;
};

/** 传给后端的导入选择，下标都是包内下标。 */
export type PackageDecisions = {
  league?: string;
  names: Record<number, string>;
  schemeSkips: number[];
  schemeCopies: number[];
  baseKeeps: number[];
  baseCopies: number[];
};

/** 导入方案包的确认框：包的内容和用户做出的选择。 */
export type PackageImport = {
  path: string;
  title: string;
  current: GameServer;
  plan: PackagePlan;
  catalog: LeagueCatalog;
  league: string;
  /** 另起的名称，按包内下标。 */
  names: Record<number, string>;
  /** 选择跳过、另存为副本的方案。 */
  skips: number[];
  copies: number[];
  /** 选择保留本机副本、改用包内副本的基础过滤器。 */
  keeps: number[];
  baseCopies: number[];
};

export type ItemPickerToggle = { ids: string[]; checked: boolean; label: string; key: string };

/** 生成预览的返回结构（后端 `preview` 命令）。 */
export type Generated = {
  filterFile: string;
  fileName: string;
  baselineFile: string;
  appliedRules: Array<{ ruleId: string; ruleName: string; itemCount: number }>;
  safetyReport: {
    passed: boolean;
    warnings: string[];
    coveredRules?: Array<{ ruleId: string; ruleName: string }>;
    unknownItems: number;
    unpricedItems: number;
    ambiguousItems: number;
    hiddenHighValueItems: string[];
    /** 基础过滤器里让游戏拒绝加载的问题，带着最终文本里的行号。 */
    baselineIssues: string[];
    coveredItems: number;
    catalogSize: number;
  };
  market: MarketSnapshot;
};

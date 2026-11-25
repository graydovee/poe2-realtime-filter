import type { LocalScheme } from "../../lib/desktop";
import type { GameServer, LeagueCatalog, MarketSnapshot } from "../../lib/types";

export type View = "manager" | "editor";

/** 物品选择器正在编辑的条件、跳过名单或特效来源。 */
export type PickerTarget = "rule" | "skipped" | { kind: "effect-source"; ruleId: string; itemIds?: string[] };

export type EditorDialog = "saveName" | "discard";

export type ManagerDialogKind = "rename" | "remove" | "uninstall";
export type ManagerDialog = { kind: ManagerDialogKind; scheme: LocalScheme };

export type ShareDetails = {
  server: GameServer;
  name: string;
  league: string | null;
  hasServer: boolean;
  catalog: LeagueCatalog;
};

export type DownloadOffer = { source: string; label: string };

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

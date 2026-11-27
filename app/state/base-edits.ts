import { useMemo } from "react";

import { blockKey, mergeEffects, type BaseRuleView } from "../../lib/base-overlays";
import type { BaseOverlay } from "../../lib/types";
import { useAppStore } from "./store";

/** 当前基础过滤器上的修改，按它对应的规则（原有的条件行）查找。 */
export function useBaseEdits() {
  const overlays = useAppStore((state) => state.profile.overlays);
  const baseName = useAppStore((state) => state.profile.baseFilter?.name);
  return useMemo(() => {
    const byKey = new Map<string, BaseOverlay>();
    for (const overlay of overlays) {
      if (overlay.baseName === baseName) byKey.set(blockKey(overlay.conditions), overlay);
    }
    return byKey;
  }, [overlays, baseName]);
}

/** 一条基础规则在方案里生效的样子：修改生效（总开关打开且这处修改启用）时是改后的。 */
export function effectiveRule(rule: BaseRuleView, edit: BaseOverlay | undefined, editsOn = true) {
  const active = editsOn && edit?.enabled ? edit : undefined;
  return {
    hidden: active?.hidden ?? rule.hidden,
    conditions: active?.conditionLines ?? rule.conditions,
    effects: active ? mergeEffects(rule.effects, active.effects) : rule.effects,
  };
}

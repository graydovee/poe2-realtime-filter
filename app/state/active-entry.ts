import { useAppStore } from "./store";

/** 编辑区当前选中的条目：一条自定义规则，或者基础过滤器一侧的一条规则。同一时间只有一边有选中项。 */
export function useActiveEntry() {
  const rules = useAppStore((state) => state.profile.rules);
  const activeRuleId = useAppStore((state) => state.activeRuleId);
  const activeBase = useAppStore((state) => state.activeBase);
  const baseRules = useAppStore((state) => state.baseRules);
  return {
    rule: activeBase ? undefined : rules.find((rule) => rule.id === activeRuleId) ?? rules[0],
    base: activeBase?.kind === "rule" ? baseRules?.rules[activeBase.index] : undefined,
    baseSelected: Boolean(activeBase),
  };
}

import type { LocalScheme } from "../../../lib/desktop";
import type { BaseFilter } from "../../../lib/types";

const formerSuccessStatuses = new Set(["过滤器已写入游戏目录", "过滤器内容无变化", "过滤器已卸载", "请先选择基础过滤器"]);

/** 方案的状态说明；成功类状态不展示，详细错误里的文件路径做脱敏。 */
export function schemeIssue(status: string) {
  if (formerSuccessStatuses.has(status)) return "";
  return status.replace(/(?:[a-z]:[\\/]|\\\\)[^\r\n]+/gi, "请检查游戏过滤器目录和文件权限");
}

/** 方案引用了分享码里的基础过滤器，但本机还没有选到。 */
export function missingBaseHint(scheme: LocalScheme) {
  return scheme.profile.baseFilter ? undefined : scheme.profile.baseFilterHint;
}

export function schemeTone(scheme: LocalScheme): "sage" | "ember" | "muted" {
  if (schemeIssue(scheme.status) || missingBaseHint(scheme)) return "ember";
  return scheme.installed ? "sage" : "muted";
}

/** 方案所用基础过滤器的简短说明：只有名字和来源。文件路径对判断方案状态没有帮助，一律不显示。 */
export function baseLabel(base?: BaseFilter, hint?: string) {
  if (!base) return hint ? `待选择（${hint}）` : "仅自定义规则";
  switch (base.kind) {
    case "local":
      return base.name;
    case "subscribed":
      return `${base.name} · ${base.source === "online" ? "国际服订阅" : "WeGame 订阅"}`;
    case "downloaded":
      return `${base.name} · ${base.source} · ${base.version}`;
  }
}

/** 缺失的基础过滤器提示名（去重排序后的 JSON 字符串），用作请求下载来源的键。 */
export function missingBaseNames(schemes: LocalScheme[] | undefined) {
  const names = new Set<string>();
  for (const scheme of schemes ?? []) {
    const hint = missingBaseHint(scheme);
    if (hint) names.add(hint);
  }
  return JSON.stringify([...names].sort());
}

# poe2-filter

PoE2 安全优先掉落过滤器生成器：选择 NeverSink 基础严格度，使用完整物品目录、每日 poe.ninja 价格和 D/C/E 汇率配置光效，再导出 `.filter` 与音效 ZIP。

## 能力

- 七个 NeverSink PoE2 基础档位和多种官方视觉风格。
- 从 NeverSink 基础规则解析的完整物品目录（当前包含 1417 个 BaseType/Class 条目）。
- 白名单支持搜索、分类和任意目录项添加。
- 每个 NeverSink 光效可以单独设置价格范围、启用状态、优先级和音效。
- 价格范围输入单位为 D（神圣石）、C（混沌石）或 E（崇高石）。
- 价格比较使用同一份 poe.ninja 快照中的物品价格和汇率：
  - `D = 1 divine`
  - `C = amount / divineToChaos`
  - `E = amount / divineToExalted`
- 未知物品、没有可靠价格、汇率或安全匹配器的物品继续使用 NeverSink 原始规则。
- 自定义音效按光效预设上传并随 ZIP 一起导出。
- 生成前输出覆盖率、未定价、歧义匹配和潜在误隐藏安全报告。

## 安全原则

- NeverSink 模板原样 vendored，新增规则只放在文件前面。
- 未定价和歧义项目不会被新增隐藏或强行降级。
- 白名单优先于可选的低价值隐藏。
- 光效范围重叠时按界面顺序第一条命中。
- 价格或汇率同步失败时保留上一份有效快照；没有有效快照则只使用基础过滤器。
- Kubernetes 更新只通过项目 Git、Chart 和 ArgoCD 完成，不使用直接 `kubectl` 修改。

## 本地开发

```bash
npm install
npm run dev
npm test
npm run validate:data
npx tsc --noEmit --incremental false
npm run build
```

市场 worker 默认每 6 小时同步一次，也可以单次执行：

```bash
RUN_ONCE=1 npm run sync:prices
```

## 发布与部署

Gitea Actions 只在 `v*` tag 上构建 amd64/arm64 镜像，推送到 Harbor 并回写项目 Chart 的 `image.tag`。ArgoCD Application 从本仓库的 `charts/poe2-filter` 拉取 Chart 并部署。

NeverSink 过滤器及音效遵循其仓库中的许可证和来源说明；PoE2 游戏数据属于 Grinding Gear Games。

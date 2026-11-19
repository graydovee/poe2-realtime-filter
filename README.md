# poe2-filter

PoE2 安全优先掉落过滤器生成器：选择 NeverSink 基础严格度，使用完整物品目录、每日 poe.ninja 价格和 D/C/E 汇率配置光效，再导出 `.filter` 与音效 ZIP。

## 能力

- 选择赛季或永久区；物价、D/C/E 汇率和默认光效价格区间按赛季独立加载。
- 赛季选项来自 PoE2 官方交易站与 poe.ninja 行情索引，切换赛季会清空旧行情与旧预览。

- 七个 NeverSink PoE2 基础档位和多种官方视觉风格。
- 从 NeverSink 基础规则解析的完整物品目录（当前包含 1417 个 BaseType/Class 条目）。
- 白名单按物品种类逐级选择（例如装备 → 武器 → 弓），支持三语搜索、已选汇总和移除。
- 白名单和低价值隐藏在同一板块；隐藏默认关闭，预填阈值为 0.1 E。
- 每个 NeverSink 光效可以单独设置价格范围、启用状态、优先级和音效。
- 默认启用崇高石、混沌石、剥离石、神圣石四档原始视觉与音效（从所选 NeverSink 档位与风格读取），先按 poe.ninja 汇率统一换算成 E，再从低到高排列价格区间。每档使用下限通货的效果，最高档无上限，低于最小通货价格沿用原始规则。
- 默认端点跟随通货市价，也可切换为固定 D/C/E 价格；行情缺失时不猜测价格端点。
- 价格范围输入单位为 D（神圣石）、C（混沌石）或 E（崇高石）。
- 价格排序与区间比较统一使用 E，基于同一份 poe.ninja 快照：
  - `D × divineToExalted = E`
  - `C × divineToExalted / divineToChaos = E`
  - `E = 崇高石数量`
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

物品分类使用客户端 ItemClass，可在更新客户端数据后运行 `node scripts/build-catalog-groups.mjs <客户端版本目录>` 重建；未识别的条目保留在其他分类。

通货样式从全部 56 个 NeverSink 模板提取，预览和生成器共用 `data/neversink-currency-appearances.json`。运行 `node scripts/extract-neversink-appearances.mjs --check` 验证源文件及样式数据一致；更新模板后可去掉 `--check` 重建。

## 赛季行情

`GET /api/leagues` 返回可选赛季；`GET /api/market?league=<赛季ID>` 返回该赛季快照。生成和 ZIP 导出配置均包含 `league`，结果文件名、文件头和清单标记赛季。

行情按赛季保存到 DATA_DIR/markets/ 独立文件，同一赛季缺失或过期时拉取新数据；失败时仅使用该赛季仍有效的缓存，否则沿用 NeverSink 基线。旧版单文件缓存只会被同名赛季使用。同步 worker 每个周期更新全部可选经济区。`POE2_LEAGUE` 只控制默认选择，用户仍可在网页切换。自定义 `MARKET_SNAPSHOT_URL` 接收 league 查询参数，返回 JSON 的 league 必须与请求完全一致。

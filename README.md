# poe2-filter

PoE2 安全优先掉落过滤器生成器：选择 NeverSink 基础严格度，使用完整物品目录、每日 poe.ninja 价格和 D/C/E 汇率配置光效，再导出 `.filter` 与音效 ZIP。

## 能力

- 选择赛季或永久区；物价、D/C/E 汇率和默认光效价格区间按赛季独立加载。
- 赛季选项来自 PoE2 官方交易站与 poe.ninja 行情索引，切换赛季会清空旧行情与旧预览。

- 七个 NeverSink PoE2 基础档位和多种官方视觉风格。
- 从 NeverSink 基础规则解析的完整物品目录（当前包含 1417 个 BaseType/Class 条目）。
- 白名单按 poe.ninja 的经济分组逐级选择（基础通货 / 碎片 / 深渊骨骸 / 精华 / 预兆 / 探险 / 液化情绪 / 催化剂 / 维金 / 神庙，再往上是装备等分支）；每个分类都可以整类勾选，也可以只勾分类下的单件物品，支持三语搜索、已选汇总和移除。
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
- 生成前输出覆盖率、未定价、歧义匹配和潜在误隐藏安全报告；判定规则见 [生成流程](docs/filter-generation.md)。

## 安全原则

- NeverSink 模板原样 vendored，新增规则只放在文件前面。
- 未定价和歧义项目不会被新增隐藏或强行降级。
- 白名单优先于可选的低价值隐藏。
- 光效范围重叠时按界面顺序第一条命中。
- 价格或汇率同步失败时保留上一份有效快照；没有有效快照则只使用基础过滤器。
- Kubernetes 更新只通过项目 Git、Chart 和 ArgoCD 完成，不使用直接 `kubectl` 修改。

## 界面与设计系统

网页端使用 Tailwind CSS + Radix 无样式原语重构，配色取自 PoE2 的暗黑奇幻基调，稀有度沿用游戏官方配色；Cinzel / Inter / JetBrains Mono 全部自托管，不请求外部字体或 CDN。设计 token 与组件规范见 [docs/design-system.md](docs/design-system.md)。

- 页面只保留状态与数据流（`app/page.tsx`），面板拆到 `app/components/sections/*`，基础组件在 `app/components/ui/*`。
- 字体 token、Tailwind 主题与复合组件样式集中定义，新增界面请复用 `ui/*` 组件。
- 界面改动后的回归：`npx tsc --noEmit --incremental false && npm run lint && npm run build`。

## 生成流程

从请求到 `.filter` 的完整链路（行情快照、基线选择、光效分档、覆盖规则优先级、安全检查与降级矩阵）见 [docs/filter-generation.md](docs/filter-generation.md)。

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

### 通货与材料的分组

`crafting`（通货与材料）分支的口径**直接跟随 [poe.ninja PoE2 经济侧栏](https://poe.ninja/poe2/economy/forbiddenrites/currency)**，只额外把「神庙」从基础通货里拆出来：

| 分组 | 对应 poe.ninja 标签页 | 数量 |
|---|---|---|
| 基础通货 | Currency（去掉神庙） | 36 |
| 碎片 | Fragments（通货碎片与各种碎片） | 10 |
| 深渊骨骸 | Abyssal Bones | 11 |
| 精华 | Essences | 82 |
| 预兆 | Omens | 37 |
| 探险 | Expedition（溶剂与远征传说） | 30 |
| 液化情绪 | Liquid Emotions | 26 |
| 催化剂 | Catalysts | 26 |
| 维金 | Verisium（合金 / 维金 / 星辉矿 / 徽记） | 25 |
| 神庙 | 自己拆出来的：阿兹里神庙专属通货 | 14 |
| 试炼钥匙 | poe.ninja 未收录：赛克玛试炼钥匙 | 3 |

判定与复核方式：每件物品在 `data/item-mechanics.json` 里都有 `{ mechanic, evidence }`，其中 `evidence` 说明依据。优先级是

1. **poe.ninja 标签页**（153 件）：直接按商店分类，和界面里看到的一致；
2. **wiki 分类 / tags / drop_text**（20 件）：poe.ninja 未收录的条目回落到 poe2wiki 的 `Category:Abyss`、`verisium_*` 标签、`Verisium Remnant` 掉落文本等；
3. **名称族与人工校正**（45 件）：`Thaumaturgic Flux (Level N)`、`Aldur's Saga`、`* Key` 等；另有 2 条人工校正写在脚本里。

两个刻意的偏差：poe.ninja 会把同一族材料拆到两个标签页（部分溶剂在 Verisium、部分星辉矿在 Expedition），这里按材料族归一；`Breach Splinter` 在商店属于 Breach 标签页，但这里和其他碎片一起进「碎片」。

更新流程：

```bash
node scripts/build-item-mechanics.mjs    # 抓 poe.ninja 标签页 + wiki 兜底（需要网络）
node scripts/apply-catalog-mechanics.mjs # 写回 data/item-catalog.json（离线、确定）
node scripts/validate-data.mjs           # 校验分组词条、展示顺序与未归类条目
```

更新 NeverSink 或客户端数据后，如果新物品没有分组归属，`validate:data` 和 `tests/item-taxonomy.test.mjs` 会直接失败并点名。整类白名单在过滤器里展开成合并的 `BaseType ==` 列表块（每 24 个一组），单件物品仍是独立规则。

wiki 侧的分类与三语对照方法参考同组织的 [poe2-skills](https://git.graydove.cn/graydove/poe2-skills) 中的 `poe2-wiki-search` skill。

## 赛季行情

`GET /api/leagues` 返回可选赛季；`GET /api/market?league=<赛季ID>` 返回该赛季快照。生成和 ZIP 导出配置均包含 `league`，结果文件名、文件头和清单标记赛季。

行情按赛季保存到 DATA_DIR/markets/ 独立文件，同一赛季缺失或过期时拉取新数据；失败时仅使用该赛季仍有效的缓存，否则沿用 NeverSink 基线。旧版单文件缓存只会被同名赛季使用。同步 worker 每个周期更新全部可选经济区。`POE2_LEAGUE` 只控制默认选择，用户仍可在网页切换。自定义 `MARKET_SNAPSHOT_URL` 接收 league 查询参数，返回 JSON 的 league 必须与请求完全一致。

## Windows 客户端

登录后保存方案并创建只读订阅链接，在 [Windows 客户端](https://git.graydove.cn/graydove/poe2-filter/releases) 中添加链接。客户端默认定位 `C:\Users\<用户>\Documents\My Games\Path of Exile 2`，托盘常驻，每 30 分钟检查一次；首次需要在游戏内选择客户端生成的本地过滤器。

匿名用户只可在网页内生成和下载，关闭网页后配置不保存。


### 登录和方案同步

匿名访问只在当前页面内保存编辑状态，可以生成并下载过滤器。登录后可保存多个方案、上传方案音效、复制方案和创建只读同步链接；客户端使用同步链接，不需要登录网站。

Casdoor OIDC 配置完成后设置 `OIDC_ISSUER`、`OIDC_CLIENT_ID`、`OIDC_CLIENT_SECRET` 和 `PUBLIC_ORIGIN`。未配置 OIDC 时登录按钮会提示尚未配置，匿名功能不受影响。

同步链接只允许读取已发布的固定版本 manifest 和文件，版本使用 SHA-256 校验；方案删除、停用或重置密钥后客户端会停止更新并保留现有文件。
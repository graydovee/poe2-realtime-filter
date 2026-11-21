# 过滤器生成与更新

客户端使用静态 Next.js 页面呈现编辑器。Rust 管理本地方案、音效和输出目录，并在内嵌的 QuickJS 引擎中运行从 TypeScript 打包的生成器。预览和托盘后台更新使用同一套规则。

- `lib/filter-engine.ts` 根据所选 NeverSink 基础严格度和风格生成覆盖规则。自定义规则按编辑顺序匹配，选择物品与价格条件可分别启用，未匹配物品沿用基础过滤器。
- `worker/market-adapter.mjs` 解析 poe.ninja 交易所数据，优先用 Most Popular 报价。在可用的交易对中以 `1 / maxVolumeRate` 得到单件价格，再按 `Currency` 分类的统一汇率换算为 E。
- 按赛季保存原始响应验证头和归一化快照。同一轮更新只请求一次每个赛季的行情数据。任何分类失败或汇率无效时保留旧快照和游戏文件。
- 过滤器注释省略抓取时间。安装前检查生成报告和音效，相同的文件正文不会重写。自定义音效按内容散列命名，防止多个方案互相覆盖。
- 分享码格式为 `POE2F1.` 加无填充的 Base64URL UTF-8 JSON。导入会验证方案格式并生成新的本地 ID。音效仅保留文件名引用。

## 5. 基础过滤器选择

`baselineFileFor(profile)`：

- 严格度 → 文件名后缀：`0-SOFT` … `6-UBER-PLUS-STRICT`。
- 风格 → 目录：`default` 在 `vendor/neversink/` 根下；其余在 `(STYLE) AURA|COBALT|CUSTOMSOUNDS|DARKMODE|MYTHIC|VAAL|ZEN/` 下。
- 文件不存在时回落到同严格度的 default 文件。

## 6. 自定义规则模型

```ts
type RuleTarget = { itemIds: string[]; range?: PriceRange };
type RuleEffects = { beam?: string; icon?: string; font?: RuleFont; sound?: PresetSound };
type FilterRule = { id; name; enabled; hidden; autoRange?; target; effects };
```

### 6.1 匹配条件（物品 ∩ 价格）

两个条件各自有启用开关（`target.itemEnabled` / `target.priceEnabled`，缺省视为启用），关闭时保留已选内容但不参与匹配：

| 物品条件 | 价格条件 | 命中范围 |
|---|---|---|
| 启用且有选择 | 关闭 | 就是这些物品，不看价格 |
| 关闭 | 启用且有区间 | 所有**有价**且落在 `[min, max)` 的物品 |
| 启用且有选择 | 启用且有区间 | 交集：物品在这些 id 里，且价格落在区间 |
| 关闭 | 关闭 | 非法（保存时 400；UI 不允许关到只剩空条件） |
| 启用但没选物品 | 启用且有区间 | 只会因价格命中（等价只填价格） |

### 6.2 优先级与匹配流程

**跳过名单 > 规则（数组顺序，首个命中）> 基线**。

```text
skipped = Set(profile.skippedItemIds)
rules   = enabled 规则，autoRange 先按当日锚点重排区间
for item of ITEM_CATALOG:
    if item.ambiguous or skipped.has(item.id) -> continue
    for rule of rules:
        if 物品条件不满足 -> continue
        if 价格条件不满足（无价也算不满足）-> continue
        emit block(rule, item)      // Show 或 Hide + 仅已填写的动作
        break                        // 首个命中即生效
未命中的物品                        -> 不写任何块，基线照旧
```

### 6.3 动作合成

| 字段 | 有值 | 留空 |
|---|---|---|
| `beam` | `PlayEffect <beam>` | 不写 |
| `icon` | `MinimapIcon <icon>` | 不写 |
| `font` | 按已填的子字段写 `SetFontSize` / `SetTextColor` / `SetBorderColor` / `SetBackgroundColor` | 不写 |
| `sound` | `PlayAlertSound <id> <volume>` 或 `CustomAlertSound "<file>" 300` | 不写 |

- `hidden` → 块首行是 `Hide`，动作照写（合法；游戏内 Alt 可见）。
- 四个特效都留空且不隐藏 → 不生成块。
- 块注释：`Show|Hide # poe2-filter rule: <规则名> / <物品名>`。

### 6.4 跟随市价

`autoRange` 规则把区间重排成 `[锚点_i, 锚点_{i+1})`，锚点是崇高石 / 混沌石 / 剥离石 / 神圣石，最高档无上限。四枚锚点任一缺价 → 该规则被禁用并在 warnings 里点名；规则顺序保持用户列表顺序（区间互不重叠，不需要重排）。

## 7. 完整特效预设集合

`scripts/extract-neversink-effects.mjs` 扫描全部 56 个 vendored 过滤器（default + 7 套 STYLE × 7 档），按视觉风格抽取**完整外观**：一个预设 = 光柱 + 地图图标 + 字体（字号与三色）+ 音效，写入 `data/neversink-effects.json` 的 `styles[style][]`（每套 60–104 个，按在基线里出现的频次排序）。

- 预设 id 形如 `look-default-15`，规则用 `effectPresetId` 记住来源（只用于回显；生成器读的是 `effects` 里的具体值）。
- 选择预设会把四项一次性填入 `rule.effects`；之后任何字段的手改都会清掉 `effectPresetId`，变成「自定义」。
- 编辑器同时保留一个掉落预览（光柱、标签配色、图标），实时反映当前 `effects`。
- `data/default-rules.json`：4 条默认规则（`default-exalted` / `default-chaos` / `default-annulment` / `default-divine`），`effectPresetId` 指向 default 风格里对应通货的预设，`effects` 与预设逐项一致。

生成过程不读取预设数据，只读取规则里的具体值，因此保持离线、确定。

## 8. 输出拼装

```text
# poe2-filter generated overlay
# Base: <baselineFile>
# League: <league>
# Strictness: <0-6> - <中文档位>
# Rules: <启用条数> enabled / <跳过物品数> skipped items
# Market: <snapshot.source>
# Safety: 未配置的动作交给 NeverSink 基线；隐藏规则会让安全检查失败。

<规则块，块之间空行>

<基线文件原文，一字不改>
```

- 文件名：`poe2-filter-<league 转 slug>-<档位小写>.filter`。
- `soundFiles`：先收集规则里用到的非内置音效，再从最终文本扫 `CustomAlertSound(Optional) "…"` 兜底。
- 返回 `GeneratedBundle`：`filterFile`、`baselineFile`、`fileName`、`soundFiles`、`appliedRules`（每条命中多少物品）、`safetyReport`。

## 9. 安全检查（safetyReport）

| 字段 | 含义 |
|---|---|
| `coveredItems` / `catalogSize` | 基线可匹配的 BaseType/Class 值总数 / 目录总条目 |
| `unknownItems` | 未识别条目 |
| `unpricedItems` | 可定价但没有当日价格的条数（不参与价格条件） |
| `ambiguousItems` | 类别级/歧义匹配条数（规则一律跳过） |
| `hiddenHighValueItems` | 被隐藏且 E 值 ≥ 1D 的物品（**必须为空**） |
| `exclusionViolations` | 跳过名单里的物品被隐藏（**必须为空**，正常不会发生） |
| `warnings` | 无启用规则、锚点缺价、规则未命中、快照缺失、跳过名单等说明 |
| `passed` | 上两项都为空 |

订阅渲染（`renderManifest`）把 `passed === false` 当作硬错误：不发布新版本，保留上一版并标 `stale: true`。

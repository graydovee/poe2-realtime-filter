# 过滤器生成流程

一句话：**profile（基础过滤器 + 自定义规则 + 跳过名单）+ 当日行情快照 → 选中的 NeverSink 基线 → 逐条规则生成的覆盖块 → 安全检查 → `.filter` 文本（或 ZIP）**。

基线永远原样保留，规则块只叠在文件最前面；规则里没有填写的动作一律不写，交给基线决定。

## 1. 代码位置

| 阶段 | 位置 | 关键函数 |
|---|---|---|
| HTTP 入口 | `app/api/generate/route.ts`、`app/api/export/route.ts` | `POST` |
| 方案/订阅入口 | `lib/profiles.ts` | `latestManifest` → `renderManifest` |
| 参数归一 | `lib/profile.ts` | `normalizeProfile` |
| 生成核心 | `lib/filter-engine.ts` | `generateFilter`、`validateSafety` |
| 行情快照 | `worker/market-service.mjs`、`lib/market.ts` | `getMarketSnapshot`、`loadMarketSnapshot` |
| 行情解析 | `worker/market-adapter.mjs` | `parseExchange`、`NINJA_TYPES` |
| 价格换算 / 分档 | `lib/pricing.ts` | `toExalted`、`currencyPriceTiers`、`resolveAutoRanges` |
| 特效预设 | `scripts/extract-neversink-effects.mjs` | 生成 `data/neversink-effects.json` 与 `data/default-rules.json` |
| 数据 | `data/item-catalog.json`、`data/item-mechanics.json`、`data/neversink-effects.json`、`data/default-rules.json` | — |
| 基线规则 | `vendor/neversink/**` | — |
| 定时刷新 | `worker/price-sync.mjs` | 每 6 小时全赛季刷新 |

## 2. 总览

```text
POST /api/generate            POST /api/export (multipart)
        │                              │
        └──────────┬───────────────────┘
                   ▼
        normalizeProfile(请求体)      （补齐默认字段 / 统一赛季名；旧格式直接 400）
                   │
                   ▼
        loadMarketSnapshot(league) ───► 缓存有效？→ 直接返回
                   │                     否 → poe.ninja exchange → 落盘 data/runtime/markets/<sha256>.json
                   ▼                     失败 → 同赛季旧缓存 → 仍无 → 空快照
        generateFilter(profile, snapshot)
                   │
       ┌───────────┼────────────┬───────────────────────┐
       ▼           ▼            ▼                       ▼
  读基线文件   解析 autoRange  逐条规则生成覆盖块      安全检查
  (严格度+风格) (锚点重排)     (跳过名单 > 规则 > 基线)  (safetyReport)
       │           │            │                       │
       └───────────┴────────────┴──────────┬────────────┘
                                            ▼
                   header + 规则块 + 原样基线 → filterFile
                                            │
                              ┌─────────────┴─────────────┐
                              ▼                           ▼
                     JSON（预览/下载）        ZIP（filter + manifest + 音效）
```

## 3. 请求入口与参数归一

- 生成：`POST /api/generate`，body 为 JSON profile。
- 导出：`POST /api/export`，`multipart/form-data`，字段 `profile`（JSON 字符串）加 `sound:<ruleId>` 自定义音效文件。
- 两者都先走 `normalizeProfile`：补齐 `DEFAULT_PROFILE` 缺失字段、`normalizeLeague`（trim、长度 ≤ 120、拒绝控制字符）、规范化每条规则的 `target.itemIds` 与 `effects`。
- 旧版方案（`whitelist` + `visualPresets`）不再兼容：缺少 `rules` 会直接报「方案格式已更新，请重新添加自定义过滤规则」。
- 完整字段校验只在保存方案/创建订阅时走 `validateProfile`（见第 11 节）；直接调生成接口时只做归一，结构错误会表现为 400 或空输出。
- 失败一律 `400` + `{ "error": "..." }`。

## 4. 行情快照

### 4.1 取数

`getMarketSnapshot(league)`（`worker/market-service.mjs`）：

1. 先读 `DATA_DIR/markets/<sha256(league)>.json`；若 `validSnapshot`（league 一致、时间可解析、未过期、rates 为正、每条 price 结构合法）直接返回，**不联网**。
2. 未命中则进 `pending` 去重（同联赛并发只打一次上游），失败后 60 秒内不重试（`retryAfter`）。
3. 上游是 poe.ninja PoE2 exchange：

   ```text
   https://poe.ninja/poe2/api/economy/exchange/current/overview?league=<league>&type=<type>
   type = Currency, Fragments, Abyss, UncutGems, LineageSupportGems, Essences,
          SoulCores, Idols, Runes, Ritual, Expedition, Delirium, Breach, Verisium
   ```

   先取 `Currency` 拿汇率，其余类型按 3 个一批并发补齐价格（`MARKET_NINJA_TYPES` 可覆盖类型清单）。
4. 有效期写成 `now + interval × 2`，`interval` 默认 6 小时（`MARKET_SYNC_INTERVAL_MS`）。
5. 失败时：同赛季旧缓存仍有效就用旧的；否则返回空快照（`source: "NeverSink baseline fallback"`、`prices: {}`）。**绝不会拿别的赛季的数据顶替。**

### 4.2 解析（`parseExchange`）

- 只接受 `core.primary === "divine"` 的 payload，否则抛错。
- 名称匹配：`item.name.toLowerCase()` ↔ catalog 的 `marketKey.toLowerCase()`，**精确匹配、不做模糊匹配**。
- 汇率：`core.rates.chaos` → `divineToChaos`，`core.rates.exalted` → `divineToExalted`，并给 Divine / Chaos / Exalted 三枚锚点补上以 D 计价的 price。

### 4.3 使用条件

`generateFilter` 只接受同一个 league 且 `snapshotUsable`（`source !== fallback` 且 `expiresAt >= now`）的快照，否则用空快照 —— 此时所有**价格条件**都不成立，只有「选择物品」的条件仍然生效。

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
# Market: <snapshot.source> @ <capturedAt>
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

## 10. ZIP 导出

`POST /api/export` 生成一个**未压缩**（store 模式、手写 crc32）的 ZIP：

| 条目 | 内容 |
|---|---|
| `<fileName>` | 过滤器文本 |
| `poe2-filter-manifest.json` | `generatedAt`、`baseline`、`market` 快照、`appliedRules`、`safety` |
| 上传音效 | 只收 `sound:<ruleId>` 且文件名出现在 `bundle.soundFiles` 里的文件 |
| 内置音效 | `vendor/neversink/(STYLE) CUSTOMSOUNDS/` 里同名文件；缺失则跳过（manifest 里仍列出） |

## 11. 校验规则（`validateProfile`）

保存方案/创建订阅时逐项校验：

- 规则 ≤ 100 条，id 唯一且匹配 `^[a-zA-Z0-9_-]{1,100}$`，名称 1–100 字符。
- `target.itemIds` ≤ 2000 且都存在于物品目录；`target.range` 端点金额 ≤ 1e12、货币合法、`referenceItemId` 只能是四枚锚点之一；`itemIds` 与 `range` 不能同时为空。
- `effects.beam` / `effects.icon` 必须匹配游戏内取值格式；`font.fontSize` 18–45，颜色为 `R G B [A]` 且每项 ≤ 255。
- `sound`：内置 1–16 号、音量 0–300；自定义文件名 `safeName` 后不变、扩展名 mp3/wav/ogg。
- `skippedItemIds` ≤ 5000，每个 id 都存在于目录。

## 12. 订阅 / 客户端链路

`latestManifest`（同一方案并发去重）→ `renderManifest`：

1. `validateProfile` → `resolveProfileLeague`（下架赛季挪到永久区，保留 `originalLeague`）。
2. 行情必须有效（`rates` 存在且未过期），否则直接失败。
3. `generateFilter`，`!passed` 失败。
4. 音效优先取方案上传过的（按 sha256），否则取 vendor 内置；过滤器文本里把音效路径重写成 `poe2-filter-assets/<profileId>/<revision>/<name>`。
5. `revision = sha256(filter + 音效哈希).slice(0, 32)`，manifest 列出每个文件的 `sha256` / 大小。
6. 校验方案版本未在渲染期间变化；失败则记 `sync_status.error`，有上一版就返回 `stale` 版本。

## 13. 降级矩阵

| 情况 | 结果 |
|---|---|
| 行情缺失 / 过期 | 空快照：价格条件不成立，物品条件照常；warnings 提示 |
| 只有部分物品有价 | 有价的按规则处理，无价的不参与价格条件，`unpricedItems` 计数 |
| 快照 league 与请求不一致 | 直接丢弃，按「缺失」处理 |
| 风格文件缺失 | 回落到同严格度 default 文件 |
| 四枚锚点任一缺价 | 所有 `autoRange` 规则禁用，warning 点名 |
| 规则两个条件都空 | 校验 400；生成时该规则被忽略 |
| 隐藏会藏掉 ≥1D 物品 | `passed = false`；订阅不发布，网页仍可下载但会红字警告 |
| 跳过名单物品 | 不参与任何规则；若仍被隐藏则 `passed = false` |
| 导出时自定义音效不在 `soundFiles` | 忽略该文件 |
| poe.ninja 返回非 divine 主币或结构异常 | 抛错 → 该赛季保留旧缓存；无缓存则空快照 |

## 14. 复现与排查

```bash
npm run dev -- --port 3100
curl -s http://127.0.0.1:3100/api/generate -H 'content-type: application/json' \
  -d '{"league":"Standard","strictness":3,"style":"default","locale":"cn","schemaVersion":2,"rules":[{"id":"r1","name":"示例","enabled":true,"hidden":false,"target":{"itemIds":["divine-orb"]},"effects":{"beam":"White"}}],"skippedItemIds":[]}' \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log(j.fileName, j.appliedRules, j.safetyReport.passed)})"
```

定位生成内容：

```bash
grep -n '^Show # poe2-filter rule:' generated.filter
grep -n '^Hide # poe2-filter rule:' generated.filter
```

直接调函数（测试里的做法，把 TS 编成 CJS 再 require）：

```bash
node node_modules/typescript/bin/tsc lib/filter-engine.ts lib/catalog.ts lib/default-profile.ts \
  --outDir .tmp-engine --module commonjs --target es2021 --esModuleInterop --resolveJsonModule --skipLibCheck
node -e "const {generateFilter}=require('./.tmp-engine/lib/filter-engine.js');const {DEFAULT_PROFILE}=require('./.tmp-engine/lib/default-profile.js');console.log(generateFilter(DEFAULT_PROFILE).filterFile.length)"
rm -rf .tmp-engine
```

回归测试覆盖的不变量（`tests/filter-rules.test.mjs`、`tests/neversink-effects.test.mjs`）：默认 4 条规则复刻基线外观、留空动作不写、物品 ∩ 价格取交集、规则顺序首命中、隐藏块可带特效、跳过名单硬优先、隐藏高价值会失败、锚点缺价禁用 autoRange、快照赛季不一致不生效。

## 15. 已知限制

- 生成接口本身不做完整 `validateProfile`，保存/订阅才校验。
- 价格匹配按名称精确匹配，poe.ninja 改名或中英对齐不一致的物品会落到「未定价」，不参与价格条件。
- 规则只按价格与物品匹配，不评估词缀价值；高价值判断完全依赖当日行情。
- 默认 4 条规则的特效值固定在 default 风格 2-SEMI-STRICT 的原始外观；换风格后需要手动改，或重新跑 `scripts/extract-neversink-effects.mjs`。
- 旧版方案（白名单 + 光效预设）不再兼容，需要重新保存。

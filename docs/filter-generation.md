# 过滤器生成流程

一句话：**profile（用户配置）+ 当日行情快照 → 选中的 NeverSink 基线 → 三类覆盖规则（白名单 / 价格光效 / 低价值隐藏）→ 安全检查 → `.filter` 文本（或 ZIP）**。

基线永远原样保留，新规则只叠在文件最前面；任何拿不准的情况（未定价、歧义匹配、快照缺失）都退回 NeverSink 原始规则。

## 1. 代码位置

| 阶段 | 位置 | 关键函数 |
|---|---|---|
| HTTP 入口 | `app/api/generate/route.ts`、`app/api/export/route.ts` | `POST` |
| 方案/订阅入口 | `lib/profiles.ts` | `latestManifest` → `renderManifest` |
| 生成核心 | `lib/filter-engine.ts` | `generateFilter`、`validateSafety` |
| 行情快照 | `worker/market-service.mjs`、`lib/market.ts` | `getMarketSnapshot`、`loadMarketSnapshot` |
| 行情解析 | `worker/market-adapter.mjs` | `parseExchange`、`NINJA_TYPES` |
| 价格换算与分档 | `lib/pricing.ts` | `toExalted`、`currencyDefaultRanges` |
| 模板外观 | `lib/neversink-appearance.ts` | `applyTemplateAppearances` |
| 数据 | `data/item-catalog.json`、`data/visual-presets.json`、`data/neversink-currency-appearances.json`、`data/item-mechanics.json` | — |
| 基线规则 | `vendor/neversink/**` | — |
| 定时刷新 | `worker/price-sync.mjs` | 每 6 小时全赛季刷新 |

## 2. 总览

```text
POST /api/generate            POST /api/export (multipart)
        │                              │
        └──────────┬───────────────────┘
                   ▼
        DEFAULT_PROFILE ← 请求体        （visualPresets 缺省用 DEFAULT_VISUAL_PRESETS）
                   │
                   ▼
        normalizeLeague(league)        （trim / 长度 ≤120 / 拒绝控制字符）
                   │
                   ▼
        loadMarketSnapshot(league) ───► 缓存有效？→ 直接返回
                   │                     否 → poe.ninja exchange → 落盘 data/runtime/markets/<sha256>.json
                   ▼                     失败 → 同赛季旧缓存 → 仍无 → 空快照
        generateFilter(profile, snapshot)
                   │
       ┌───────────┼────────────┬─────────────────────┐
       ▼           ▼            ▼                     ▼
  读基线文件   解析光效预设   合成覆盖规则          安全检查
  (严格度+风格) (模板外观+    (白名单→光效→隐藏)    (safetyReport)
                价格分档)
       │           │            │                     │
       └───────────┴────────────┴──────────┬──────────┘
                                           ▼
                   header + 覆盖规则 + 原样基线 → filterFile
                                           │
                             ┌─────────────┴─────────────┐
                             ▼                           ▼
                    JSON（预览/下载）        ZIP（filter + manifest + 音效）
```

## 3. 请求入口与参数归一

- 生成：`POST /api/generate`，body 为 JSON profile。
- 导出：`POST /api/export`，`multipart/form-data`，字段 `profile`（JSON 字符串）加 `sound:<presetId>` 自定义音效文件。
- 两者都先做 `{ ...DEFAULT_PROFILE, ...body }`，`visualPresets` 缺省回落到 `DEFAULT_VISUAL_PRESETS`（21 条，默认启用 4 条锚点通货）。
- 赛季名统一走 `normalizeLeague`：`trim()`、非空、长度 ≤ 120、拒绝 `\u0000-\u001f`；不合法直接 400。
- 现状差异（重要）：**这两个生成接口不做完整字段校验**，只有保存方案/创建订阅时才走 `validateProfile`（严格度 0–6、风格白名单、阈值范围、白名单条目 id/标签/长度上限 3000、光效 id 与颜色、音效文件名、价格端点、图标格式）。因此直接调 API 时请自行保证结构；页面侧所有输入都经过受控组件。
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

- 只接受 `core.primary === "divine"` 的 payload，否则抛错（宁可不生成价格）。
- 名称匹配：`item.name.toLowerCase()` ↔ catalog 的 `marketKey.toLowerCase()`，**精确匹配、不做模糊匹配**；命中后写 `prices[itemId] = { amount: line.primaryValue, currency: "divine", … }`。
- 汇率：`core.rates.chaos` → `divineToChaos`，`core.rates.exalted` → `divineToExalted`，并给 Divine / Chaos / Exalted 三枚锚点补上以 D 计价的 price。

### 4.3 使用条件

`generateFilter` 只接受「同一个 league」且 `snapshotUsable`（`source !== fallback` 且 `expiresAt >= now`）的快照，否则用空快照 —— 此时所有物品都走 NeverSink 原始规则，并在 warnings 里说明。

## 5. 基础过滤器选择

`baselineFileFor(profile)`：

- 严格度 → 文件名后缀：`0-SOFT`、`1-REGULAR`、`2-SEMI-STRICT`、`3-STRICT`、`4-VERY-STRICT`、`5-UBER-STRICT`、`6-UBER-PLUS-STRICT`。
- 风格 → 目录：`default` 在 `vendor/neversink/` 根下；其余在 `(STYLE) AURA|COBALT|CUSTOMSOUNDS|DARKMODE|MYTHIC|VAAL|ZEN/` 下，文件名形如 `NeverSink's filter 2 - 2-SEMI-STRICT (aura) .filter`。
- 文件不存在时回落到同严格度的 default 文件（不改变严格度，只丢风格外观）。

## 6. 光效预设解析（两步）

1. **套模板外观** —— `applyTemplateAppearances`
   `preset.followTemplate !== false` 时，用 `style:strictness` 从 `data/neversink-currency-appearances.json` 里取该通货在 NeverSink 模板中的 `effect / minimapIcon / 文本·边框·背景色 / 字号 / 音效`，整体覆盖预设；key 取 `appearanceItemId ?? sourceItemId`。用户自传的 `custom` 音效不会被覆盖。
2. **按当日价格重排区间** —— `currencyDefaultRanges`
   - 锚点固定四枚：`exalted-orb`、`chaos-orb`、`orb-of-annulment`、`divine-orb`（`CURRENCY_ANCHORS`），各自换算成 E 后升序排序。
   - 对 `autoRange && sourceItemId` 的预设，区间改成 `[锚点_i, 锚点_{i+1})`，最高档无上限；最后一个自动档之后才允许手工档。
   - 任一锚点缺价 → 该赛季**所有** autoRange 预设禁用（不做部分降级）。
3. 最后只保留 `enabled` 的预设参与匹配。

## 7. 覆盖规则合成（顺序即优先级）

只有三类规则，全部写在基线文件**前面**：

| 顺序 | 规则 | 触发条件 | 生成的语句 |
|---|---|---|---|
| 1 | 白名单 | `whitelist` 条目里的物品（`ambiguous` 项跳过） | `Show # poe2-filter whitelist: …` |
| 2 | 价格光效 | 有价且 E 值命中某已启用预设 | `Show # poe2-filter preset: <预设名> / <物品名>` |
| 3 | 低价值隐藏 | `hideBelowEnabled` 且有价低于阈值、且不在白名单 | `Hide # poe2-filter optional low-value rule: …` |

匹配器由 `matcherLines` 生成，顺序固定：`Class == "…"` → `BaseType == "…"` → `Rarity …`（有哪个写哪个）。

### 7.1 白名单

- 单件条目：一条规则，匹配器同物品。
- 整类条目（分类勾选）：按 `(class, rarity)` 分组合并成 `BaseType == "A" "B" …`，每 24 个 BaseType 一块，标注 `(1-24/129) [129]` 方便排查。
- 动作固定：`SetFontSize 42`、白字白边、`MinimapIcon 0 White Star`、`PlayEffect White`、`PlayAlertSound 6 300`。
- 白名单在最前面，所以能压过基线与后面的价格/隐藏规则；`ambiguous`（类别级/歧义匹配）条目不会生成白名单规则，继续沿用 NeverSink 原始规则。

### 7.2 主循环

遍历 `ITEM_CATALOG`（当前 1417 条）：

```text
price      = item.priceable ? snapshot.prices[item.id] : undefined
E 值        = price && rates ? toExalted({amount, currency}, rates) : undefined
白名单中    = whitelistIds.has(item.id)

if 白名单 && !ambiguous            → continue（规则已写过）
if E 值命中某预设（含下界、不含上界、第一条命中）→ 写 presetRule，记录音效与计数，continue
if 隐藏开启 && E 值 < 阈值 && 未白名单 && !ambiguous → 写 hideRule，记入 hidden
```

- `toExalted`：D 直接乘 `divineToExalted`；C 乘 `divineToExalted / divineToChaos`；E 原值；带 `referenceItemId` 时按锚点通货的当日报价换算。
- 隐藏阈值同样先换算成 E（`hideBelowAmount + hideBelowCurrency`），再与物品 E 值比较。
- 未定价物品不会新增光效也不会被隐藏；`ambiguous` 项两者都不参与。

## 8. 输出拼装

```text
# poe2-filter generated overlay
# Base: <baselineFile>
# League: <league>
# Strictness: <0-6> - <中文档位>
# Market: <snapshot.source> @ <capturedAt>
# Safety: unpriced and ambiguous items remain under the NeverSink baseline.

<覆盖规则，块之间空行>

<基线文件原文，一字不改>
```

- 文件名：`poe2-filter-<league 转 slug>-<档位小写>.filter`，例如 `poe2-filter-forbidden-rites-3-strict.filter`。
- `soundFiles`：先收集预设里的非内置音效名，再从最终文本里扫 `CustomAlertSound(Optional) "…"` 兜底（覆盖模板音效）。
- 返回 `GeneratedBundle`：`filterFile`、`baselineFile`、`fileName`、`soundFiles`、`appliedPresets`（每条预设命中多少物品）、`safetyReport`。

## 9. 安全检查（safetyReport）

| 字段 | 含义 |
|---|---|
| `coveredItems` | 基线里能被匹配的 BaseType / Class 值总数（从基线文本正则统计） |
| `catalogSize` / `unknownItems` | 目录总条目 / 未识别条目 |
| `unpricedItems` | 可定价但没有当日价格的条数 |
| `ambiguousItems` | 类别级/歧义匹配条数 |
| `hiddenHighValueItems` | 被隐藏但 E 值 ≥ 1D 的物品（**必须为空**） |
| `whitelistViolations` | 同时出现在白名单与隐藏列表里的物品（**必须为空**） |
| `warnings` | 快照缺失、未定价数量、歧义数量、启用隐藏等人话提示 |
| `passed` | 上两项都为空 |

订阅渲染（`renderManifest`）把 `passed === false` 当作硬错误：不发布新版本，保留上一版并标 `stale: true`。

## 10. ZIP 导出

`POST /api/export` 生成一个**未压缩**（store 模式、手写 crc32）的 ZIP：

| 条目 | 内容 |
|---|---|
| `<fileName>` | 上面拼出的过滤器文本 |
| `poe2-filter-manifest.json` | `generatedAt`、`baseline`、`market` 快照、`appliedPresets`、`safety` |
| 上传音效 | 只收 `sound:<presetId>` 且文件名出现在 `bundle.soundFiles` 里的文件 |
| 内置音效 | `vendor/neversink/(STYLE) CUSTOMSOUNDS/` 里同名文件；缺失则跳过（manifest 里仍列出） |

## 11. 订阅 / 客户端链路

`latestManifest`（同一方案并发去重）→ `renderManifest`：

1. `validateProfile` 校验配置，`resolveProfileLeague` 把已下架的赛季挪到永久区（保留 `originalLeague` 展示）。
2. 行情必须有效（`rates` 存在且未过期），否则直接失败。
3. `generateFilter`，`!passed` 失败。
4. 音效优先取方案里上传过的（按 sha256），否则取 vendor 内置；过滤器文本里把音效路径重写成 `poe2-filter-assets/<profileId>/<revision>/<name>`。
5. `revision = sha256(filter + 音效哈希).slice(0, 32)`，manifest 列出每个文件的 `sha256`/大小，写入 `revisions/` 与 `sync_status`。
6. 校验方案版本未在渲染期间变化；失败则记 `sync_status.error`，有上一版就返回 `stale` 版本。

## 12. 降级矩阵

| 情况 | 结果 |
|---|---|
| 行情缺失 / 过期 | 空快照 → 全部沿用 NeverSink 规则，warnings 提示 |
| 只有部分物品有价 | 有价的走光效/隐藏，其余不动，`unpricedItems` 计数 |
| 快照 league 与请求不一致 | 直接丢弃，按「缺失」处理 |
| 风格文件缺失 | 回落到同严格度 default 文件 |
| 四枚锚点任一缺价 | 所有 autoRange 价格档禁用（不生成半套区间） |
| 隐藏规则会藏掉 ≥1D 物品或白名单物品 | `passed = false`；订阅不发布，网页仍可下载但会红字警告 |
| 导出时自定义音效不在 `soundFiles` | 忽略该文件 |
| poe.ninja 返回非 divine 主币或结构异常 | 抛错 → 该赛季保留旧缓存；无缓存则空快照 |

## 13. 复现与排查

本地跑一次生成（dev server）：

```bash
npm run dev -- --port 3100
curl -s http://127.0.0.1:3100/api/generate \
  -H 'content-type: application/json' \
  -d '{"league":"Standard","strictness":3,"style":"default","locale":"cn"}' \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log(j.fileName);console.log(j.safetyReport)})"
```

导出的 ZIP 用 `POST /api/export`，带 `-F profile='<json>'`，可选 `-F sound:<presetId>=@custom.mp3`。

定位生成内容：

```bash
# 覆盖规则块（白名单 / 光效 / 隐藏）
grep -n '^Show # poe2-filter' generated.filter
grep -n '^Hide # poe2-filter' generated.filter
```

直接调函数（测试里的做法，把 TS 编成 CJS 再 require）：

```bash
node node_modules/typescript/bin/tsc lib/filter-engine.ts lib/catalog.ts lib/default-profile.ts \
  --outDir .tmp-engine --module commonjs --target es2021 --esModuleInterop --resolveJsonModule --skipLibCheck
node -e "const {generateFilter}=require('./.tmp-engine/lib/filter-engine.js');const {DEFAULT_PROFILE}=require('./.tmp-engine/lib/default-profile.js');console.log(generateFilter(DEFAULT_PROFILE).filterFile.length)"
rm -rf .tmp-engine
```

回归测试覆盖的不变量（`tests/currency-defaults.test.mjs`）：模板外观随风格变化、价格区间含下界不含上界、行情变化只重排自动档、缺锚点不生成半套价格、过期或错赛季快照被丢弃、白名单优先于隐藏、隐含高价值物品会让安全检查失败。

## 14. 已知限制

- 生成接口自身不做 `validateProfile`，保存/订阅才校验；绕过页面直接调 API 时结构错误只会表现为生成结果异常或 400。
- 价格匹配按名称精确匹配，poe.ninja 改名或中英对齐不一致的物品会落到「未定价」。
- 隐藏规则只按 `ItemLevel` 与价格阈值判断，不评估词缀价值；高价值判断完全依赖当日行情。
- 基线与模板音效来自 vendored 的 NeverSink 文件，升级供应商需要重新跑 `scripts/extract-neversink-appearances.mjs` 与 `npm run validate:data`。
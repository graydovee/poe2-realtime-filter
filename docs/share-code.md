# 分享码协议

| 文本前缀 | 读取端 | 写入端 |
| --- | --- | --- |
| `POE2F1` | 两段式 JSON，以及带 JSON 头的 `br/p1`、`br/p2`、`br/p3`、`poe2/p1`、`poe2/p2` | 只读取。 |
| `POE2F2` | 二进制帧，正文 `format=2`、`revision=1` 或 `revision=2`，支持 raw、Brotli 和 raw DEFLATE。协议头的物品目录版本省略或等于当前版本。 | 写 `format=2`、`revision=2` 和当前的物品目录版本，在 raw 和 Brotli 中选择完整码长较短的一种。 |

前缀区分外层帧。F1 的 `alg` 和 `p`、F2 的 `format` 和 `revision` 分别区分各自的正文布局。方案内容中的 `profile.schemaVersion` 由应用校验，独立于分享码版本。各文本段以 `.` 分隔，二进制段使用无填充的 Base64URL。解码时仅裁去整串的首尾空白。

## 应用接口

Rust 入口为 `share_code::encode(&Share) -> Result<String>` 和 `share_code::decode(&str) -> Result<DecodedShare>`。`Share` 包含字符串 `name`、字符串 `description` 和 JSON 值 `profile`。`decode` 解析和校验协议结构，调用方可读取 `DecodedShare.share` 检查内容，再用 `into_import()` 准备确认导入。F1 使用载荷里的规则 ID。F2 不带规则 ID，在确认导入时按规则顺序为每条规则分配方案内唯一的 8 位随机字母数字 ID。参见 [Rust 入口](../src-tauri/src/share_code.rs)。

| 桌面命令 | 行为 |
| --- | --- |
| `scheme_share(id)` | 复制方案的名称、描述和内容，将 `baseFilter` 换成名称提示 `baseFilterHint`，写入服务器，经方案校验后生成 F2。 |
| `inspect_share(code, server)` | 返回 `server`、`name`、`description`、`league`、`hasServer` 和目标服务器的赛季目录 `catalog`。码内没有服务器字段时使用调用方传入的服务器。此调用只读取分享信息。 |
| `scheme_import(code, server, league?, name?)` | 校验服务器与码内值一致（如有），按需校验并替换目标赛季，以可选名称覆写原名。经方案校验后连同描述保存为新方案，返回 `{ id, missing }`，其中 `missing` 为缺少的音效。每次导入都创建新方案。 |

分享内容包括方案名称、描述、方案设置、服务器、赛季 ID（`league` 和来源 `originalLeague`）、规则、跳过物品、基础过滤器名称提示和音效引用。导入会丢弃载荷里的 `baseFilter` 路径，按名称在游戏目录中查找唯一匹配项；没有时再查基础过滤器表里方案包导入的副本。缺失或多项同名时保留提示，供接收方重新选择。

分享码带规则、方案设置、名称和描述，每次导入都创建新方案。要连同基础过滤器和音效一起分享，使用[方案包](scheme-package.md)：它带方案 ID，同一个包再次导入时按 ID 更新。参见 [桌面命令](../src-tauri/src/main.rs)、[方案存储](../src-tauri/src/store.rs)和[方案校验](../lib/profile-validation.ts)。

## POE2F1

### 文本帧和载荷

两段式 `POE2F1.<base64url(json)>` 直接携带 UTF-8 JSON，顶层结构为 `{"name":"…","profile":{…}}`。

三段式 `POE2F1.<header>.<payload>` 的头和载荷各自做 Base64URL 编码。头是 `{"alg":"br","p":1}` 这样的 JSON。`alg`（非空字符串）和 `p`（非零 `u32`）必填，JSON 对象中的额外或重复字段会使头无效。解出的载荷为 `CRC32_LE | Brotli(正文)`，`br` 和 `poe2` 两种 `alg` 均使用此封装。CRC 是未压缩正文的 IEEE CRC32，以 4 字节小端存放。

| `alg` | `p` | 解压后的正文 |
| --- | --- | --- |
| `br` | `1` | 完整的 `Share` JSON。 |
| `br` | `2` | `Share` JSON，要求 `profile.server` 是 `international` 或 `tencent`。 |
| `br` | `3` | `Share` JSON，要求 `profile.schemaVersion == 3`。可省略 `profile.server`，存在时校验服务器值。 |
| `poe2` | `1` | 下述目录打包正文。 |
| `poe2` | `2` | 1 字节服务器值（`0` 国际服、`1` 腾讯服），随后是与 `p=1` 一致的打包正文。解包后把服务器写入 `profile.server`。 |

### `poe2` 目录打包正文

正文为 `u32_LE(元数据字节数) | UTF-8 JSON 元数据 | 物品列表字节`。元数据是 `[name, packedProfile]`。打包对象使用 JSON 数组，首位是字段位图整数，随后按字段顺序写出存在的值。字段顺序以 `Layout` 为准。列表描述符 `[mode, count, reference, size]` 放在对应字段里，按规则顺序读取各段 `size` 字节，最后读跳过物品。`reference` 是从 0 开始的先前列表索引，模式 `0` 和 `1` 的 `reference` 必须为 `0`。参见[正文实现](../src-tauri/src/share_code/v1/poe2.rs)。

| `mode` | 列表字节的含义 |
| --- | --- |
| `0` | 目录索引的有符号差值，起点为 `0`，用 ZigZag varint 保存。保留顺序与重复项。 |
| `1` | 冻结目录的位图，按索引从小到大取置位项。 |
| `2` | 引用并复制一个先前列表，`size` 为 `0`。 |
| `3` | 保留先前列表中的指定位置，位置用无符号差值保存。 |
| `4` | 排除先前列表中的指定位置，位置用无符号差值保存。 |
| `5` | 对先前列表的位置使用位图，保留置位项。 |

位图以低位对应较小索引，长度为索引域大小除以 8 向上取整，末字节剩余位必须为 0。差值模式的 varint 使用最短表示，最多 3 字节。模式 `3`、`4` 从位置 `0` 累加差值，首项之后严格递增。解出列表长度必须等于 `count`，所有列表数据都要读完。

F1 `poe2` 两个档位共用 **1,417 项冻结目录**。从 0 开始的行号就是物品索引，条目与顺序固定。F1 普通 JSON 直接保存字符串物品 ID。参见[冻结目录](../src-tauri/src/share_code/v1/poe2-p1-items.txt)。

## POE2F2

### 二进制帧

```text
POE2F2.<base64url(uvarint(头字节数) | ShareHeader | CRC32_LE | payload)>
```

`ShareHeader` 采用 protobuf 线格式。四个字段都使用线类型 `0`（varint），前三个必须显式存在且最终值非零。读端允许字段任意排列，重复的已知标量取最后一个值。其他字段，以及已知字段号上的其他线类型，按 `0`（varint）、`1`（fixed64）、`2`（length-delimited）、`5`（fixed32）跳过。字段号需在 `1..=2^29−1` 范围内，组类型和截断字段视为头损坏。参见 [share_header.proto](../src-tauri/src/share_code/share_header.proto)和[帧实现](../src-tauri/src/share_code/v2/frame.rs)。

| 字段号 | 名称 | 支持的值 |
| --- | --- | --- |
| `1` | `format` | `2`，按位置编码元数据和物品列表。 |
| `2` | `revision` | `1` 或 `2`，各对应下面的正文布局。 |
| `3` | `compression` | `1` raw（未压缩），`2` Brotli，`3` raw DEFLATE（RFC 1951）。 |
| `4` | `catalog_version` | 物品目录版本，非零的正整数。可以省略，省略表示 `1`。 |

写入的帧按字段号 `1`、`2`、`3`、`4` 写头。例如 raw 帧的长度和头依次为 `08 08 02 10 02 18 01 20 01`（十六进制）。CRC 字段是 4 字节小端 IEEE CRC32，对未压缩正文计算。压缩流必须完整结束并消耗全部 `payload`。raw DEFLATE 直接使用 RFC 1951 数据流。写入端比较 raw 和 Brotli（`quality=11`、`lgwin=16`）的完整分享码字符数，同长时选 raw。压缩标签只记录算法。

### 正文格式 `2`，修订 `1`

```text
uvarint(元数据字节数) | 元数据 | 跳过物品 | 第 1 条规则物品列表 | …
元数据 = 方案名称字符串 | 方案设置记录 | uvarint(规则数) | 各规则记录
```

元数据中的每条记录（包括嵌套对象）以 **1 字节字段位图**起始。第 `i` 位表示 schema 中从 0 起的第 `i` 个字段是否存在，其值按声明顺序编码。读端拒绝未定义的位。方案设置从 `server`、`baseFilterHint` 到 `locale` 共 8 位。规则记录依次为 `name`、`enabled`、`hidden`、`baselineEffectItemId`、`effectPresetId`、`target`、`effects`。包括子对象、枚举值顺序和音效字段在内的完整定义见 [metadata/schema.rs](../src-tauri/src/share_code/v2/positional/metadata/schema.rs)。

| 值类型 | 编码方式 |
| --- | --- |
| 布尔 | 单字节 `0` 或 `1`。 |
| 非负整型、计数、长度、枚举 | `u32`，使用最短形式的无符号 LEB128。枚举为 schema 中从 0 起的索引。 |
| 字符串 | 字节数，再写对应长度的 UTF-8。 |
| 价格、音量 | JSON 非负整数 `n` 写 `uvarint(n+1)`，其他有限非负数写 `0`，再写 8 字节小端 `f64`。整数加 1 的结果须在 `u64` 范围内。 |
| 数组 | 元素数，再顺序写入各元素。掉落条件的 `bounds` 最多 2 项。 |
| 音效 | 先写类型编号 `0` builtin、`1` neversink、`2` baseline、`3` custom，再写对应位图记录。基础音效的 `fallback` 直接写 builtin 记录，类型编号隐含为 `0`。 |

跟随基础特效的规则仅保存来源物品 `baselineEffectItemId`，固定特效则可携带预设、颜色、光柱、图标、字号和音效。读取端拒绝同时携带来源物品与固定特效字段的记录。每条规则都需要 `target` 记录，即使其中的其他字段为空。`target.itemIds` 和 `skippedItemIds` 存在元数据之后，规则顺序保留，物品列表按集合处理。

### 正文格式 `2`，修订 `2`

```text
元数据 = 方案名称字符串 | 描述字符串 | 方案设置记录 | uvarint(规则数) | 各规则记录
```

方案名称之后多一个描述字符串，没有描述时写空串。其余与修订 `1` 相同。

### 物品列表和目录地址

每个列表以 `uvarint((value << 2) | mode)` 开始。列表索引 `0` 对应跳过物品，后续索引按规则顺序分配。

| `mode` | `value` | 内容 |
| --- | --- | --- |
| `0` | 槽位区字节数 | 依次存放各物品组的槽位块。空列表的标签为 `0`。 |
| `1` | 先前列表索引 | 复用同一正文内已经展开的列表。 |
| `2` | 整选区字节数 | 依次存放各整选子树的路径。 |
| `3` | 混合区字节数 | `uvarint(整选区字节数) \| 整选路径 \| 槽位块`。 |

路径每级用一个字节。高位 `0x80` 表示还有下一级，低七位 `0–125` 是当前父节点下的同级序号。序号 `126` 及以上先写低七位 `0x7E`，再写 `uvarint(序号−126)`。例如 `[0, 0]` 为十六进制 `80 00`。单独的 `0x7F` 表示根。`0xFF` 只能用于槽位块，表示选择器未展示的合法 ID 所在组。

槽位块为 `路径 | uvarint((数据字节数 << 2) | mode) | 数据`，块按目录组号严格递增。模式 `0` 为固定前缀 `[0, upper)`，写 `upper`。模式 `1` 再写排除项数和排除槽位。模式 `2` 写区间数，再逐个写「起点与上段终点的差值、区间长度」，初始终点为 `0`。模式 `3` 写项数和槽位差值。模式 `1` 和 `3` 的槽位差值起点是 `0`，每项将下一起点设为当前槽位加 `1`。参见 [列表实现](../src-tauri/src/share_code/v2/positional/items.rs)。

写端按当前地址排序去重，并识别已全部选中的子树。整选路径展开为**接收方目录里该子树地址表上仍然存在的物品**：物品改类后旧地址仍留在原来的分类里，旧分享码整选那个分类时展开的还是原来那些物品；分类里后来新加的物品也在整选范围内。如果整个子树已无可用物品，导入报错。槽位块按稳定地址恢复所选的物品。物品改类后在新分类取得地址，原地址仍解析为同一 ID。已退役的槽位占据原号，选中时报告无法还原。多个地址解析为同一 ID 时去重。

F2 读取桌面引擎 `shareCatalog` 投影。`data/item-catalog.json` 的 `shareTree` 存各父节点下的序号，`shareGroups` 存组号与槽位。新增分类和槽位只追加，已有路径、地址和退役记录保持有效。手动更新目录或掉落数据后，运行 `node scripts/sync-share-addresses.mjs` 同步地址，再运行 `npm run validate:data` 检查。参见[物品目录](../data/item-catalog.json)和[目录投影](../lib/catalog-view.ts)。

### 物品目录版本

物品按分类号和槽位引用，地址只在同一个物品目录版本内有效。`data/item-catalog.json` 顶层的 `catalogVersion` 是当前的版本，写入端把它放进协议头的 `catalog_version`，读取端要求它和自己的版本相同。

| 分享码里的版本 | 读取结果 |
| --- | --- |
| 省略，或等于当前版本 | 正常读取。省略这个字段的码来自还没有它的客户端，它们都使用第 1 版目录。 |
| 大于当前版本 | 报「分享码来自第 N 版物品目录，当前客户端使用第 M 版，请升级客户端」。 |
| 小于当前版本 | 报「分享码来自第 N 版物品目录，当前客户端使用第 M 版，无法还原其中的物品，请让分享者用新版客户端重新导出」。 |

新增物品、物品改类、物品退役都沿用已有地址，不改版本。只有旧的地址无法继续沿用时（例如槽位重排，或者某个 ID 改指另一件物品），才把 `catalogVersion` 加一，同时给写入端分配新的正文 `revision`：不读取 `catalog_version` 的客户端会跳过它，只能靠不认识的正文版本提示升级。

## 限额与错误

| 检查项 | 上限或约束 |
| --- | --- |
| 协议头 | F1 三段式 JSON 头和 F2 二进制头均为 128 字节。 |
| 帧或封装载荷 | F1 三段式的解码载荷（含 CRC）、F2 的整个解码帧均为 `1 MiB + 4,096` 字节。Base64URL 字符串解码前也检查长度。 |
| 正文与展开 | F1 两段式 JSON 与 F1/F2 的未压缩正文均为 `1 MiB`。F1 `poe2`、F2 还限制展开后的方案 JSON，F2 确认导入生成规则 ID 后再次检查。 |
| 规则和物品 | 每方案最多 100 条规则，每条规则最多 2,000 件选中物品，跳过物品最多 5,000 件。F1 `poe2` 和 F2 在解包时检查列表展开，包括引用。普通 JSON 的规则与物品上限在方案校验时检查。 |

- 未知前缀报告「不支持的分享码版本」。F1 的未知 `alg/p` 或 F2 的未知 `format/revision/compression` 提示升级。无效编码和损坏的头分别报告「分享码不是有效的 Base64URL」和「分享码协议头无效」。
- Base64URL 解码前后超限报告「分享码过大」。F1 三段式或 F2 的未压缩正文超限报告「分享码解压后过大」。CRC 字段截断、压缩流损坏、CRC 不符分别报告「分享码压缩数据不完整」「分享码压缩数据损坏」「分享码校验失败」。
- 正文解析拒绝越界长度、无效位图、错误列表引用和尾随字节。未知目录路径或槽位提示升级，已退役槽位或空的整选分类给出目录相关错误。分享码的物品目录版本与当前客户端不一致时，按「物品目录版本」里的两种情况提示升级或重新导出。通过协议校验后，方案校验仍可能报告无效规则、赛季、特效或其他应用字段。

## 新增协议版本

| 入口 | 职责 |
| --- | --- |
| [share_code.rs](../src-tauri/src/share_code.rs) | `ShareDecoder` 和 `ShareEncoder` 分开。`DECODERS` 按文本前缀选读端，`EXPORT_CODEC` 选写入端。 |
| [v1.rs](../src-tauri/src/share_code/v1.rs) | F1 读取。目录打包正文和固定目录在 `v1/`。 |
| [v2.rs](../src-tauri/src/share_code/v2.rs) | `BODY_CODECS` 按 `(format, revision)` 选正文读端，`EXPORT_BODY` 选正文写入端。二进制帧由 `v2/frame.rs` 处理，`v2/positional.rs` 与其子模块定义正文。 |
| [compression.rs](../src-tauri/src/share_code/compression.rs) | 公用的 CRC 与压缩处理。 |

1. 沿用 F2 帧时，为布局变更分配新正文 `revision`，新的序列化家族使用新 `format`。把新正文读端登记在 `BODY_CODECS`，已发布的条目、字段位图、枚举编号和目录语义保持不变。可跳过的头扩展使用新 protobuf 字段号。新增压缩算法时同步更新 `.proto` 和压缩层。
2. 外层帧有不兼容变更时，分配新前缀，实现 `ShareDecoder` 并加入 `DECODERS`。需要对外生成的新版本同时实现写端。发布时按变更范围切换 `EXPORT_BODY` 或 `EXPORT_CODEC`，读取注册表包含全部已发布版本。
3. 为新版本增加固定字节向量、往返、导入和错误边界用例。用例覆盖 F1 的全部读法、F2 的三种压缩帧和目录增量。更新本文及相关 schema。参见 [F1 夹具](../src-tauri/src/share_code/v1/tests.rs)、[F2 夹具](../src-tauri/src/share_code/v2/tests.rs)和[目录兼容测试](../tests/share-code.test.mjs)。
4. 物品目录的旧地址无法继续沿用时，把 `catalogVersion` 加一，并按第 1 步给写入端分配新的正文 `revision`，见「物品目录版本」。

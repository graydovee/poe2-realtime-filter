# PoE2 Realtime Filter

Windows x64 单机过滤器客户端，提供本地方案管理与过滤器制作。内置 NeverSink 基础过滤器和物品目录，从 poe.ninja 获取赛季行情。可以离线编辑、保存、分享和预览本地方案。

[下载 Windows 安装包](https://github.com/graydovee/poe2-realtime-filter/releases/latest)

## 使用

1. 在「我的方案」新建方案，或粘贴 `POE2F1.` 分享码导入。自定义音效缺失时，可在规则编辑器里补齐。
2. 在制作页调整赛季、严格度、外观和规则，点击「预览」检查结果，再保存方案。回到「我的方案」点击「安装到游戏」，然后在 PoE2 里选择同名过滤器。
3. 从「更多」可以重命名、下载含音效的 ZIP、复制分享码或删除方案。卸载只移除游戏过滤器，保留方案。删除方案时默认保留游戏文件。
4. 已安装方案默认每 30 分钟刷新。关闭窗口后托盘会继续运行，右键托盘图标可彻底退出。行情暂不可用时保留上次成功安装的过滤器。
5. 版本号旁出现「更新」时可以下载新版，签名验证通过后选择「安装并重启」。旧版 v0.4.x 用户首次请手动安装。

本地方案、设置和缓存存放在客户端安装目录的 `data` 子目录。从 v0.5.1 或更早版本更新时，客户端从新的方案库开始，原用户目录数据留在原处。过滤器默认写入 Windows 文档目录下的 `My Games\Path of Exile 2`。可在「过滤器目录」修改新安装位置，已安装的过滤器继续使用各自的原目录。

未知物品沿用 NeverSink 基础规则。可以将物品加入跳过名单，避免被自定义规则覆盖。

## 开发与发布

需要 Node.js 22、Rust stable、Visual Studio C++ Build Tools 和 WebView2。

```powershell
npm ci
npm test
npm run build:engine
cargo test --locked --manifest-path src-tauri/Cargo.toml
npm run tauri dev
```

将 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock` 和 `src-tauri/tauri.conf.json` 中的版本同步后打 `vX.Y.Z` 标签。Windows GitHub Actions 使用 `TAURI_SIGNING_PRIVATE_KEY` 和 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 创建签名安装包和 `latest.json`。

## 物品数据与特效

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

更新 NeverSink 或客户端数据后，如果新物品没有分组归属，`validate:data` 和 `tests/item-taxonomy.test.mjs` 会直接失败并点名。

### 特效预设集合

规则编辑器里的「完整特效预设」来自 vendored 基线的实测值，由脚本抽取、离线生成：

```bash
node scripts/extract-neversink-effects.mjs
```

- 产物一 `data/neversink-effects.json`：按视觉风格分组的外观预设，一个预设 = 光柱 + 地图图标 + 字体（字号 + 三色）+ 音效，default / aura / cobalt / customsounds / darkmode / mythic / vaal / zen 分别是 104 / 99 / 96 / 104 / 101 / 61 / 99 / 87 种。
- 产物二 `data/default-rules.json`：4 条默认价格规则，`effectPresetId` 指向前者里的一个预设，`effects` 与预设完全一致（取自 default 风格 2-SEMI-STRICT 里对应通货的原始规则）。
- 选择预设后四项一起填好，仍可逐项改；改完规则会标记为「自定义」，生成器只读具体值，不依赖预设数据。
- 规则卡片上有「播放音效」按钮：模板音效直接播放 `vendor/neversink` 里的同一个 mp3；内置音效（`PlayAlertSound 1–16`）播放 `public/sounds/alert-sound-N.ogg`（从游戏 `FMOD/Desktop/Four_ItemFilter.bank` 导出，见 [public/sounds/README.md](public/sounds/README.md)），缺失时按钮置灰。

wiki 侧的分类与三语对照方法参考同组织的 [poe2-skills](https://git.graydove.cn/graydove/poe2-skills) 中的 `poe2-wiki-search` skill。

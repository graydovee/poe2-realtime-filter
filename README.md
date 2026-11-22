# PoE2 Realtime Filter

面向《流放之路 2》的 Windows x64 掉落过滤器编辑器。选择一个基础过滤器，然后按赛季行情、物品分类或指定物品设置显示规则。客户端可以定时读取 poe.ninja 的行情，并重新生成游戏中已安装的过滤器。

[从 GitHub Releases 下载 Windows 安装包](https://github.com/graydovee/poe2-realtime-filter/releases/latest)

## 安装与更新

从发布页下载 `poe2-realtime-filter-windows-x64-vX.Y.Z-setup.exe` 并运行。安装器会复用系统已有的 Microsoft Edge WebView2。如果系统缺少 WebView2，安装器会联网从微软下载并安装运行时。

客户端启动时检查更新。版本号旁出现「更新」时，点击下载，等签名校验通过后选择「安装并重启」。

## 制作第一个过滤器

1. 打开客户端，在「我的方案」里点击「新建方案」，选择你正在玩的赛季。
2. 选一个基础过滤器。已有 `.filter` 时，可以用「扫描游戏目录」或「选择本地文件」。也可以点击「下载过滤器」，从 NeverSink 的可用档位和风格里挑选。客户端会记住所选下载版本，直到你手动更换。
3. 调整规则。新方案自带崇高石、混沌石、剥离石和神圣石四档价格规则。启用「跟随基础过滤器」的规则会尝试继承对应通货的颜色、光柱、小地图图标和音效等特效。手动修改特效后，该规则使用你设置的样式。
4. 点击「预览」查看生成结果和安全检查，再点「保存方案」并填写方案名。回到「我的方案」，点「安装到游戏」生成过滤器。进入 PoE2，在游戏设置中选中以方案名命名的过滤器。

默认安装到 Windows 文档目录下的 `My Games\Path of Exile 2`。可以在「方案管理 → 过滤器目录」指定其他目录。已有安装仍使用原目录，如需搬到新目录，先卸载过滤器，再重新安装。

未知物品沿用基础过滤器的规则。把指定物品加入「跳过名单」，也可以让它们沿用基础过滤器。

## 行情与自动刷新

- 在「方案管理」选择赛季并点击「刷新行情」，可以立即获取该赛季的报价。价格规则按当前赛季的行情换算成崇高石比较，价格数据需要联网获取。
- 自动刷新只处理已安装且开启「自动刷新」的方案，默认每 30 分钟运行一次。同赛季的方案共用一份行情。可以在「刷新设置」里调整间隔或暂停后台刷新。
- 关闭窗口后，托盘中的客户端会继续刷新。从托盘菜单退出即可停止。行情请求失败、所需文件缺失或安全检查未通过时，游戏继续使用上一次成功生成的文件。

## 分享、备份与管理

| 要做什么 | 在哪里操作 |
| --- | --- |
| 分享可编辑的规则 | 在方案的「更多 → 分享码」复制。接收者在「导入分享码」粘贴并创建方案，再选择基础过滤器，按提示补齐自定义音效。 |
| 获取可直接使用的过滤器 | 「更多 → 下载」保存 ZIP，内含 `.filter` 和需要随包分发的音效。解压到游戏过滤器目录，并保留压缩包内的目录结构。 |
| 修改游戏里的过滤器名称 | 「更多 → 重命名」同步调整方案名和已安装的过滤器文件名。遇到重名或外部文件冲突时，客户端会提示处理。 |
| 停止使用某个过滤器 | 点击「卸载过滤器」移除游戏中的 `.filter` 并保留方案。通过「更多 → 删除」删除方案时，默认保留游戏中的文件。 |

方案、设置、音效和缓存存放在安装目录的 `data` 子目录。重装或换电脑前可以备份整个 `data` 目录。选用本地 `.filter` 作为基础过滤器时，还要备份原文件及其依赖。恢复后如果文件路径变了，在编辑页重新选择基础过滤器。

## 本地开发

客户端使用 Tauri 2、Rust 和 React，编辑器与后台刷新共用 TypeScript 过滤器生成逻辑。Windows 开发环境需要 Node.js 22、Rust stable、带 C++ 工作负载的 Visual Studio Build Tools 和 WebView2。

```powershell
npm ci
rustup target add x86_64-pc-windows-msvc
npm run tauri -- dev
```

运行测试并构建本地验收安装包：

```powershell
npm test
npm run build:engine
cargo test --locked --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc
npm run tauri -- build --ci --no-sign --target x86_64-pc-windows-msvc -- --locked
```

安装包生成在 `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/`。正式发布由 `vX.Y.Z` 标签触发，GitHub Actions 构建带更新签名的安装包，并生成指向同一个安装包的 `latest.json`。参见 [Windows 发布工作流](.github/workflows/release.yml)。

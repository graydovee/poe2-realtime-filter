# poe2-filter Windows client

Rust + [eframe/egui](https://github.com/emilk/egui) 托盘客户端：粘贴网站生成的只读订阅链接，定时拉取最新过滤器与音效写入游戏目录，关闭窗口后留在托盘继续同步。

界面与网页共用同一套设计 token（深炭底、古铜金描边、羊皮纸文字），色值定义在 `src/theme.rs`，与 `app/globals.css` 的 `:root` 一一对应。

- 托盘菜单：打开窗口 / 全部更新 / 全部暂停恢复 / 退出；双击托盘图标恢复窗口。
- 单实例运行；订阅密钥用 DPAPI 加密后保存在 `%LOCALAPPDATA%\poe2-filter\settings.json`。
- 标题字体 [Cinzel](https://github.com/NDISCOVER/Cinzel) 以 OFL 授权随程序分发（`assets/fonts/Cinzel.ttf` + `OFL.txt`），中文由系统字体回退渲染。

## 本地构建

```powershell
cargo test --target x86_64-pc-windows-msvc
cargo build --release --target x86_64-pc-windows-msvc
.\target\x86_64-pc-windows-msvc\release\poe2-filter-client.exe --diagnostics
```

客户端通过 Windows Known Folder API 定位 `%USERPROFILE%\Documents\My Games\Path of Exile 2`。在网站生成只读订阅链接后，选择目录并点击「添加方案」即可。

## 命令行

- `--diagnostics`：打印架构、过滤器目录、状态目录与版本。
- `--once <链接> [--directory <目录>] [--state-dir <目录>] [--output <文件>]`：单次同步，输出 JSON。
- `--tray`：启动时不显示窗口，只留在托盘。

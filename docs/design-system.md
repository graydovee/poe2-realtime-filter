# 设计系统

网页端使用一套深色奇幻 token，风格参考「流放之路 2」：暖黑底、古铜金描边、羊皮纸文字、克制的血焰强调色。少色、少阴影、强对比、足够留白。

## Token

定义在 `app/globals.css` 的 `:root`（`--color-*`，RGB 三元组，供 Tailwind 的 `rgb(var(--color-x) / <alpha-value>)` 使用），并通过 `tailwind.config.ts` 映射成 `bg-surface`、`text-ink`、`border-line` 这类工具类。

| 语义 | Token | 值 |
|---|---|---|
| 背景 | `--color-bg` | 10 8 6 |
| 面板 | `--color-surface` | 19 16 12 |
| 面板 2 | `--color-surface-2` | 25 21 16 |
| 面板 3 | `--color-surface-3` | 34 28 21 |
| 描边 | `--color-line` | 43 36 26 |
| 描边-强 | `--color-line-strong` | 61 50 35 |
| 文字 | `--color-ink` | 232 220 196 |
| 次要文字 | `--color-ink-muted` | 154 139 114 |
| 金色 | `--color-gold` | 200 164 92 |
| 金色-亮 / 按下 | `--color-gold-bright` / `--color-gold-press` | 228 197 127 / 168 133 63 |
| 血焰 | `--color-ember` | 180 67 42 |
| 暖绿 | `--color-sage` | 127 168 107 |
| 稀有度（普通/魔法/稀有/传奇） | `--color-rarity-*` | 200 200 200 / 136 136 255 / 255 255 119 / 175 96 37 |

稀有度使用游戏官方配色，让白名单与掉落预览和游戏内观感一致。

## 排版

- 展示体 `Cinzel`（OFL）：品牌、页面主标题、步骤号、指标数字。
- 正文 `Inter`（OFL）+ 中文系统栈：`PingFang SC` / `Microsoft YaHei UI` / `Noto Sans SC`。
- 等宽 `JetBrains Mono`（OFL）：价格、汇率、修订号、过滤器代码。
- 三种字体都由 `@fontsource/*` 自托管并在 `app/layout.tsx` 引入，不请求任何外部字体 CDN。
- 字号阶梯 11 / 12 / 13 / 15 / 18 / 24（大标题 `clamp(1.5rem, 3vw, 2rem)`）。

## 形状、层级与动效

- 圆角：控件 4px、卡片 6px、空态容器 10px。
- 卡片 = 1px `line` 描边 + `inset 0 1px 0 rgba(255,255,255,.04)` 顶部高光 + `0 10px 26px rgba(0,0,0,.45)` 投影。
- 背景仅两层极淡径向暗角（`.app-vignette`），不使用彩色光斑。
- 动效 120–180ms `ease-out`，只动 transform / opacity / border-color；`prefers-reduced-motion` 全部关闭。
- 焦点环 2px 金色 45% 透明；所有可点击元素保留可见焦点。

## 组件层

- `app/components/ui/primitives.tsx`：Panel / Button / Badge / Chip / Field / Divider / Alert / Skeleton / EmptyState / Mono / StatusDot
- `app/components/ui/controls.tsx`：Select / Checkbox / Switch / Slider / TextInput / SearchInput / FileInput（Radix 无样式原语 + CVA 变体）
- `app/components/ui/nav.tsx`：TabBar / Disclosure / Tooltip / ScrollArea
- `app/components/app-shell.tsx`：品牌头、标题区、页脚
- `app/components/sections/`：season / basic-filter / whitelist / presets / visuals / summary-sidebar
- `app/components/`：`item-picker`、`preset-editor`、`save-as-scheme`、`preview-view`

白名单选择器（`item-picker`）的交互约定：

- 分类菜单按「玩法 → 材料种类 → 物品」排序，玩法顺序来自 `data/item-mechanics.json`（基础通货、深渊、探险、裂痕、仪式、迷雾、神庙、试炼），其余分组保持原有插入顺序，整类匹配排在最后。
- 每张分类卡片右侧是独立的整类勾选按钮（`role="checkbox"`，支持 `aria-checked="mixed"` 的半选态）；点卡片主体进入下一级，点勾选框整选/取消该分类下的全部物品。
- 当前分类顶部有一条汇总条（本类 N 项 / 已选 M）与「选择本类 / 取消本类」，适合一次性把整套装备槽位或整个玩法拉进白名单。
- 已选区按条目展示：整类条目显示为「深渊 · 19 项」，单件显示物品名，都可以整条移除。

`app/page.tsx` 只保留状态与数据流，不写样式实现细节。

### 复合组件（方案管理）

`app/components/scheme-manager.tsx` 与预览页的保存入口沿用既有结构（避免改动已上线的方案/订阅逻辑），其样式由 `app/globals.css` 末尾的复合组件样式层提供；该层通过一组 legacy 变量别名（`--surface`、`--border`、`--cyan` 等）映射到同一套调色板，因此视觉与 Tailwind 组件一致。

> Tailwind 的 preflight 被关闭（`corePlugins.preflight = false`），以免重置影响这些复合组件；`app/globals.css` 的 `@layer base` 里只保留必要的底色、按钮归零与滚动条样式。

## 截图

- `docs/screenshots/builder-1440.png`：配置页（1440）
- `docs/screenshots/builder-1024.png`：配置页（1024）
- `docs/screenshots/builder-430.png`：配置页（移动端）
- `docs/screenshots/preview-1440.png`：预览与导出页
- `docs/screenshots/whitelist-mechanics-1440.png`：白名单的玩法分类（通货与材料）
- `docs/screenshots/whitelist-mechanics-selected-1440.png`：整类勾选深渊后的已选条目
- `docs/screenshots/whitelist-mechanics-430.png`：玩法分类（移动端）

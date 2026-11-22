# 设计系统

Windows 客户端使用深色调色板。炭灰底区分页面、卡片与输入框，暖白用于文字，暖金标记选中状态和主要操作。

## Token

定义在 `app/globals.css` 的 `:root`（`--color-*`，RGB 三元组，供 Tailwind 的 `rgb(var(--color-x) / <alpha-value>)` 使用），并通过 `tailwind.config.ts` 映射成 `bg-surface`、`text-ink`、`border-line` 这类工具类。

| 语义 | Token | 值 |
|---|---|---|
| 背景 | `--color-bg` | 18 18 20 |
| 面板 | `--color-surface` | 25 25 28 |
| 面板 2 | `--color-surface-2` | 33 33 37 |
| 面板 3 | `--color-surface-3` | 41 41 46 |
| 描边 | `--color-line` | 61 60 66 |
| 描边-强 | `--color-line-strong` | 119 116 124 |
| 文字 | `--color-ink` | 247 242 233 |
| 次要文字 | `--color-ink-muted` | 196 190 181 |
| 金色 | `--color-gold` | 231 194 120 |
| 金色-亮 / 按下 | `--color-gold-bright` / `--color-gold-press` | 250 216 150 / 209 168 93 |
| 血焰 | `--color-ember` | 255 158 148 |
| 暖绿 | `--color-sage` | 161 210 149 |
| 稀有度（普通/魔法/稀有/传奇） | `--color-rarity-*` | 200 200 200 / 136 136 255 / 255 255 119 / 175 96 37 |

稀有度使用游戏官方配色，让物品选择器和掉落预览使用与游戏一致的配色。

## 排版

- 展示体 `Cinzel`（OFL）：品牌标识。
- 正文 `Inter`（OFL）+ 中文系统栈：`PingFang SC` / `Microsoft YaHei UI` / `Noto Sans SC`。
- 等宽 `JetBrains Mono`（OFL）：价格、汇率、修订号、过滤器代码。
- 三种字体由 `@fontsource/*` 提供，通过 `app/layout.tsx` 打包进客户端。
- 界面字号以 12 至 16px 为主（大标题 `clamp(1.5rem, 3vw, 2rem)`）。

## 形状、层级与动效

- 圆角：控件 6px、卡片 10px。
- 卡片 = 1px `line` 描边 + `0 10px 26px rgba(0,0,0,.22)` 投影。
- 标题区使用淡暖色背景渐变（`.app-vignette`）。
- 动效 120–180ms `ease-out`，只动 transform / opacity / border-color；`prefers-reduced-motion` 全部关闭。
- 键盘焦点使用 2px 亮金描边。设置项使用切换开关，开关圆点在轨道中垂直居中。禁用开关用虚线边框区分，状态说明保持正常对比度。

## 组件层

- `app/components/ui/primitives.tsx`：Panel / Button / Badge / Chip / Field / Divider / Alert / Skeleton / EmptyState / Mono / StatusDot
- `app/components/ui/controls.tsx`：Select / Switch / Slider / TextInput / SearchInput / FileInput（Radix 无样式原语 + CVA 变体）
- `app/components/ui/nav.tsx`：Disclosure / Tooltip / ScrollArea
- `app/components/app-shell.tsx`：品牌头、标题区、页脚
- `app/components/sections/`：season / basic-filter / excluded-items / rules
- `app/components/`：`item-picker`、`rule-editor`、`scheme-manager`、`preview-view`

自定义规则编辑器（`rule-editor`）的交互约定：

- 每条规则由匹配条件、特效和隐藏开关组成。可以按物品、价格或两项同时筛选。
- 「完整特效预设」一次应用光柱、地图图标、字体和音效。展开「自定义外观」可以调整单项特效。
- 规则卡片常驻「实时预览」：光柱、标签配色、地图图标随任意字段改动立即刷新；逐项编辑字段默认折叠在「自定义外观」里，需要微调时再展开。
- 用开关设置物品是否隐藏，用卡片的上下箭头调整规则优先级。

物品选择器（`item-picker`）的交互约定：

- 分类菜单按 poe.ninja 经济侧栏的顺序排列（基础通货、碎片、深渊骨骸、精华、预兆、探险、液化情绪、催化剂、维金，然后是自定义的神庙与试炼钥匙），顺序写在 `data/item-mechanics.json` 的 `order` 字段；其余分支保持原有插入顺序，整类匹配排在最后。
- 点击分类卡片进入下一级，点击右侧的选择按钮可选中或取消整类物品。按钮使用 `aria-pressed="mixed"` 表示部分选中。
- 当前分类顶部有一条汇总条（本类 N 项 / 已选 M）与「选择本类 / 取消本类」，适合一次性把整套装备槽位或整个玩法拉进规则或跳过名单。
- 已选区按条目展示：整类条目显示为「深渊骨骸 · 11 项」，单件显示物品名，都可以整条移除。

`app/page.tsx` 组织方案管理、编辑与预览之间的状态和数据流。

### 复合组件（方案管理）

`app/components/scheme-manager.tsx` 使用同一套 Panel、Button、TextInput 组件呈现本地方案、分享码和后台刷新设置。

> Tailwind 的 preflight 被关闭（`corePlugins.preflight = false`），以免重置影响这些复合组件；`app/globals.css` 的 `@layer base` 里只保留必要的底色、按钮归零与滚动条样式。

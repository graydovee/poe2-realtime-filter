# 设计系统

网页和 Windows 客户端使用同一套深色调色板。炭灰底区分页面、卡片与输入框，暖白用于文字，暖金标记选中状态和主要操作。

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

稀有度使用游戏官方配色，让白名单与掉落预览和游戏内观感一致。

## 排版

- 展示体 `Cinzel`（OFL）：品牌标识。
- 正文 `Inter`（OFL）+ 中文系统栈：`PingFang SC` / `Microsoft YaHei UI` / `Noto Sans SC`。
- 等宽 `JetBrains Mono`（OFL）：价格、汇率、修订号、过滤器代码。
- 三种字体都由 `@fontsource/*` 自托管并在 `app/layout.tsx` 引入，不请求任何外部字体 CDN。
- 界面字号以 12 至 16px 为主（大标题 `clamp(1.5rem, 3vw, 2rem)`）。

## 形状、层级与动效

- 圆角：控件 6px、卡片 10px。
- 卡片 = 1px `line` 描边 + `0 10px 26px rgba(0,0,0,.22)` 投影。
- 网页背景在标题区保留一层淡暖色渐变（`.app-vignette`）。
- 动效 120–180ms `ease-out`，只动 transform / opacity / border-color；`prefers-reduced-motion` 全部关闭。
- 键盘焦点使用 2px 亮金描边。复选框统一为 18px，开关圆点在轨道中垂直居中。禁用开关用虚线边框区分，状态说明保持正常对比度。

## 组件层

- `app/components/ui/primitives.tsx`：Panel / Button / Badge / Chip / Field / Divider / Alert / Skeleton / EmptyState / Mono / StatusDot
- `app/components/ui/controls.tsx`：Select / Checkbox / Switch / Slider / TextInput / SearchInput / FileInput（Radix 无样式原语 + CVA 变体）
- `app/components/ui/nav.tsx`：TabBar / Disclosure / Tooltip / ScrollArea
- `app/components/app-shell.tsx`：品牌头、标题区、页脚
- `app/components/sections/`：season / basic-filter / excluded-items / rules / summary-sidebar
- `app/components/`：`item-picker`、`rule-editor`、`save-as-scheme`、`preview-view`

自定义规则编辑器（`rule-editor`）的交互约定：

- 一条规则 = 「适用物品」+「特效」+「是否隐藏」。适用物品由物品集合与价格区间两个条件组成，可以只填一个，也可以同时填（生成时取交集）。
- 「完整特效预设」是一个画廊：每个预设就是一套外观（光柱 + 地图图标 + 字体 + 音效，按视觉风格从基线抽取），点一下四项一起填好；下方字段仍可逐项手改，改完标记为「自定义」，留空表示交给基础过滤器、不写任何动作。
- 规则卡片常驻「实时预览」：光柱、标签配色、地图图标随任意字段改动立即刷新；逐项编辑字段默认折叠在「自定义外观（光柱 / 地图图标 / 字体 / 音效）」里，需要微调时再展开。
- 隐藏是规则里的开关，隐藏规则照样可以配特效；列表顺序就是优先级，卡片的上下箭头调整顺序。

物品选择器（`item-picker`）的交互约定：

- 分类菜单按 poe.ninja 经济侧栏的顺序排列（基础通货、碎片、深渊骨骸、精华、预兆、探险、液化情绪、催化剂、维金，然后是自定义的神庙与试炼钥匙），顺序写在 `data/item-mechanics.json` 的 `order` 字段；其余分支保持原有插入顺序，整类匹配排在最后。
- 每张分类卡片右侧是独立的整类勾选按钮（`role="checkbox"`，支持 `aria-checked="mixed"` 的半选态）；点卡片主体进入下一级，点勾选框整选/取消该分类下的全部物品。
- 当前分类顶部有一条汇总条（本类 N 项 / 已选 M）与「选择本类 / 取消本类」，适合一次性把整套装备槽位或整个玩法拉进规则或跳过名单。
- 已选区按条目展示：整类条目显示为「深渊骨骸 · 11 项」，单件显示物品名，都可以整条移除。

`app/page.tsx` 只保留状态与数据流，不写样式实现细节。

### 复合组件（方案管理）

`app/components/scheme-manager.tsx` 与预览页的保存入口沿用既有结构（避免改动已上线的方案/订阅逻辑），其样式由 `app/globals.css` 末尾的复合组件样式层提供；该层通过一组 legacy 变量别名（`--surface`、`--border`、`--cyan` 等）映射到同一套调色板，因此视觉与 Tailwind 组件一致。

> Tailwind 的 preflight 被关闭（`corePlugins.preflight = false`），以免重置影响这些复合组件；`app/globals.css` 的 `@layer base` 里只保留必要的底色、按钮归零与滚动条样式。

## 旧版截图

- `docs/screenshots/builder-1440.png`：配置页（1440）
- `docs/screenshots/builder-1024.png`：配置页（1024）
- `docs/screenshots/builder-430.png`：配置页（移动端）
- `docs/screenshots/preview-1440.png`：预览与导出页
- `docs/screenshots/rules-1440.png`：自定义过滤规则编辑器
- `docs/screenshots/rules-presets-1440.png`：完整特效预设画廊（一次选中填好光柱 / 图标 / 字体 / 音效）
- `docs/screenshots/rules-430.png`：规则编辑器（移动端）
- `docs/screenshots/excluded-items-1440.png`：跳过名单与物品选择器
- `docs/screenshots/excluded-items-selected-1440.png`：整类勾选深渊骨骸后的跳过名单
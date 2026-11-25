# 项目约定

## UI 设计

设计界面、调整布局和修复视觉问题一律使用 `ui-ux-pro-max` skill，不要凭感觉直接改样式。

- 动手前先用它的检索脚本查对应问题：先查交互结论（`--domain ux`），再查实现方式（`--stack shadcn` 或 `--stack html-tailwind`）。Windows 上命令用 `python`，不是 `python3`。
- 视觉方向以 [docs/design-system.md](docs/design-system.md) 为准。它本来就是按这个 skill 为本项目推理出来的结论，和检索结果不一致时以它为准。
- 检索结果对不上问题时如实说明，按通用原则处理，不要硬套。
- 改完界面要截图确认实际渲染效果。只核对页面结构不算验证。

# poe2-filter

PoE2 安全优先掉落过滤器生成器：选择 NeverSink 的基础严格度，叠加每日物价高亮和可选的低价值隐藏规则，再导出 `.filter` 与音效 ZIP。价格同步默认读取 poe.ninja PoE2 交易所，也可通过 `MARKET_SNAPSHOT_URL` 注入自定义 JSON 快照。

## 安全原则

- NeverSink PoE2 模板原样 vendored，规则只在前面追加覆盖层。
- 未知物品沿用 NeverSink 的提示规则；市场数据缺失时不新增隐藏。
- 白名单优先于价格隐藏。
- 价格接口失败时按「当前快照 → 上一份快照 → NeverSink 基础档位」回退。
- 数据契约或覆盖率检查失败时不激活新数据。

## 本地开发

```bash
npm install
npm run dev
```

依赖安装需要网络；纯规则引擎可直接运行：

```bash
npm test
npm run validate:data
```

## 发布与部署

项目仓库内的 `charts/poe2-filter` 是 Chart 模板。Gitea Actions 只在 `v*` tag 上构建 amd64/arm64 镜像，推送到 `harbor.graydove.cn/apps/poe2-filter`，然后回写 Chart 的 `image.tag`。ArgoCD Application 和环境 overlay 位于 graydove charts 仓库。

NeverSink 过滤器及音效遵循其仓库中的许可证和来源说明；PoE2 游戏数据属于 Grinding Gear Games。

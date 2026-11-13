# Moo Dev Tool 安装包与 Cloud 分发

本仓发布的是 Chrome MV3 扩展 ZIP，用户解压后加载扩展；不是桌面安装器。版本以 `package.json` 与 `manifest.json` 一致的实际值为准，不因上传 Cloud 自动递增。

## 已有发版与产物

- 发版测试规范见 [RELEASE_TEST_CHECKLIST.md](RELEASE_TEST_CHECKLIST.md)；真扩展与程序化测试的分工见 [MCP_TESTING.md](MCP_TESTING.md)。测试按本次明确授权执行，不能因本文自行启动 E2E。
- `pnpm check:versions` 检查版本一致性；生产构建使用 `MOO_RELEASE_BUILD=1 pnpm build`，避免把测试 harness 带入分发包。构建会重新生成 `dist/`，不要覆盖正在长期使用的解压安装目录。
- `pnpm release` 默认仅预检和打印计划，不构建、不打 ZIP、不生成校验和。`pnpm release --publish` 会执行测试、构建、ZIP、tag、push 和 Gitee 发布；仅补传 Cloud 包时不要用它代替上传操作。
- 已有发布流程产物为 `release/moo-chrome-dev-tool-<version>.zip`，校验文件为同名 `.zip.sha256` / `.zip.sha256.txt`。Cloud 补传优先使用已核验的原始发布 ZIP，不重打同版本包导致字节与已有校验和不同。
- ZIP 解压后顶层应为 `moo-chrome-dev-tool/`，目录内有 `manifest.json`、service worker 和各页面构建文件。不要上传整个源码目录、用户项目配置或含凭据的测试数据。
- 发布前核对 ZIP 内 manifest 版本、文件清单、字节数、SHA-256 及隐私扫描结果。完整发版仍遵守既有门禁，Cloud 存储不会代替它们。

<a id="cloud-release"></a>

## 上传 Cloud

使用上面已有且核验通过的 ZIP，按 [UPDATE-CHECK.md](UPDATE-CHECK.md#cloud-release) 登记版本、上传及验证。没有原始 ZIP 时先完成获准的打包流程；不要把 `pnpm release` 的 dry-run 成功当成已有产物。

本轮只修订文档，未构建、发布新 ZIP、修改版本或改变 Gitee 更新渠道。下次实际发布后记录：版本、源码 commit、ZIP 文件、字节数、SHA-256、隐私与扩展验证结果、Cloud 软件 slug 及固定下载入口。

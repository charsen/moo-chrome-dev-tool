# Moo Dev Tool 分发与检查更新

当前检查更新逻辑在 `src/utils/versionCheck.ts`，使用 Gitee Releases latest API；ZIP 分发后由用户解压并在 Chrome 重新加载。上传 Cloud 不会切换这个检查源，也不会获得 Chrome Web Store / CRX 自动更新能力，不改 `manifest.update_url`。

<a id="cloud-release"></a>

## Cloud 发布与仓库身份

1. 首次发布在 Cloud 确认所属项目，创建或选择本扩展的软件记录。2026-11-13 核对时，可访问的软件清单未找到本仓条目，项目和 slug 以实际登记为准，不假定仓库名已经可用。
2. 按 [BUILD.md](BUILD.md) 取得已核验 ZIP，版本与包内 manifest 保持一致。创建版本并填写已批准的版本/构建信息、渠道和说明；本仓无独立构建号来源，不自行按日期造号。
3. 本扩展 ZIP 使用 `web / any / zip`、来源「上传文件」，作为手动下载分发。不是 `windows / exe` 或 `macos / dmg`，也不是应用商店包。通用后台步骤见 [软件发版手册](../../moo-scaffold-cloud/docs/RELEASE-PLAYBOOK.md#4-cloud-后台操作步骤)。
4. 平台管理员配置默认存储。默认七牛时浏览器直传，等待「上传与校验完成」再保存草稿；与本地原始 ZIP 对照字节数、SHA-256 后发布。确认失败先重试确认，不必重复上传完成的文件。
5. 原样复制 Cloud 固定下载入口 `/downloads/releases/...`。按 [统一验证步骤](../../moo-scaffold-cloud/docs/RELEASE-PLAYBOOK.md#51-接口矩阵) 跟随 HTTPS 重定向下载，校验完整文件大小、SHA-256 和解压结构；不持久保存临时七牛签名 URL。

平台存储凭据不写入扩展、ZIP 或本地 marker。当前没有 `.moo-cloud.json`，不影响手动发布；将来需要 CLI 预检时按实际项目、软件 slug 接入五字段 App marker，不加 AK/SK 或存储配置，见 [CLI 说明](../../moo-cloud-cli/README.md#73-软件仓库-markerapp--桌面--web)。

## 渠道一致性

- 现有 Gitee Releases 仍服务扩展内更新提醒；仅上传 Cloud 不能代替原渠道发布。两处应使用同一版本、同一 ZIP 字节及校验和。
- 官网当前使用独立的 `downloads/` 副本，Cloud 上传不会自动修改网页；若决定改用 Cloud 下载，应同步网页源文件、版本、体积和 SHA，并按官网仓约定部署，不能直接改部署结果。
- Cloud 撤回不会撤销 Gitee 或官网副本；坏包需分别处理并回读实际入口。ZIP 更新仍由用户替换解压目录并重新加载扩展，不能承诺静默安装。

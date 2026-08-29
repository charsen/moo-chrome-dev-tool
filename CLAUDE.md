# CLAUDE.md

本仓库的完整协作、Chrome 世界边界、隐私、提交/重试、禅道兼容和发布规则统一维护在 [`AGENTS.md`](./AGENTS.md)。开始任务前必须完整阅读并遵守它，本文件不维护第二份重复规则。

特别提醒：

- 开工先读 `NOTES.md`、`HANDOFF.md` 与任务对应的测试/发布文档。
- MV3 worker 会重启，消息必须验证，动态注入必须幂等，storage normalizer 必须完整 round-trip。
- 禅道 v2 endpoint 保留 v1 fallback；修一个风险点要用 `rg` 扫全仓同类。
- 本仓公开，commit、文档、测试、图片、release 和 zip 全部执行 PII/凭据脱敏。

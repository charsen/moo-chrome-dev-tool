# NOTES.md — Moo Dev Tool 长期记忆

> 每次开工先读。这里只记录经单测、E2E、dogfood 或真实 Chrome 验证，且可跨任务复用的坑与确认做法；不记录任务进度、猜测和容易过期的用例数量。

## Chrome / MV3

- `executeScript` 不会替同一 navigation 去重；Service Worker 重启或配置 backfill 可能重复注入。MAIN world 与 isolated content 两端都必须有幂等/清旧机制。
- 修改 background 或 offscreen 后，开发中的旧 Service Worker 可能仍在运行；真机验收前要在 `chrome://extensions` 明确重载当前 build。
- 录屏启动依赖可信用户手势，页面悬浮按钮不能替代扩展命令上下文；录屏失败项因体积不进入自动 retry queue。

## 数据与并发

- read normalizer 漏掉写入端字段会在读取时静默剥除，并可能在下次保存时永久覆盖；字段变更必须通过公共 read API 做完整 round-trip 测试。
- retry queue 的入队和 flush 若不共用锁会在并发时吞条；所有读改写操作必须走同一互斥边界。
- 动态配置、历史记录和重试快照有不同生命周期；重试必须使用提交当时的项目/server/adapter 快照，不能被后来的设置改写语义。

## 禅道与页面注入

- 禅道 v2 API 在不同实例的响应 schema 不一致；已改造 endpoint 采用“可解析 v2 优先、否则 v1 fallback”，单一实例 dogfood 不能证明兼容面。
- closed Shadow DOM 能隔离组件，但 timer/listener、Teleport 根和重复注入仍会泄漏；销毁、二次注入和 reload 都需独立验证。
- 页面级快捷键与 manifest 全局快捷键不是同一真相源；改文档时需分别核对实现，不能仅 grep manifest 判断快捷键不存在。

## 公开发布

- `git filter-repo --replace-text` 不会改 commit message；清理历史 PII 还需 `--replace-message`，并单独处理 remote 与 tag。此类历史重写必须先获用户明确授权。
- release PII deny list 本身含敏感词，只能保存在 gitignored `.release-pii-deny`；不要把真实黑名单复制到脚本、文档、测试或命令输出。

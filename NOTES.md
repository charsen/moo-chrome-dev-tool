# NOTES.md — Moo Dev Tool 长期记忆

> 每次开工先读。这里只记录经单测、E2E、dogfood 或真实 Chrome 验证，且可跨任务复用的坑与确认做法；不记录任务进度、猜测和容易过期的用例数量。

## Chrome / MV3

- `executeScript` 不会替同一 navigation 去重；Service Worker 重启或配置 backfill 可能重复注入。MAIN world 与 isolated content 两端都必须有幂等/清旧机制。
- 修改 background 或 offscreen 后，开发中的旧 Service Worker 可能仍在运行；真机验收前要在 `chrome://extensions` 明确重载当前 build。
- 录屏启动依赖可信用户手势，页面悬浮按钮不能替代扩展命令上下文；录屏失败项因体积不进入自动 retry queue。
- MAIN world 读响应体前必须先按 content-length / content-type 设闸。`resp.clone().text()` 与 `xhr.responseText` 都是「先把整份 body 解码成 JS 字符串，再 clip 到上限」，大响应（尤其二进制 text 化）会撑爆内存；闸门要在读取之前判，不是读完再截。
- Service Worker 冷启动时，与重试队列无关的副作用（动态注入 self-heal、badge、录屏孤儿恢复）不能排在 flush 的网络段之后 —— 单条禅道 multipart 超时 80s × 最多 50 条，会把它们挡几十秒。rehydrate 则相反，必须在模块同步求值期就启动（见 `background/index.ts` 注释）。

## 数据与并发

- read normalizer 漏掉写入端字段会在读取时静默剥除，并可能在下次保存时永久覆盖；字段变更必须通过公共 read API 做完整 round-trip 测试。
- retry queue 的入队和 flush 若不共用锁会在并发时吞条；所有读改写操作必须走同一互斥边界。
- flush 的进度必须**增量落盘**：成功条立即从队列移除、失败条立即写回 attempts/lastStatus。只在循环末尾写回一次的话，SW 中途被杀会让「已重试成功」的条留在队列，冷却一过重发 → 远端重复工单。落盘顺序也要紧 —— **先从队列移除、再回填 history**，反了最坏是多一条重复单。
- 模块内存锁只在**单个 JS 上下文**内有效。history / retryQueue 的锁都在 SW 侧，所以 devtools / popup 的**写**路径必须经消息路由到 SW 执行（只读路径可直调）。
- 动态配置、历史记录和重试快照有不同生命周期；重试必须使用提交当时的项目/server/adapter 快照，不能被后来的设置改写语义。

## 禅道与页面注入

- 禅道 v2 API 在不同实例的响应 schema 不一致；已改造 endpoint 采用“可解析 v2 优先、否则 v1 fallback”，单一实例 dogfood 不能证明兼容面。
- closed Shadow DOM 能隔离组件，但 timer/listener、Teleport 根和重复注入仍会泄漏；销毁、二次注入和 reload 都需独立验证。
- 页面级快捷键与 manifest 全局快捷键不是同一真相源；改文档时需分别核对实现，不能仅 grep manifest 判断快捷键不存在。

## 测试与类型

- 测试 fixture 必须用**生产真形态**，`as T` / `as unknown as T` 断言会把「生产造不出的形状」整条放过：实例 `imageFormat: 'inline'`（真类型只有 `base64 | multipart`）、`viewport: { w, h }`（真值是 `'1280x800'` 字符串）。做法是**基于生产默认值展开**（`DEFAULT_ZENTAO` / `DEFAULT_CAPTURE` / `DEFAULT_REDACT`）并去掉断言，让 TS 真校验 —— 手抄一份字段清单迟早再次漂移。
- `vi.fn(async () => ...)` 零形参会把 `mock.calls` 推成空 tuple，`calls[1]?.[0]` 直接 TS2493；要断言调用入参就得照真实签名声明形参。
- 类型检查必须真的跑。`tsconfig.tests.json` 曾长期挂在 CI 的 `continue-on-error` 下，结果攒到 41 处错误（跨 15 文件）无人知。清零后要立刻摘掉 `continue-on-error` 并进 pre-commit，否则必然复发。
- 引入 linter 时按面收紧：`tseslint.config()` 里 `extends` 的顺序决定 parser 归属 —— TS 预设排 Vue 预设之后会把 `.vue` 的 parser 顶成裸 TS parser，23 个 SFC 全部 parse error。
- 用户可见文案一旦收口成单一来源（如历史状态 chip 走 `utils/remoteStatus.ts`），改文案就同时命中多个断言面：`tests/remoteStatus.test.ts` + `tests-e2e/popup-recent.spec.ts` + `tests-e2e/popup-status.spec.ts`。这三处必须一起动，只改源码会以「单测绿、e2e 红」的形式暴露。
- E2E **直挂 `dist/`**（见 `playwright.config.ts` 顶部注释），不读 `src/`。所以改完源码必须先 `pnpm build` 再跑 e2e，否则测的是旧产物 —— 会出现「断言按新文案写、结果仍报旧文案」的方向性误判。

## 公开发布

- `git filter-repo --replace-text` 不会改 commit message；清理历史 PII 还需 `--replace-message`，并单独处理 remote 与 tag。此类历史重写必须先获用户明确授权。
- release PII deny list 本身含敏感词，只能保存在 gitignored `.release-pii-deny`；不要把真实黑名单复制到脚本、文档、测试或命令输出。

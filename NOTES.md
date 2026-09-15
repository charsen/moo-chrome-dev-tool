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
- **vitest 4 起 `vi.fn` 只吃一个泛型参数**（函数类型）：旧的 `<Args, Return>` 双参写法报 TS2558，要改成 `vi.fn<(cb: () => void) => void>()`。目的不变 —— 仍是让 `mock.calls` 保持 `[cb: () => void][]` 的 tuple 形状。
- 类型检查必须真的跑。`tsconfig.tests.json` 曾长期挂在 CI 的 `continue-on-error` 下，结果攒到 41 处错误（跨 15 文件）无人知。清零后要立刻摘掉 `continue-on-error` 并进 pre-commit，否则必然复发。
- 引入 linter 时按面收紧：`tseslint.config()` 里 `extends` 的顺序决定 parser 归属 —— TS 预设排 Vue 预设之后会把 `.vue` 的 parser 顶成裸 TS parser，23 个 SFC 全部 parse error。
- 用户可见文案一旦收口成单一来源（如历史状态 chip 走 `utils/remoteStatus.ts`），改文案就同时命中多个断言面：`tests/remoteStatus.test.ts` + `tests-e2e/popup-recent.spec.ts` + `tests-e2e/popup-status.spec.ts`。这三处必须一起动，只改源码会以「单测绿、e2e 红」的形式暴露。
- E2E **直挂 `dist/`**（见 `playwright.config.ts` 顶部注释），不读 `src/`。所以改完源码必须先 `pnpm build` 再跑 e2e，否则测的是旧产物 —— 会出现「断言按新文案写、结果仍报旧文案」的方向性误判。

## 依赖与工具链升级

- **漏洞建议有「下界」，所以升级会「换出新建议」**：`vulnerable_versions: ">=2.1.0 <4.1.11"` 这种区间对更老的版本不成立。实测把 `vitest` 从 1.6.1 升到 3.2.7（当时清单写的最小 patched 版）后，critical 没了，却冒出原本不存在的 moderate（要求 `>=4.1.11`）。**必须逐级重跑 `pnpm audit` 直到归零，不能照第一次的清单做一次性决策。**
- **升级前先查「这个包有没有被别的工具当直接依赖」**：有内嵌副本时只升根依赖清不掉漏洞。实例：`vitest` 直接依赖 `vite ^5` 且与根依赖**共用同一份 vite**，只把根 vite 升到 6 会留下 vitest 内嵌的 vite 5（仍在 `<=6.4.2` 受影响区间）→ 必须把 vitest 一起升到支持新大版本的版本才能去重。
- **`pnpm add` 不会去重**：它保守复用 lockfile 里已有的版本（满足范围就沿用）。升完要跑 `pnpm dedupe`，再用解析探针确认真的只剩一份：`node -e "const{createRequire}=require('module');const r=createRequire(require.resolve('vitest/package.json'));console.log(r('vite/package.json').version)"`。
- **`pnpm update` 不是 lockfile-only**：它会同时改写 `package.json` 的版本范围（下限抬到已解析版本）。要只动传递依赖得用 `pnpm.overrides`；想事后手工收窄范围会让 lockfile 的 `specifiers` 对不上 → `--frozen-lockfile` 失败。
- **`@playwright/test` 升级要补浏览器**：revision 不匹配时全量 e2e 会**全部失败且错误信息一致**（`Executable doesn't exist at .../chromium-<rev>/...`），`playwright install chromium` 即恢复 —— 先查 `~/Library/Caches/ms-playwright/`，别误判成代码回归。
- **验证「构建期剥除类安全控制」看产物、不看配置**：`vite.config.ts` 的 `esbuild: { drop: ['console','debugger'] }` 是防 token 泄漏的**安全控制**，断言必须带调用括号：`grep -rnEo 'console\.(log|warn|error|info|debug)\(' dist --include='*.js' | wc -l` 必须为 **0**。宽口径 `grep -rno "console\." dist` 会命中 4 处 UI 文案字符串（`'console.error 调用'` 等）而误报。
- **别拿 `dist-e2e*/` 当构建行为的基线**：那两个目录的 manifest 被 e2e spec **故意**把 `optional_host_permissions` 提升成 mandatory（见 `docs/MCP_TESTING.md`）。拿它对比会得出「升级把权限改成 mandatory 了」这种假结论；要比就先排除 `host_permissions` / `optional_host_permissions` 两个字段。
- **升级目标不必追最新大版本**：vite 8 换掉 esbuild 引擎（rolldown + lightningcss），上面那条 `esbuild.drop` 安全控制只会被**静默改写**（无报错、构建绿、测试全绿，但发布 zip 里真带 token）→ 停在 vite 6/7 即零迁移。另：vite 8 需 node ≥22.12、vitest 5 直接砍掉 node 20（`^22.12 || ^24 || >=26`），会让 CI 被迫升 node；vite 6.4.3 + vitest 4.1.11 的 engines 都容得下 node 20。

## 公开发布

- `git filter-repo --replace-text` 不会改 commit message；清理历史 PII 还需 `--replace-message`，并单独处理 remote 与 tag。此类历史重写必须先获用户明确授权。
- release PII deny list 本身含敏感词，只能保存在 gitignored `.release-pii-deny`；不要把真实黑名单复制到脚本、文档、测试或命令输出。

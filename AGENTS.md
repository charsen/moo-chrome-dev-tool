# AGENTS.md

本文件适用于整个 Moo Dev Tool 仓库。规则冲突时依次服从系统/用户指令、当前代理规则、用户批准的方案、`notes.md`、`HANDOFF.md`、发布/测试文档和现码。归档文档记录历史，不得覆盖当前 manifest、类型、测试和真实 Chrome 行为。

## 开工顺序与长期记忆

1. 先读 `notes.md`，再读 `README.md`、`HANDOFF.md` 和任务对应的 `docs/`；发版任务必须读 `docs/RELEASE_TEST_CHECKLIST.md` 与 `docs/MCP_TESTING.md`。
2. 按 Chrome 世界追完整链：page MAIN hook → isolated content/shadow UI → background service worker → offscreen recorder/devtools/popup/options → storage/后端 adapter。
3. 修改前读目标文件、同类实现与测试。机械性、零语义且范围明确的小修可直接实施；非琐碎或涉及权限、数据采集、上报、重试、录屏、release 的改动先列计划并获用户批准，范围或风险实质变化时重新确认。

- `notes.md` 只记录已经由单测、E2E、dogfood 或真实 Chrome/禅道验证，且跨任务仍有价值的坑和做法；不写任务流水账、猜测和固定测试数量。
- 新证据推翻旧结论时修订原条目。禁止写真实姓名、账号、手机号、公司域名、token、内部 IP 或生产工单内容。
- `HANDOFF.md` 用于当前产品状态和接力，`CHANGELOG` 用于版本档案；两者不替代永久工程规则。

## 产品与架构边界

- 本扩展用于团队内部在问题页面一键收集截图/标注、近 30 秒录屏、网络请求、JS 错误和元素信息，并提交到 webhook 或禅道。
- content script/shadow DOM 负责页面内 UI 与现场采集；MAIN world hook 捕获 fetch/XHR；background 负责消息编排、权限、提交和重试；offscreen 只承载录屏；devtools/popup/options 共享 storage 契约。
- MV3 Service Worker 随时会停启，内存不是持久真相。队列、token cache、升级状态和任务恢复必须经 storage/明确重建。
- 网络请求采集只服务 bug 复现，不是监控 SDK。不要扩大到全量遥测、常驻录屏或未经用户选择的数据上传。

## 隐私、安全与消息边界

- password、token、authorization、cookie、localStorage 白名单值、请求/响应正文和截图都可能敏感；采集最小化、提交前脱敏，日志/测试/文档不得回显真实数据。
- 页面、content、background、offscreen 间的每个消息接收方都校验 sender/source/origin 和 payload shape；不能用宽松 `&&` 条件让错误 sender 穿透。
- `postMessage` 同时校验 origin、source 与结构；Chrome `onMessage` 校验 `sender.id`/tab 语境和具体 message type。
- host permissions 能 optional 就不 mandatory；动态注册/`executeScript` 的每个注入入口必须幂等。MAIN world 用页面级 flag，isolated world 清理旧句柄，避免 SW 重启/backfill 后双采集。
- 截图前密码遮罩、请求脱敏和 storage normalizer 是防线，不得因 UI 开关或旧数据绕过。normalizer 必须读取写入端全部字段，否则一次 read/write 会静默剥掉数据。

## 提交、重试与录屏

- webhook 与禅道通过 `IssueAdapter` 分流，共享提交编排但保留各自鉴权、附件与响应契约。
- retry queue 的 enqueue/flush/删除必须使用同一互斥，避免并发吞条或重复；重试项保存提交时快照，不从后来变更的环境配置拼出另一份工单。
- 录屏受 Chrome 用户手势和 offscreen 生命周期限制；状态机必须覆盖启动失败、停止、页面/worker reload 与孤儿恢复。录屏体积不进入自动 retry queue，失败后由历史页显式重提。
- 截图、多图、录屏和请求正文有体积边界；clone/序列化/压缩/上传失败要给用户明确反馈，不能卡死弹窗或静默丢附件。
- 自动保存的 timer/listener 必须在组件卸载时清理；MooDialog/focus trap/Esc/IME 组合输入不得造成误关或状态丢失。

## 禅道与外部后端兼容

- 禅道不同实例的 v2 schema 存在差异。新增/修改 v2 endpoint 必须保留已验证的 v1 fallback；v2 成功且可解析才使用，schema 不识别再 fallback。
- 401/资源 404 等明确语义按现有策略处理，不滥用 fallback；错误文案标明 v2 或 v1 fallback 路径，便于 dogfood 定位。
- 每个双轨 endpoint 至少测试：v2 正常、v2 schema 不识别→v1 成功、两边均不识别，以及适用的 401/404。
- 后端 webhook 协议以 `docs/SERVER_INTEGRATION.md` 为准；字段或状态回查变化要保持旧 server 兼容或提供迁移，不根据单一 dogfood 实例硬切。

## UI 与 Chrome 世界

- 页面内组件运行在 closed Shadow DOM，样式使用 `src/styles/tokens.css` 的真实 token；使用前先确认 token 存在，并同步检查 dark mode。
- Teleport/dialog/annotator/element picker 不得把样式、监听或节点泄漏到宿主页；重复注入和销毁后重建都要验证。
- 快捷键真相源分两类：全局命令看 manifest，页面级命令看 ContentApp 实现；文档修改要全仓对账。
- `vue-tsc` 不能证明扩展世界注入、service worker、offscreen 和真实权限正确；UI/交互变化需用 harness E2E 和真扩展断面分别验证。

## 公开仓与发布

- 本仓公开，commit、CHANGELOG、HANDOFF、docs、源码/测试、图片、release 描述和 zip 全部必须脱敏。真实 PII deny list 只放 gitignored `.release-pii-deny`，绝不能把黑名单内容写入 tracked 文件。
- 版本号在 package、manifest、文档/构建元数据之间保持一致，以 `pnpm check:versions` 为门禁。普通修复不自动 bump。
- `pnpm release` 默认 dry-run；publish、tag、release 页面与商店提交都须用户明确要求。发布文案保持精炼，版本详情放 CHANGELOG。
- 不绕过 pre-commit。只有用户明确授权且理解共享历史影响时才允许 force push。

## 同类扫描与验证

- 修一个 listener、normalizer、动态注入、timer、CSS token、message type 或 v2 endpoint，至少用 `rg` 扫全仓同类；只修直接报错点通常不足以闭环。
- 同类扫描限于同一风险模式；工作量明显扩大或业务不确定时报告并重新确认，不借机做泛化重构。
- 文档-only 至少运行 `git diff --check` 与相关一致性脚本。代码改动开发中按需先跑目标 Vitest；最终代码状态执行一次 `pnpm check:versions`、`pnpm type-check:tests`、`pnpm test` 和 `pnpm build`。`pnpm build` 已包含主源码 `vue-tsc --noEmit`，运行后不再重复 `pnpm type-check`；只有提前反馈或失败诊断时单独运行它。
- UI/扩展链改动按 `docs/MCP_TESTING.md` 分断面：Playwright harness 做程序化交互，真实 Chrome/DevTools 验证 SW、权限、动态注入和真扩展行为；发版按 checklist 追加 dogfood/人工项。
- 不主动 commit、push、bump、tag、release 或商店提交。提交前展示完整 diff 与真实验证结果并取得用户明确确认。

# 交接

> 写给明天接班的同事。读完知道现在到哪、有什么坑、下一步该干嘛。

## 一句话现状

**v0.8.14 已发**（2026-06-18）。[下载](https://gitee.com/charsen/moo-chrome-dev-tool/releases/download/v0.8.14/moo-chrome-dev-tool-0.8.14.zip)（sha256 `6eb246eff3fe8cb8009978ac713159b7083bc2dc69462cda7ae7013538d4a173`）。无 BREAKING（不碰存储 schema / 上传协议）— 🔴 **修「截多图只存 1 张」数据丢失**：v0.8.13 降采样只缩宽保留 PNG，复杂截图（满屏文字/细节）2560px PNG 仍可达 10–13MB，超云端 `extractBinary` 8MB/张上限 → **静默 skip 不建附件、请求仍 200**（用户截 3 张、2 张超限被丢 → cloud 只存 1 张）。修：截图入口仍降采样 PNG（标注/预览/history 用），**格式重编码放各 adapter 上传前**（目标已知）—— webhook/cloud → **WebP q0.9**（cloud MIME 白名单含 webp）、禅道 → **JPEG q0.9**（老版禅道不一定支持 webp，先铺白底防透明变黑、文件名同步 `.jpg`），失败兜底返原图（宁可大也别丢）。真视口截图从 ~10MB PNG 压到 **~0.27MB**，8MB 闸不再撞。配套服务端（moo-scaffold-cloud）：迁移正则补「screenshot 末字段无尾逗号」（旧正则漏 cloud 单图模板结构 → 那批用户多图迁移一直被跳过，另一类「只存 1 张」根因）+ `ImageDownscaler::fit` 降采样移到 8MB 检查前（>8MB 先缩再有损重压，老客户端/极端图也不丢）。852 单测（含 reencode 17 例）+ 截图 e2e（F1 断言已对齐 WebP）+ type-check + build 全绿；服务端 443 测试全绿（含 fit 9 例 + >8MB 重压不丢集成测试）。**dogfood 不足（重编码刚做），用户明示放行；lab-tester 已真 cloud 实锤 3 张大图全落库（对照 PNG 路径落 0 张）。留观：① 复杂大图截多张全落库；② webhook/cloud 落 WebP、禅道落 JPEG（白底/`.jpg`）；③ history 回看仍 PNG 无损；④ 旧多图模板迁移不再被跳过。** 服务端 moo-scaffold-cloud 不在本次发版范围（独立 repo，测试已 push，用户自行 deploy）。详情见 CHANGELOG v0.8.14 段。

**v0.8.13 已发**（2026-06-18）。[下载](https://gitee.com/charsen/moo-chrome-dev-tool/releases/download/v0.8.13/moo-chrome-dev-tool-0.8.13.zip)（sha256 `e6647fe5e33744b2510d6181541cd9216b413ffe20ca4b3b7a0a4bc4751157e1`）。无 BREAKING（向后兼容，只缩不放）— 🗜 **截图上传前降采样到 ≤2560 宽**：高 DPI / retina 屏 `captureVisibleTab` 截的是物理像素（1280 CSS 宽 DPR 2–3 下实际 2560–3840px、PNG 5–6MB），新增 `downscaleToMaxWidth` 在 **SW 截图 handler 截完即缩**（单一收口点）→ 标注/预览/上传/history 全拿缩好的图，省上传带宽 + 减小 payload（缓解 webhook/zentao 重试队列 1MB 上限 + 多图叠加体积）。与服务端 `ImageDownscaler::toMaxWidth` **同语义**（≤2560 原样返回、高度按比例、保留格式 PNG→PNG 文字清晰 + alpha、失败返原图不丢截图）；两端配合防御纵深（扩展先缩 → 服务端见 ≤2560 不重复处理 → 老客户端 >2560 服务端兜底缩）。834 单测（含 8 条降采样：缩放数学/只缩不放/格式保留/失败兜底）+ 截图 e2e + type-check + build 全绿。**dogfood 不足（刚做），用户明示放行；留观：真高 DPI 屏上传体积变小 + PNG 文字清晰/alpha 保留 + ≤2560 不被多余处理 + 解码失败返原图不丢截图。** 服务端 moo-scaffold-cloud 配套补了 ImageDownscaler 单测 + intake 集成测试（独立 repo，不在本次发版范围）。详情见 CHANGELOG v0.8.13 段。

**v0.8.12 已发**（2026-06-17）。[下载](https://gitee.com/charsen/moo-chrome-dev-tool/releases/download/v0.8.12/moo-chrome-dev-tool-0.8.12.zip)（sha256 `14087a802b10826180e4f89b5438a5e80661b7248c131b88184970e346e135df`）。无 BREAKING — 提交弹窗两件：⚠ **多匹配时目标项目可见**（一页命中多个 Moo 项目时，弹窗顶显「命中 N 个项目 · 当前提交到 X · 禅道 #id」+ 录制条目标标识；修快捷键/录屏静默 default 提错项目看不见，用户反馈「提报到无项目」根因之一，唯一匹配零打扰）；✨ **「再截一张」改延迟触发**（点「＋ 再截一张」收起弹窗 + 右下角浮可拖「现在截图」，先切 SPA tab/滚动再截；新增 `arming` 状态 + `ArmShotTrigger.vue`，拖拽照搬悬浮球 pointer-capture、listener idempotent 收口）。826 单测 + 181 e2e（multi-shot 5 含 arming 取消 + 多匹配警告 4 + dialog-multi-shot 7）全绿。**dogfood 不足（刚做），用户明示放行；留观：真录屏/快捷键路径警告条准确、arming 切页后截到切后页面 + 取消保留草稿 + 拖拽不泄漏。** 不碰匹配引擎/存储 schema/悬浮球强制选逻辑，零迁移。详情见 CHANGELOG v0.8.12 段。

**v0.8.11 已发**（2026-06-12）。[下载](https://gitee.com/charsen/moo-chrome-dev-tool/releases/download/v0.8.11/moo-chrome-dev-tool-0.8.11.zip)（sha256 `ee29b694da3cfc3167a9641316b65b26b2093935b321ff03e38bb7d3adc4ece6`）。无 BREAKING（向后兼容）— 🔴 **修 v0.8.10 多图数据丢失**：默认 base64/JSON 模板（含 cloud intake）漏 `{{imagesJson}}`，开箱截多张只发首图。默认模板补 `screenshots` 数组 + `migrateServerTemplate` 自动升级老配置（修「已含 video 即提前返回」吞 screenshots 的陷阱）；⚠ 模板缺多图字段时 Environment 显警告条 + 一键补按钮（自定义模板迁移碰不到的兜底）；🔑 配置导出加「含密钥」选项（自己多机/重装备份免再找 token）；📐 多图缩略图横向铺开（flex-wrap）。826 单测 + 多图/横向布局/警告条 e2e 全绿。**dogfood 不足，用户明示放行；留观：默认模板多图在真禅道/cloud 实发多张、老配置自动升级（v0.4.7~v0.8.10 有 video 缺 screenshots 存量）。** 服务端 moo-scaffold-cloud 不在本次发版范围。详情见 CHANGELOG v0.8.11 段。

> **v0.8.10 及更早「一句话段」已批量归档**：v0.5.0 → v0.8.10 见 [docs/handoff-archive/v0.5.x-v0.8.x.md](docs/handoff-archive/v0.5.x-v0.8.x.md)；更早 v0.1.x → v0.4.x 见下方「早期版本简介」。本文「一句话现状」只保留最近 4 个发版（v0.8.11 → v0.8.14）。

**早期版本简介**：v0.1.x → v0.4.3 见 [docs/handoff-archive/v0.1.x.md](docs/handoff-archive/v0.1.x.md)；v0.4.4 → v0.4.9 见 [docs/handoff-archive/v0.4.4-v0.4.9.md](docs/handoff-archive/v0.4.4-v0.4.9.md)。

**往前看**：当前路线 + 待办见下方「现在最值得做的下一件事」+「Backlog」两段（早期 v0.7.x 路线项多已落地或被取代，不再逐条留）。**CWS 上架物料就绪**（`docs/cws/`），等用户截图 + 后台填表。

## 这两周做了什么

> 当前发版的明细全在 [CHANGELOG.md](CHANGELOG.md) 顶部，本文档不重复列；更早的版本时间线 + 历次发版决策记录见 [docs/handoff-archive/](docs/handoff-archive/)。

**MV3 限制·永远只能人眼核**：toolbar badge 视觉、`Alt+Shift+M` 真触发、DevTools 面板内嵌渲染、global shortcut、native toolbar、chrome:// 页——这些 Playwright 也做不了，发版前自己手点 1-2 分钟过一下。

## Playwright E2E

> **最新 case 数看顶部「一句话现状」**（v0.8.14 时 181 case），本段只讲结构和原因，不再回填具体数字。

**真起 chromium、真加载 dist 当 extension、真跑 SW**。跑法：`pnpm test:e2e`（先 build，全量约 2min）；首次要先 `pnpm exec playwright install chromium`（本机已装）。

结构：

- `playwright.config.ts` + `tests-e2e/fixtures.ts`（launchPersistentContext + 抓 extensionId + 抓 SW worker + `waitForBadgeText` 轮询助手 + `openExtensionPage` retry helper）
- `tests-e2e/*.spec.ts` 按面分组：popup / badge / body-viewer / panel（4 Tab）/ dialog（SubmitDialog、Annotator、悬浮球拖动）/ 动态注册与注入幂等 / 升级链 / 录屏控制
- `src/devtools/body-viewer-harness.{html,ts}` + `src/devtools/panel-harness.{html,ts}` + `src/content/dialog-harness.{html,ts}`（三个 harness，按 `?case=` / `?tab=&seed=` / `?case=&fail=&success=` 切场景）

为啥要 harness：BodyViewer / Panel.vue 平时挂 DevTools panel iframe 里，chrome:// 外部驱不动；SubmitDialog / Annotator / FloatingBall 平时挂宿主页注入的 closed shadow 里，⌘⇧B 全局快捷键 + content script 注入链路 Playwright 跨边界也驱不动。做独立 harness 页面 mock chrome.devtools.* / chrome.tabs.sendMessage / chrome.runtime.sendMessage，Playwright 直接开就能 DOM 断言 + dispatch 合成 pointer events 锁拖动契约。

> 禅道集成**没有 E2E**——禅道 API 跨域 + cookie session + 真实 WAF 在 Playwright headless chromium 里没法可靠复现（mock 价值不大）。禅道侧回归保护走 `tests/` 里 client.ts / submit.ts 的纯单测（schema fuzz + 真实 fixture，覆盖主要分支）。

## 你最该知道的几个坑

按「碰对应代码前必读」排：#0 禅道集成；#1-#3 是立项早期就在的老坑（仍然成立）；#4-#5 是开发期最常踩的。

### 0. 禅道集成的硬依赖 + 4 条架构事实（v0.2.0 立、随版本演化，下次碰禅道代码必看）

**硬依赖**（用户视角）：**「环境」里配账号 / 密码 / 项目 ID**。v0.2.3 起 Moo 用这套凭证自动登录（`POST /api.php/v2/users/login` 同时拿 token + 往 cookie jar 写 session），**不再需要用户手动在浏览器登录禅道页面**。早期（v0.2.0-v0.2.2）依赖浏览器登录态 cookie、否则 `openedBy=system` 的问题已成历史。

**关键架构事实**（接下来改禅道代码前**必须**先理解）：
1. **直连，不中转**：`src/background/zentao/client.ts` + `submit.ts` 直接打禅道 REST API（**v2 优先 + v1 fallback 双轨**，见 CLAUDE.md 🟣 段；普通账号拉不到 users/modules 时还有 tier-3「建单页视图数据」兜底，v0.8.9 加），**不依赖中间适配层**。改 endpoint 直接看 client.ts，不要去找「Moo B 服务器」之类的中间件
2. **读写走 token，唯独附件上传走 cookie session**：login / listProjects / listUsers / 建单（`POST /api.php/v2/bugs`）都带 `Token` header（失效自动重登）；附件上传走老 zui editor 端点 `/file-ajaxUpload.html`，只认 cookie——cookie 由 login 同一调用写入 jar（`ensureCookieSession()` 走 trust 路径，失效靠上传失败 + reLogin 重写）。endpoint 全表见 `docs/ZENTAO_SETUP.md` 附录
3. **附件走 zui editor 链路，不走 v2 API attach_files**：v2 API 的 attach_files 端点不支持 inline 渲染，必须点附件下载才能看。改走 `/file-ajaxUpload.html` 拿 `fileID`，再把 `<img src="/file-read-{fileID}.html">` inline 拼到 bug `steps` 字段的 HTML 里 —— 这样**截图直接在 bug 详情页渲染**。录像 / curl.sh / 错误信息也走同一端点，但只挂附件不 inline
4. **inline curl 必须 ZWS 污染，curl.sh 附件不能**：禅道服务器 WAF 会把裸 curl URL 当 SSRF 拦截。inline 渲染版的 URL 关键字符之间插 zero-width space (U+200B)，渲染视觉无差异 + zsh/bash 复制粘贴执行无差异，但 WAF 字符串匹配失效。**curl.sh 附件保留干净版**（保证用户下载下来直接执行不带不可见字符）。改 `src/utils/curlGenerator.ts` 别一刀切

**已穷举的「做不到」事项**（下次别再花时间重探）：
- **视频 inline 渲染**：禅道 HTML sanitizer 是 strict 白名单，`<video>` / `<embed>` / `<object>` 整段剥成空，`<iframe>` 字母被改全角 + `<>` 转义成纯文本；上传的 .webm 被禅道强制改名 .txt + 返 `application/octet-stream`。webm → GIF + `<img>` 理论可行但 GIF 体积 5-10 倍膨胀必超 50M 禅道上限。**现状下载链接是终局**（2026-05-21 实测穷举过 video/iframe/embed/object 标签 + pi.php content-type）

**入口位置**：
- `src/background/zentao/client.ts` —— 所有禅道 API 调用（login / ensureToken / ping / listProjects / discoverProduct / 用户列表）
- `src/background/zentao/submit.ts` —— submitBug 主入口（cookie session + 附件 upload + steps HTML 拼接）
- `src/background/index.ts` —— SUBMIT_BUG handler 按 `project.kind` 分支
- `src/devtools/tabs/Environment.vue` —— kind 切换 + 禅道 4 字段表单 + 测试连接 + 拉项目下拉
- `src/content/SubmitDialog.vue` —— 禅道项目下隐藏「服务器选择 / 预览请求体」+ 显 4 字段可改 + cookie 预检 + 录像 50M 预警 + 「禅道里看 →」
- `docs/ZENTAO_SETUP.md` —— 用户手册（8 节，给安装用户看的）

### 1. 录屏的入口仍然必须是键盘快捷键

老规矩：`tabCapture.getMediaStreamId` 必须在用户键盘手势上下文里调，content script 里 click 经消息转一手手势就丢了。悬浮球的"录屏"按钮只显示 `⌥⇧R` kbd 提示。

录屏实际跑在 offscreen document（`src/offscreen/`）里，状态机修过一批 race。改这块前先把 `src/offscreen/index.ts` 看完——里头每个状态迁移都有原因，不要凭直觉简化。

另：`tabCapture` 是 **optional permission**，首次要在 popup 开「录屏功能」授权。装包测试时记得先撤掉已授的权限，再把首次授权流程过一遍。

### 2. 抓请求是同源 postMessage，假数据仍能塞进来

三重防御（origin 限定、收端 origin 校验、payload shape 校验）仍在。固有缺陷没变：同源恶意脚本可以精心构造合法 shape 的假请求。新增字段时**必须**同步更新 `isValidRequestPayload` / `isValidErrorPayload`。

补强：`useRequests.ts` 用 `DEFAULT_REDACT` 兜底，修了「用户配置脱敏规则之前就抓到的请求」那段空窗期。

### 3. chrome.storage.local 仍只有 10MB

老约束没变。新规矩：

- `noUncheckedIndexedAccess` 已开，新代码访问数组/对象索引必须处理 `undefined`。存量代码已全量改过，别又写回去。
- pre-commit 会跑 `type-check + test`，过不了就 commit 不上。**不要 `--no-verify` 绕**——绕一次 hook 就废一半。

### 隐藏的第 4 个：扩展错误页污染

早期 background 里 `console.error` 被 monkey-patch 包过一层（为了上报 SW 错误），结果**所有**插件错误都被吃掉/重写，扩展错误页全是噪声，后来撤掉了。如果你想再上报 SW 错误，**不要**重新 monkey-patch console；走显式 `reportError(err)` 函数。

### 隐藏的第 5 个：unpacked 扩展的 SW 不会随 dist 文件变更自动 reload

调试 background 代码很容易踩：`pnpm build` 后 chrome 里 popup / panel 那些**页面端**代码确实会刷新，但 **service worker 的代码不会**——SW 在 chrome 进程里跑着，dist 文件变了它不知道，继续跑老 bundle。

表现：你以为新代码生效了，结果 SW 注册的 `chrome.storage.onChanged` listener 是老的（甚至不存在），新功能不响应任何事件。实测踩过：MCP 验证发现 badge 不更新，怀疑了半天代码逻辑，最后 `chrome.runtime.reload()` 一下就好了。

**修法（任选）**：
- chrome://extensions → Moo → 点 🔄 重新加载按钮
- popup / panel DevTools console 跑 `chrome.runtime.reload()`
- 改 manifest.json（连版本号 / description 任何字段都行）会让 chrome 强制重载整个扩展

**不要**指望关闭再开 chrome 能解决——`chrome.runtime.onStartup` 触发也不会重读 SW 代码（SW 是缓存在 Chrome 的 extension 进程里的）。开发期间养成「改 SW 后立刻去 chrome://extensions 点 🔄」的肌肉记忆。

## 现在最值得做的下一件事

v0.8.14 已发完。**当前没有强迫性 todo**。本版主体是 🔴 **修「截多图只存 1 张」数据丢失**：v0.8.13 降采样只缩宽保留 PNG，复杂截图 2560px PNG 仍可达 10–13MB，超云端 `extractBinary` 8MB/张上限 → 静默 skip 不建附件、请求仍 200（用户截 3 张、2 张被丢）。修：截图入口仍降采样 PNG（标注/预览/history 用），**格式重编码放各 adapter 上传前** —— webhook/cloud → WebP q0.9、禅道 → JPEG q0.9（先铺白底防透明变黑、文件名同步 `.jpg`），失败兜底返原图。真视口截图从 ~10MB 压到 ~0.27MB，8MB 闸不再撞。配套服务端（moo-scaffold-cloud）：迁移正则补「screenshot 末字段无尾逗号」（漏 cloud 单图模板结构致那批用户多图迁移被跳过，另一类「只存 1 张」根因）+ `ImageDownscaler::fit` 降采样移到 8MB 检查前（>8MB 先缩再有损重压）。非 BREAKING、零迁移，dogfood 不足（用户明示放行跳 checklist，理由见 CHANGELOG v0.8.14「发版决策小记」）。lab-tester 已真 cloud 实锤 3 张大图全落库（对照 PNG 路径落 0 张）。**留观的手测点**：① 复杂大图截多张全落库不再静默丢；② webhook/cloud 落 WebP、禅道落 JPEG（白底/`.jpg`）；③ history 回看仍 PNG 无损；④ 旧多图模板迁移不再被跳过。服务端 moo-scaffold-cloud 不在本次发版范围（独立 repo，测试已 push，用户自行 deploy）。等用户继续真实 dogfood 反馈，再决定 hotfix 还是新 feature。

> **截图重编码链路速记**（v0.8.14 加，碰截图上传体积/丢图先看）：截图体积有**两个收口点，别混**。① **降采样收口在 SW 截图 handler 截完即缩**（`downscaleToMaxWidth`，≤2560 宽 PNG）—— 给标注/预览/history/上传**全链路同一张**用，保 PNG 无损（文字清晰 + alpha）。② **格式重编码收口在各 adapter 上传前**（不在截图入口！）—— 因为目标已知才能选对格式 + 给禅道正确文件名：webhook/cloud → **WebP q0.9**（cloud `extractBinary` MIME 白名单含 webp，最清晰），禅道 → **JPEG q0.9**（老版禅道不一定支持 webp，jpeg 通吃；JPEG 无 alpha 必须**先铺白底**否则透明区变黑，文件名同步 `.jpg`）。为啥不在入口就转有损：history 回看要无损 PNG，转早了 history 也跟着糊。**根因教训**：降采样只缩尺寸不降格式，复杂内容（满屏文字/细节）2560px PNG 仍 10–13MB，超云端 8MB/张上限被**静默 skip**（不建附件、请求仍 200、history 列表只显封面图所以看不出丢）→ 多图只落 1 张。改截图链路**必须同时想「上传那一刻这张图多大、目标接受什么格式」**，不能只盯尺寸。失败（无 canvas / createImageBitmap throw / toBlob null）一律兜底返原图（宁可发大也别丢截图）。另一类「只存 1 张」根因在服务端迁移正则（漏匹配 cloud 单图模板结构 → 多图字段没补进去），见 moo-scaffold-cloud。

> **截图降采样链路速记**（v0.8.13 加，碰截图/上传体积先看）：`captureVisibleTab` 返的是**物理像素** PNG —— 高 DPI / retina 屏（DPR 2–3）下 1280 CSS 宽实际 2560–3840px、单图 5–6MB，多图叠加易撞 webhook/zentao 重试队列 1MB 上限。`downscaleToMaxWidth`（`src/utils/image.ts`）**收口在 SW 截图 handler 截完即缩**这一个点（不是上传端各自缩）→ 标注/预览/上传/history 全链路拿同一张缩好的图，避免多处各缩一遍 / 漏缩。语义必须跟服务端 `ImageDownscaler::toMaxWidth` **对齐**：① 只缩不放（≤2560 原样 return，别放大糊）② 高度按比例 ③ **保留原格式**（PNG→PNG 保文字清晰 + alpha，JPEG→JPEG）④ 解码失败（无 canvas / createImageBitmap throw）**返原图不抛**（宁可发大图也不丢截图）。两端都缩是防御纵深不是重复劳动：扩展先缩省带宽，服务端见 ≤2560 跳过、见 >2560（老客户端）兜底。改这块**必须同步核对服务端 ImageDownscaler 语义**别让两端漂移。

> **发版踩坑速记**（v0.8.12 这次踩，下次发版必看）：`pnpm release --publish` 会**重新 build + 重打 zip**，而 vite 产物文件名带 content-hash → 两次构建字节不同 → **zip sha256 会变**。若上一会话已 bump/tag/push 留下旧 zip，这次 publish 重打的新 zip sha256 跟旧的对不上。**回填 HANDOFF 的 sha256 一律以「Gitee release 页面实际挂着的产物」为准**（curl 下来 `shasum -a 256` 核对），不是任何缓存/口头给的旧值 —— 否则用户下载 `shasum -c` 必失败。另：e2e 全量 181 条单 worker 串行偶发 1 条 flake（本次 MS7 `dialog-multi-shot:138` ESC cancel 时序），单独 `--repeat-each=3` 重跑 + 全量复跑均全绿确认非回归后再发。

> **webhook 默认模板字段复盘速记**（v0.8.11 这次踩，碰多图/模板先看）：v0.8.10 加多图截图，但 `DEFAULT_PAYLOAD_TEMPLATE` 只写了 `"screenshot": "{{image}}"`（首图），**漏了 `{{imagesJson}}`** —— 所有用默认配置的 base64/JSON webhook（含 cloud intake，最常见路径）不管截几张都只发第一张且无提示。**为什么测试没抓到**：多图单测/e2e 全用手写特制模板 `{"images":{{imagesJson}}}`，没一个用真实 `DEFAULT_PAYLOAD_TEMPLATE` = 测了没人会用的配置。核心 lesson：**回归守卫必须用真实默认模板断言，别用手写 mock 模板自欺**。另一个陷阱：`migrateServerTemplate` 照搬 v0.4.7 video 迁移时「已含 video 即提前返回」会吞 screenshots 迁移 —— 多个迁移项必须各自独立判断，不能一个命中就 early return。

> **版本检查链路复盘速记**（这块连撞两次，下次改先看）：v0.8.1 hotfix 修「fetch fail 谎报已是最新」（三态返值），v0.8.5 修「stale flag 谎报旧版当新版」（读取时 live 重比）。核心 lesson：**版本检查 flag 写入时刻缓存的 current 不可信，必须读取时刻用 live manifest 重比** —— 因为用户实际升到的版本未必等于当初被提示的版本。`src/utils/versionCheck.ts` 的 `readValidStoredVersionInfo()` 是唯一收口点，任何「读 VERSION_CHECK_FLAG 判断要不要弹 banner」都该走它，别再内联 `age < 7d` 裸判定。

> **动态注入链路复盘速记**（连撞三次，碰注入先看）：v0.7.2 修「WAR `use_dynamic_url` 让 content lazy chunk 加载失败、悬浮球出不来」；v0.7.6 修「dynamic register 不向已 navigated tab 注入 → backfill executeScript 回填 + 孤儿 host 重建」；v0.8.7 修「backfill 对**已注入** tab 重复 executeScript 致重复采集」。核心 lesson：**`chrome.scripting.executeScript` 不去重（去重只对 declarative `registerContentScripts` 在同一 navigation 内成立）** —— `syncContentScripts → backfillExistingTabs` 在 config 变化 / SW spin-up 都会对已注入 tab 再注入一次，所以注入端必须自己幂等：MAIN world（`main-world.ts`）用 `window.__mooMainPatched` flag 挡重复 patch（MAIN world 是页面世界、reload 不重置，老 patch 仍工作所以重注入跳过是安全的）；ISOLATED（`content/index.ts`）把 onMessage listener + Vue app 句柄存 window、重建前清旧。**改 `dynamicScripts.ts` / 两个注入入口前必看这条。**

**Backlog（被动等待 / 非阻塞）**：

- **3 个 npm 依赖漏洞**（rollup / esbuild / vite）：都是 dev-time only 不影响用户运行；需要 vite 5→6 + @crxjs 2.0-beta→2.4 major bump，单独升级波
- **等禅道补 v2 Module 章节后收口 listModules**（被动等待）：当前唯一保留的 v1 endpoint
- **knip / ts-prune 死代码扫**（手动定期跑）：v0.4.4 试过两个工具 false positive 严重，标 backlog，未来如果有更好工具再上 CI
- **popup / History 各写一份 `remoteStatus → 中文` 映射**（低价值延后）：当前两处文案一致 + 状态枚举稳定，不主动收口
- **可能的禅道实例兼容跟进**（dogfood 反馈再说）：① 其他禅道版本（开源版 12 / 老版本）兼容回归 ② 附件大小阈值校准 ③ multipart 重试 IndexedDB blob 过期清理 ④ 自签证书 SSL 场景

**审视过没看到优化机会的维度**：v0.4.5 大复盘验证过 postMessage 安全 / type 漏洞 / storage quota / UX 三态 / 长文件拆分 5 个维度无优化空间（除非业务变化，下次审视可跳过），明细已归档至 [docs/handoff-archive/v0.4.4-v0.4.9.md](docs/handoff-archive/v0.4.4-v0.4.9.md)。

## 干活之前先看几个文件

| 你要碰这个 | 先读这个 |
|---|---|
| 上报 / 重试 / 状态回查 | `src/background/index.ts` |
| 抓 fetch/XHR 的钩子 | `src/injected/main-world.ts` + `src/content/useRequests.ts` |
| 录屏状态机 | `src/offscreen/index.ts`（每个状态迁移都有原因，别凭直觉简化）|
| 截图标注 | `src/content/Annotator.vue` |
| DevTools 4 个 Tab | `src/devtools/tabs/{Overview,Environment,History,Settings}.vue` |
| 消息协议 | `src/types/messages.ts`（强类型 dispatch）|
| 字段语义、模板变量（B 路径） | `docs/SERVER_INTEGRATION.md` |
| **禅道集成** | `src/background/zentao/{client,submit}.ts` + `docs/ZENTAO_SETUP.md`（用户手册）|
| logo / 品牌 | `docs/LOGO_BRIEF.md`（鹰图腾来自团队身份，**不要**换）|
| CI / pre-commit | `.github/workflows/ci.yml` + `package.json` 的 `simple-git-hooks` |

## 工程约束（必须遵守）

- **不绕 hook**：`pnpm type-check && pnpm test` 是 pre-commit 跑的，过不了就修，不要 `--no-verify`。
- **不关 `noUncheckedIndexedAccess`**：写数组/对象索引时显式处理 `undefined`。
- **改 `src/types/messages.ts` 要看清下游**：dispatch 走强类型，新增 message 要把所有 handler 补齐才能过编译。
- **改 `injected/main-world.ts` 的 payload shape 必同步改 validator**：见上面坑 #2。

## 几条沟通备忘

- 团队名 **mooeen（沐恩）**，基督教背景，鹰图腾呼应「如鹰展翅上腾」。身份核心，不要改。
- 发版节奏：成批了再发；非 BREAKING + 全绿 + 用户明示放行可跳 dogfood ≥ 几天那条（v0.8.2/3/5/6/7 直到 v0.8.10 都是这么跳的，有红→绿单测/e2e 锁回归）。
- 文档风格：「不要堆术语，用人话」。所有 commit message / 文档都按这个标准写。
- Logo 不要再换。f44 黑鹰头 + 黄 reticle 这版定稿（v0.1.10）。

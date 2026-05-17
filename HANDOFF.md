# 交接

> 写给明天接班的同事。读完知道现在到哪、有什么坑、下一步该干嘛。

## 一句话现状

扩展功能完整可用（v0.1.6 已发布，下一版 0.1.7 是最近 5 轮 bug 修复待发），核心三件事都跑通了：**抓数据 + 标注 + 提交后端**。最近一周没新功能，全在修隐性 bug 和打磨 UX。

## 这周做了什么

**主线**：发完 0.1.2 之后，针对实际用过的反馈做了一轮 UX 大重构（24 项，见 commit `86df0fa`），然后又跑了 5 轮深度审计修了 5 类隐性问题（commit `b1db56c` → `7708834`，本文叫 Pass 1-5）。

| Pass | 主题 | 为什么重要 |
|---|---|---|
| 1 | 商店审核三件套 | 删多余的 cookies 权限、抹掉注入页面的 console 留痕、生产构建剥 console（防 token 落到日志被人偷看）|
| 2 | token leak 防御 + listener 泄漏 | 后台日志原本会打印完整 Authorization header；ContentApp 两个 listener 没拆，每次配置变更触发 N 次刷新 |
| 3 | postMessage origin 校验 + payload 形状校验 | 抓请求是页面跨 world `postMessage` 投递的，原来同源脚本可以伪造一条假请求让用户提交给后端 |
| 4 | 重试队列 / 状态回查 / 失败留痕 | 带视频的失败提交超 storage 配额 set 抛错，老 history 缺 token header 导致同步状态永远 0 更新，找不到项目时直接 return 留历史黑洞 |
| 5 | 截图入库前压缩 + history 字段归一化 | 1080p PNG 入 storage 实际只能存 5-8 条（声称 30 条是误导），现在缩到 ≤1280 宽 + JPEG 0.75 |

并发的 UX 重构主要是：Annotator 撤销重做 / 选中删除、SubmitDialog 字段重排和折叠、Overview 请求+错误合并时间线、Environment 自动保存、暗色主题适配、a11y 收尾。详细 24 项在 commit `86df0fa` 的 message 里。

## 你最该知道的 3 个坑

### 1. 录屏的入口必须是键盘快捷键，不能是按钮

Chrome MV3 要求 `tabCapture.getMediaStreamId` 在用户键盘手势上下文里调。content script 里 click 经过消息转一手，手势就丢了——所以悬浮球的「录屏」按钮永远不能真正触发录屏。

**当前做法**：按钮只显示一个 `⌥⇧R` 的 kbd 标签提示。如果你想做新入口，必须走 `chrome.commands` 注册快捷键，不要再尝试 click。

### 2. 抓请求是同源 postMessage，假数据很容易塞进来

`src/injected/main-world.ts` 注入 MAIN world hook 住页面的 fetch/XHR，然后 `window.postMessage` 投递到 content script 的 `useRequests.ts` / `useErrors.ts`。

Pass 3 已经加了三重防御（origin 限定、收端 origin 校验、payload shape 校验），但**同源恶意脚本还是可以精心构造一条合法 shape 的假请求**。这是 contract 的固有缺陷——同源脚本本身能干更糟的事（直接 fetch、改 cookie、读 localStorage），所以现在只做劝退式防御。

新增字段时记得同步更新 `isValidRequestPayload` / `isValidErrorPayload`，否则旁路就开了。

### 3. chrome.storage.local 只有 10MB

history 一条带原图能到 800KB，30 条 = 24MB 直接爆。Pass 5 已经处理了**截图**（入库前缩到 ~150KB），但提交时**给后端的还是原图**（`screenshot` 字段直接拿 `chrome.tabs.captureVisibleTab` 的原图，没缩）。

录屏更狠，30 秒 webm ~17MB。所以：
- 重试队列对单条 body > 1MB 不入队（Pass 4 加的）
- 录屏失败的提交不会自动重试，要用户手动到「历史」Tab 点重新提交
- 任何新加的写 storage 的代码都要 try/catch 配额错，别让上游误以为成功了

## 现在最值得做的下一件事

**发 0.1.7**。Pass 1-5 累积的 5 个修都是高价值（安全 + 用户感知的"无声 bug"），已经够一个版本，再憋下去就忘了。

发版步骤：

```bash
pnpm release       # 走 scripts/release.mjs，会改 manifest 版本 + 打 tag
pnpm build         # 打包出 dist
# 把 dist 压 zip 传到 gitee Releases
```

发完之后，按价值排序的下一批：

1. **悬浮球默认位置避开宿主页 fixed 元素**——现在写死 `right:200, bottom:70`，可能盖住网站客服气泡。可以做边缘吸附 + 拖出去后记忆位置（已有位置记忆，缺的是初始位避让）。
2. **按钮样式系统化**——`.moo-btn` 在 devtools / tokens.css / content shadow DOM 三处各有副本，命名也不一致（`primary` vs `moo-btn--primary`）。改动面大但拖久了越乱，建议单独立项 PR。
3. **暗色主题打磨**——tokens 全套 dark 已加，但实际跑深色模式时各 tab 内还有硬编码颜色没扫到。建议实机走一圈截图回看。

不急的：
- 多 server 时附件元素 × 删除按钮加二次确认（故意没加，可重新评估）
- 关闭按钮做 `<MooCloseBtn>` Vue 组件（现在只提了 CSS）
- Settings 和 Environment 走同一个自动保存范式（现在 Environment 用 draft 中间层，Settings 直接 v-model）

## 干活之前先看几个文件

| 你要碰这个 | 先读这个 |
|---|---|
| 上报 / 重试 / 状态回查逻辑 | `src/background/index.ts` |
| 抓 fetch/XHR 的钩子 | `src/injected/main-world.ts` + `src/content/useRequests.ts` |
| 截图标注 | `src/content/Annotator.vue` |
| DevTools 4 个 Tab | `src/devtools/tabs/{Overview,Environment,History,Settings}.vue` |
| 字段语义、模板变量 | `docs/SERVER_INTEGRATION.md` |
| logo / 品牌 | `docs/LOGO_BRIEF.md`（鹰图腾来自团队身份，**不要**换成虫子 / 箭头 / 光标）|

## 几条沟通备忘

- 团队名是 **mooeen（沐恩）**，基督教背景，鹰图腾呼应「如鹰展翅上腾」。这是身份核心，不要被改。
- 发版节奏：每改一次就 bump + release 太碎，**等成批了再发**。这次 Pass 1-5 就够一版。
- 文档风格：用户用过反馈是「不要堆术语，用人话」，所有文档都按这个标准写。

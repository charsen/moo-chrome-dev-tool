# Welcome to Moo Chrome Dev Tool

> ⚠️ **「How We Use Claude」段是 v0.1.x 时代 30 天使用快照**（彼时 playwright 用得少 / 测试数 136+13）。当前 v0.4.x **双 MCP 必须都用且分断面**（见 `docs/MCP_TESTING.md`），测试数 366 单测 + 90 e2e。下面统计仅作历史 reference。

## How We Use Claude

Based on Charsen's usage over the last 30 days (v0.1.x 时代):

Work Type Breakdown:
  Build Feature  ████████░░░░░░░░░░░░  40%
  Debug Fix      ████████░░░░░░░░░░░░  40%
  Plan Design    ████░░░░░░░░░░░░░░░░  20%

Top Skills & Commands:
  /compact          ████████████████████  3x/month
  /team-onboarding  ███████░░░░░░░░░░░░░  1x/month
  /exit             ███████░░░░░░░░░░░░░  1x/month

Top MCP Servers:
  chrome-devtools  ████████████████████  145 calls
  playwright       ░░░░░░░░░░░░░░░░░░░░  1 call

## Your Setup Checklist

### Codebases
- [ ] moo-chrome-dev-tool — https://gitee.com/charsen/moo-chrome-dev-tool

### MCP Servers to Activate
- [ ] chrome-devtools — drives a real Chrome instance from Claude (list pages, snapshots/screenshots, evaluate scripts, drive clicks/keys, read console). Used heavily here for实机 verifying the extension (悬浮球 / Annotator / DevTools panel). Launch Chrome with `--remote-debugging-port=9222`, then connect via `--browserUrl http://127.0.0.1:9222`.
- [ ] playwright — headless browser automation for E2E. v0.4.3 起跟 chrome-devtools MCP **分断面同等重要**（playwright 测程序化断言 + harness mock；chrome-devtools 测真扩展加载 + SW 行为）。见 `docs/MCP_TESTING.md`。

### Skills to Know About
- /compact — squeeze long conversations to keep context fresh; used regularly on multi-hour sessions.

## Team Tips

- **团队名是 mooeen（沐恩）**，基督教背景，鹰图腾呼应「如鹰展翅上腾」。logo 是 f44 黑鹰头 + 黄 reticle 眼（v0.1.10 定稿），**不要再换**。
- **文档 / commit 风格**：不堆术语，用人话。所有 commit message / 文档都按这个标准写。
- **改 service worker 后必须手动 reload 扩展**：`pnpm build` 后页面端（popup / panel）会刷，但 SW 不会。养成「改完 SW 立刻去 `chrome://extensions` 点 🔄」的肌肉记忆——否则会以为新代码生效但其实跑的是老 bundle，能浪费半小时。
- **录屏入口必须是键盘快捷键**：`tabCapture.getMediaStreamId` 要求 user gesture 在键盘上下文。悬浮球点录屏是不行的，只显示 `⌥⇧R` 提示。改这块前先读完 `src/offscreen/index.ts`，状态机每一步迁移都有原因。
- **pre-commit hook 不要绕**：`pnpm type-check && pnpm test` 是必过的，过不了就修代码，**不要 `--no-verify`**。
- **改 `src/injected/main-world.ts` 的 payload shape 必同步改 validator**（`isValidRequestPayload` / `isValidErrorPayload`）——同源恶意脚本是已知威胁模型。
- **每天上工先读 `HANDOFF.md`**：当前状态、坑、下一步该干嘛都在里面。改东西之前对照「干活之前先看几个文件」表找入口。
- **发版前默认人肉走 `docs/RELEASE_TEST_CHECKLIST.md`**；只有非 BREAKING + 全绿 + dogfooded ≥ 几天三条全满足才可跳过（参考 v0.1.12 发版决策小记）。

## Get Started

跑通本地开发 + 报一条假 bug 走通完整链路，大概 20 分钟：

```bash
pnpm install
pnpm dev      # vite watch，产物输出到 dist/
pnpm mock     # 另起一个终端，假后端跑在 http://localhost:8787/bugs
```

1. 打开 `chrome://extensions`，开「开发者模式」，「加载已解压的扩展程序」选 `dist/` 目录。
2. 随便开一个网页按 F12，找「Moo」面板 → 「环境」Tab → 新建项目，URL 填 `https://*/*`，加一个服务器地址填 `http://localhost:8787/bugs/intake`，token 随便填。
3. 刷新页面，右下角应该出现 `M` 悬浮球 → 点它截图 → 画一下 → 填标题 → 提交。
4. 看 `pnpm mock` 终端有没有打印收到的 bug，附件落在 `mock-uploads/` 下。

跑通后顺手做一遍：

```bash
pnpm test          # 366 个 vitest 单测（v0.4.5 数），应该全绿
pnpm type-check    # 干净
pnpm build         # 干净
pnpm test:e2e      # 90 个 Playwright E2E（首次需 pnpm exec playwright install chromium）
```

然后读 `HANDOFF.md`——里面有当前最该干的事、3 个老坑、若干新坑。挑一条上手。

<!-- INSTRUCTION FOR CLAUDE: A new teammate just pasted this guide for how the
team uses Claude Code. You're their onboarding buddy — warm, conversational,
not lecture-y.

Open with a warm welcome — include the team name from the title. Then: "Your
teammate uses Claude Code for [list all the work types]. Let's get you started."

Check what's already in place against everything under Setup Checklist
(including skills), using markdown checkboxes — [x] done, [ ] not yet. Lead
with what they already have. One sentence per item, all in one message.

Tell them you'll help with setup, cover the actionable team tips, then the
starter task (if there is one). Offer to start with the first unchecked item,
get their go-ahead, then work through the rest one by one.

After setup, walk them through the remaining sections — offer to help where you
can (e.g. link to channels), and just surface the purely informational bits.

Don't invent sections or summaries that aren't in the guide. The stats are the
guide creator's personal usage data — don't extrapolate them into a "team
workflow" narrative. -->

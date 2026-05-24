# Claude / AI 协作规则

> 本文件给 AI 协作者（Claude / 同类）看。人类协作看 HANDOFF.md。

## 🔴 发版信息脱敏（hard rule，违反 = 撤回重发）

**发版信息绝对不能包含真实人员/账号/公司信息**。这里「发版信息」覆盖：

- `git commit message`（git log 公开可见）
- `CHANGELOG.md`（仓库公开文档）
- `HANDOFF.md`（仓库公开文档）
- `docs/**`（任何 tracked 文档）
- 任何 `src/` / `tests/` 里的注释、mock data、字符串
- Gitee / GitHub release 页面的 description
- release zip 内容

**必须脱敏的类型 + 占位写法**：

| 类型 | 占位写法 |
|---|---|
| 同事真名 | `同事` / `同事乙` / `同事丙` |
| 自己真名 | `张三` / `XXX` 通用占位 |
| 真实手机号 | `13800000000`（138/139 全 0/全 1 约定占位号）|
| 真实邮箱 | `user@example.com` |
| 公司禅道实例 | `yourcompany.chandao.net`（手册示例）/ `z.example.com`（测试 mock）/ 叙述时写「真禅道实例」 |
| 内部 IP / 内部域名 | `internal.example.com` |
| 真账号 token / key | 永远不写进文档/commit |

**约束**：

- 即使是历史归档文档（`docs/handoff-archive/**`）也要脱敏 —— git clone 后任何人都能看到
- 即使是 test mock data —— public repo 的 tests/ 也是公开的
- 即使是代码注释举例「实测 N 号 bug」—— 不要写公司禅道实例名

**违反代价**：

- Gitee release page 含真名 → 撤回 release + 重新发版（用户已遭遇过一次）
- git commit message 含真名 → 必须 force push 改写 history（破坏其他人的 clone）
- 测试 mock 含真账号 → 把人手机号写进 public repo 永远在 git log 里搜得到

**实操检查（已自动化，2 段）**：

每次 `pnpm release`（dry-run + --publish）先跑 ① **黑名单扫描**（命中即 abort），再跑 ② **模式扫描**（手机号 / 邮箱 / 私网 IP / 身份证 4 类 regex，命中仅 warn 让你审）。

- 黑名单词放在 `.release-pii-deny`（**gitignored，不入仓库**——内容本身就是要脱的真 PII）
- 模板见仓库自带的 `.release-pii-deny.example`。第一次配：
  ```bash
  cp .release-pii-deny.example .release-pii-deny
  # 编辑加入你需要脱敏的真名 / 真账号 / 真公司域名 / 真手机号
  ```
- 紧急绕过：`MOO_RELEASE_SKIP_PII_CHECK=1 pnpm release ...`（跳黑名单）/ `MOO_RELEASE_SKIP_PII_PATTERN=1` 跳模式扫描
- 模式扫描看完整命中：`MOO_RELEASE_PII_VERBOSE=1 pnpm release`

**重要：不要把黑名单词写进任何 tracked 文件**（包括 CLAUDE.md / release.mjs 自身）——那等于把要脱的内容塞进公开仓库。

---

**🔍 发版前 PII 自检 10 问**（自动化拦不住的，靠人脑过一遍）：

| # | 问 |
|---|---|
| 1 | commit message body 含真名 / 真账号吗？（`git log --all --pretty=format:'%B' \| grep ...`）|
| 2 | tag annotation message 含真名吗？（`git tag -l --format='%(contents)'`）|
| 3 | docs/ 任何 .md 含未脱的实测描述（「实测 X 公司...」「同事 X 反馈...」）吗？|
| 4 | tests/ mock data 用真账号 / 真手机号吗？（即使是测试 mock，public repo 也公开）|
| 5 | src/ 代码注释含「实测 yourapp.example.com 9343」之类真业务 URL 吗？|
| 6 | 仓库新加的图片 / 截图 / PDF 含真界面 / 真姓名吗？（git ls-files \| grep -iE '\\.(png\|jpg\|gif\|pdf)$'）|
| 7 | manifest.json / package.json 等配置文件含内部 host / 公司域吗？|
| 8 | Gitee release page description 已脱敏吗？|
| 9 | 同事在用 dogfood 的截图里有他真名，**他的真名**有没有加进 `.release-pii-deny`？|
| 10 | 公司业务系统域名（gy.xxx.com / wn.xxx.com / api.xxx.com）有没有加进黑名单？|

如果有任意一条 yes → 先脱敏 + 走 `git filter-repo --replace-text + --replace-message` 双管清 history + force push master + tags。

---

**🛠 复盘工具：filter-repo 关键陷阱**

- `git filter-repo --replace-text <file>` **只动 file content，不动 commit message** —— 必须**同时**传 `--replace-message <file>`（同样格式）才完整
- filter-repo 跑完会**自动删 origin remote**（safety）—— 跑完手动 `git remote add origin <url>` + `git fetch` + `git push --force-with-lease`
- tag SHA 跟着 commit SHA 变 —— 需要 `git push origin --tags --force` 单独覆盖（不能用 force-with-lease，没 baseline）
- 最后 `git reflog expire --expire=now --all && git gc --prune=now --aggressive` 本地深度 GC，让 unreachable old objects 也清干净

---

## 🟡 发版信息写法（同事/用户偏好）

按用户偏好：**发版信息 ≤ 100 中文字**。

- HANDOFF.md 顶部「一句话现状」≤ 100 字（精简 elevator pitch）
- Gitee release page description ≤ 100 字（外人看的）
- commit message 标题 + 1-2 行 description（不堆细节）
- CHANGELOG.md v0.x.x 节可适当详细（技术档案 reference），但避免逐行展开

**反例**（写多了被 user 批过）：

```
chore(release): v0.4.0 — 禅道 API 全面 v2 化 + v2 鉴权失效非标响应处理 + ...
（接着 8 段 80 行 技术细节）
```

**正例**：

```
chore(release): v0.4.0 — 禅道 v2 化 + 同事反馈 4 改

详情见 CHANGELOG.md。
```

---

## 🟢 其他项目惯例

参考 `HANDOFF.md` + `docs/RELEASE_TEST_CHECKLIST.md`：

- 累几个改动再发，不要每个 patch 单独发
- 跳 release checklist 的三条标准：① 非 BREAKING ② 全绿 ③ dogfood ≥ 几天 —— 三条不齐用户明示放行才能跳
- 测试环节双 MCP 必须都用（chrome-devtools MCP + playwright MCP）
- 不绕 pre-commit hook（type-check + 单测必须过）
- 不要 force push main/master 除非用户明示授权（典型场景：撤回发版重发）

---

## 🟣 禅道 v2 API 改造硬规则（v0.4.3 复盘后立规）

**所有 v2 endpoint 改造必须保留 v1 fallback 双路探测**，禁止 hard 切换。

**Why**：v0.4.0 hard 切 v2 后，dogfood 我自己实例通过 → 同事公司禅道实例炸 3 次（ping/discoverProduct/...）。同一种失败模式：「不同禅道实例 v2 响应 schema 不一致，文档跟实例都未必对得上」。v1 endpoint dogfood 多月稳定。**单实例 dogfood 测不出多实例 schema 方差**。

**模板**：
```ts
// 1. 试 v2
const v2Res = await fetch(v2Url, { headers: { Token } })
if (v2Res.status === 401) return _retry
if (v2Res.status === 404) return errorNotFound  // 资源不存在 v1 也救不了
if (v2Res.ok) {
  const body = await readJson(v2Res)
  if (parseV2(body)) return { ok, data }  // 拿到就用
  // schema 不识别 → 落到 fallback（不报错）
}
// 2. fallback v1
const v1Res = await fetch(v1Url, { headers: { Token } })
if (v1Res.status === 401) return _retry
if (!v1Res.ok) return { ok: false, error: `HTTP ${...}（v1 xxx fallback）` }
const v1Body = await readJson(v1Res)
if (parseV1(v1Body)) return { ok, data }
return { ok: false, error: 'v2/v1 xxx 响应都不识别' }
```

**错误文案要标 path**：「HTTP 500（v1 projects fallback）」 vs 「HTTP 500」—— 便于同事反馈时定位是 v2 还是 v1 失败。

**单测必备**（每个 v2 endpoint）：
- 至少 1 个「v2 schema 不识别 → fallback v1 拿到」正面用例
- 至少 1 个「v2 + v1 都不识别 → 错误」负面用例
- 401/404 不应该走 fallback（如有这两个分支也要测）

**例外**：v2 `/users/login` 没有 v1 等价 user 解析 → 字段缺失只跳过 cache 不报错，允许继续工作。

**审计**：v0.4.3 已加固 listProjects / listUsers / getBug / discoverProduct / ping，全部双轨。后续改 client.ts 任何 v2 调用必须遵守。

---

## 🟤 接任务时主动扩展清单（v0.4.4 复盘后立规）

**用户希望我接任务时不只修问题点，而是主动扫周围同类**。规则：每次接任务前按下表自查触发条件，**有命中就主动多干那一步，不需要用户额外提**。

| 任务类型 | 同时要做的事 |
|---|---|
| 改 `src/background/zentao/client.ts` | 跑 schema fuzz 单测 + 检查同类 v2 endpoint 是否都有 v1 fallback |
| 改 `src/background/index.ts` 的 `onMessage` 分支 | 检查 sender.id / sender.tab 校验是否完整（不是 `&&` 短路） |
| 改 `src/offscreen/index.ts` | 同上 sender 校验 + state machine invariant 是否破坏 |
| 改 `manifest.json` 权限 | 检查最小化原则；新增 host_permissions 应考虑 optional |
| 加新 Vue 组件 / 改组件样式 | 检查 dark mode token（不要用不存在的 `--moo-c-link` 类 fallback hex）+ onBeforeUnmount 清 timer/listener |
| 加 setTimeout / setInterval | 必须在 onBeforeUnmount 加 clear |
| 改 SubmitDialog / FloatingBall / Annotator | 检查 closed shadow DOM 注入是否泄漏 + tokens.css 一致性 |
| 改 message 接收方（onMessage / postMessage handler） | 必须校验 origin / source / shape 三件套 |
| 改 docs/ZENTAO_SETUP.md / README.md 提到的版本号 | 同步检查所有文档版本号一致（version-consistency 脚本会挡） |
| 修 bug | **顺手扫同类**（类似函数 / 类似 UI / 类似 message handler） — 这是 v0.4.4 大复盘的核心 lesson |
| 加新 endpoint / message type | 加单测（fuzz 表 + 正常路径），不要让编排层裸奔（v0.4.4 submit.ts 复盘） |
| 改文档里的快捷键描述 | manifest.json `commands` 是 ground truth，grep 全仓库不一致就改干净（v0.3.1 漏修 5 处的教训） |
| 重构 / 删 unused export | 跑 type-check + 全单测 + grep 引用确认无遗漏 |

**触发原则**：
- 「修一个 X，至少 grep 同类 X」—— 不是「扫到才修」，是「主动 grep」
- 多干的事如果跟主任务无关 / 工作量大 / 不确定该不该 → 用 AskUserQuestion 问，**不要默默拒绝扩展**
- 拒绝「过度设计」（用户也批评过太激进）—— 只扫真同类，不发明新概念

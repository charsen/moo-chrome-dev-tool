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

**实操检查（已自动化）**：

- 每次 `pnpm release`（dry-run + --publish）都跑 pre-flight 脱敏 grep
- 黑名单词列表放在 **`.release-pii-deny`**（**gitignored，不入仓库**——内容本身就是要脱的真 PII）
- 模板见仓库自带的 **`.release-pii-deny.example`**。第一次配：
  ```bash
  cp .release-pii-deny.example .release-pii-deny
  # 编辑 .release-pii-deny 加入你需要脱敏的真名 / 真账号 / 真公司域名 / 真手机号
  ```
- 命中即 abort。紧急绕过：`MOO_RELEASE_SKIP_PII_CHECK=1 pnpm release ...`
- **重要：不要把黑名单词写进任何 tracked 文件**（包括 CLAUDE.md / release.mjs 自身）—— 那等于把要脱的内容塞进公开仓库

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

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

**必须脱敏的内容**：

| 类型 | 真实例 | 脱敏写法 |
|---|---|---|
| 同事真名 | 「同事反馈」 | 「同事反馈」 |
| 自己真名 | 「张三」 | 「张三」 / 「XXX」通用占位 |
| 真实手机号 | `13800000000` | `13800000000` 占位号（138/139 全 0 / 全 1）|
| 真实邮箱 | `someone@example.com` | `user@example.com` |
| 公司禅道实例 | `yourcompany.chandao.net` | `真禅道实例`（叙述）/ `yourcompany.chandao.net`（手册示例）/ `z.example.com`（测试 mock）|
| 内部 IP / 内部域名 | 任何 `*.内部域名` | `internal.example.com` |
| 真账号 token / key | 实际值 | 永远不写进文档/commit |

**约束**：

- 即使是历史归档文档（`docs/handoff-archive/**`）也要脱敏 —— git clone 后任何人都能看到
- 即使是 test mock data —— public repo 的 tests/ 也是公开的
- 即使是代码注释里举例「实测 yourcompany.chandao.net 9343」—— 改成「实测真禅道实例 N」

**违反代价**：

- Gitee release page 含真名 → 撤回 release + 重新发版（用户已遭遇过一次）
- git commit message 含真名 → 必须 force push 改写 history（破坏其他人的 clone）
- 测试 mock 含真账号 → 把人手机号写进 public repo 永远在 git log 里搜得到

**实操检查清单**（每次发版前 grep 一遍）：

```bash
grep -rEn "同事|同事乙|张三|yourcompany|13800000000" \
  --include="*.md" --include="*.ts" --include="*.vue" --include="*.json" --include="*.mjs" \
  . 2>/dev/null | grep -v "node_modules\|dist/\|\.test-output"
# 期望：无输出
```

把这条 grep 加进 `pnpm release --publish` 的 pre-flight check 也行（暂未做）。

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

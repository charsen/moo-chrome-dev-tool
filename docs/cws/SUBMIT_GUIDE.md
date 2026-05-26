# CWS 提交执行步骤（给你一步步照做）

## 准备清单（按顺序）

### 1. 隐私政策 URL（必填，5 分钟）

✅ 已建好：`/Volumes/dev/wwwroot/moo-chrome-dev-tool/docs/cws/PRIVACY.md`

**推荐 URL**（不需要额外托管）：

```
https://gitee.com/charsen/moo-chrome-dev-tool/blob/master/docs/cws/PRIVACY.md
```

Gitee 上 markdown 自动渲染，CWS 评审员能打开看。

如果想要更专业的 URL（gh-pages 形态），可以开 Gitee Pages：
1. https://gitee.com/charsen/moo-chrome-dev-tool/pages → 启用 Pages
2. 选 master 分支 → 部署
3. 拿到形如 `https://charsen.gitee.io/moo-chrome-dev-tool/docs/cws/PRIVACY.md` 的 URL

两者都行，CWS 评审认任一。

### 2. 准备 zip 包（已有）

```bash
ls -lh release/moo-chrome-dev-tool-X.Y.Z.zip   # 替换 X.Y.Z 为当前版本
```

文件已经在 release/ 里，196 KB。直接上传这个。

（如果你想发更新版，先跑 `pnpm release --publish` 拿新 zip。）

### 3. 拍 5 张截图（最花时间 / AI 不能代）

照 `docs/cws/store-listing.md` 「截图清单」5 张。

**操作前关键步骤**：

1. 在本机临时切到一个**假项目配置**（避免真实禅道 / webhook 地址进截图）：
   ```
   DevTools → Moo → 环境 → 新建项目「Demo 项目」
   - 匹配 URL: https://example.com/*
   - kind: webhook
   - 上报服务器: https://your-server.example.com/intake
   - 不要填真实 token
   ```
2. 打开 `https://example.com`，触发悬浮球
3. 录 5 张 1280×800 PNG（Chrome DevTools 截 / 系统截图工具都行）
4. 截前清空真实信息（chrome://extensions reload Moo 让 history 空）

**严禁**截图含：
- 真实公司域名（无论是禅道实例还是业务系统的，按 CLAUDE.md PII hard rule）
- 真名 / 真账号
- 真实手机号 / 邮箱

### 4. CWS 后台填表

#### Step A: 创建 item
1. https://chrome.google.com/webstore/devconsole/
2. 左上角 **New item** → 上传 `moo-chrome-dev-tool-X.Y.Z.zip`（当前版本，如 v0.7.5）
3. 等 Chrome 解析 manifest（几秒钟）

#### Step B: Store listing
按 `docs/cws/store-listing.md` 复制粘贴：

- **Title**: `Moo Dev Tool`
- **Short description**: 复制中文版（或选 English）
- **Detailed description**: 复制中文版完整段
- **Category**: `Developer Tools`
- **Language**: `Chinese (Simplified)`（主）+ `English`（副可选）
- **Screenshots**: 上传 5 张
- **Small promo tile (440×280)**: 选填，可以跳过
- **Marquee promo tile (1400×560)**: 选填

#### Step C: Privacy practices
- **Single purpose**: 复制 `store-listing.md` 内 Single purpose 段
- **Permission justifications**: 7 段（storage / tabs / scripting / alarms / offscreen / tabCapture / `<all_urls>` host），每段单独填
- **Data usage**: 勾 4 类（PII / Auth info / Personal communications / Website content）+ 复制声明
- **Privacy policy URL**: `https://gitee.com/charsen/moo-chrome-dev-tool/blob/master/docs/cws/PRIVACY.md`

#### Step D: Distribution
- **Visibility**: 推荐 **Public**（公开搜得到），或 **Unlisted**（链接才能访问 — 适合先内部 dogfood）
- **Pricing**: Free

#### Step E: Submit for review
点 **Submit for review** → 等 1-3 天

### 5. 等审核（被动）

可能结果：

✅ **通过**：你会收到 Google 邮件，扩展自动 Public（如选 Unlisted 则拿到分享链接）

❌ **打回**：邮件说明哪条不通过，常见原因：
- Permissions justification 写得太泛 → 重写更具体（例如「storage」要说存什么数据）
- 隐私政策 URL 404 / 内容不全 → 补
- 截图含敏感信息 → 重拍
- `<all_urls>` justification 评审员不满意 → 强调 optional + user-controlled

打回后改了 resubmit 通常 1-2 天再审。

---

## 你接下来要做（按顺序）

- [ ] 1. **决定隐私政策 URL**（推荐直接用 Gitee blob URL）
- [ ] 2. **拍 5 张截图**（最花时间，30-60 min）
- [ ] 3. **CWS 后台填表**（30 min 一次性，照 store-listing.md 复制粘贴）
- [ ] 4. **Submit for review**
- [ ] 5. **等邮件**（1-3 天，可能打回 1-2 次磨合）

---

## 我（AI）能帮你的剩余事项

- ✅ 修文案细节（你截图后看实际效果觉得不对的字，告诉我改）
- ✅ 应对打回邮件（你转发邮件给我，我帮你写回复 / 改 justification）
- ✅ 发新版（CWS 审核期间如果出 hotfix，可继续 `pnpm release --publish` 走 Gitee，CWS 那边等审过再单独 update 上去）

不能帮的：截图、登录 CWS 后台、缴费、收邮件。

# Errors — 历史踩坑教训

避免新 agent 重蹈覆辙。这些都是真实事故的复盘。

---

## 🔴 工程流程类

### 1. **Stacked PR 陷阱**

PR #330 当时 base 是 `feat/paid-job-safety-net-v2`（PR #329 的头分支），**不是 main**。父 agent 误以为合 #330 就把代码进了 main，实际只是合到 #329 分支，**部署时跑的还是 #328 的代码**。直到用户后来手动合 #329 到 main，#330 的代码才真正上线。

**教训**：开 PR 必须确认 `baseRefName === "main"`，否则就是 stacked PR。可以用：

```bash
gh pr view <num> --json baseRefName,headRefName
```

### 2. **共享 worktree 撞车**

主 worktree 当时被父 agent 和一个 subagent 同时使用，subagent 在 npm install + 改文件，父 agent 切分支做别的事，导致 working tree 出现夹杂状态（`M package.json` 在错误分支上）。

**教训**：任何并行工作都用 `git worktree add` 创建独立目录。新 agent 应该工作在 `/tmp/mvs-responsive` 等独立 worktree，**绝不在 `/Users/tangenjie/.codex/worktrees/974b/mvstudiopro` 主目录工作**。

### 3. **流水线没等 typecheck 就 push**

有几次 PR push 后才发现 typecheck 红，又 force push（避免之）。

**教训**：push 之前**必跑** `npm run check`。0 错才能 push。`npm run check` 实际是 `tsc --noEmit`，约 5 秒。

### 4. **部署 image hash 没变 = 部署失败**

如果 fly logs 显示 `Container image registry.fly.io/mvstudiopro@sha256:XXX already prepared` 且 hash 跟上次相同，说明根本没 build 新代码（只是重启了 machine）。

**教训**：部署后必须确认 image hash **不同于上次**。

### 5. **频繁 deploy 触发 SIGTERM 烧任务**

部署会向 main process 发 SIGTERM，正在跑的付费任务会被中断。虽然有 `paidJobLedger` 兜底退积分，但用户体验差。

**教训**：合并多个 PR 后**一次部署**，不要每个 PR 单独部署。用户跑任务时禁止部署。

---

## 🔴 视觉 / UI 类

### 6. **inline style 重写不能盲改**

GodView 237 处 `style={{...}}` 都是用户精心调过的视觉设计语言，包含品牌色、间距节奏、阴影层次等。盲目转 Tailwind className 会破坏视觉。

**教训**：每改一段先 `npm run dev` 看现状效果再改。如有疑问截图问用户。

### 7. **`maximum-scale=1` 是反 a11y**

旧 viewport meta 禁用用户缩放，iOS Safari 双指放大失效，弱视用户体验恶劣。

**教训**：viewport 永远用 `width=device-width, initial-scale=1, viewport-fit=cover`。

### 8. **iOS Safari 100vh bug**

iOS Safari 地址栏会随滚动伸缩，`100vh` 变化导致页面 layout 跳。

**教训**：`100vh` 全部替换为 `100dvh`（dynamic viewport height）。Tailwind 4.x 支持 `h-dvh` / `min-h-dvh`。

### 9. **inline style 用 px 不响应式**

```tsx
// ❌ 不响应式
<div style={{ width: 1200, padding: 60, fontSize: 18 }}>

// ✅ 响应式
<div className="w-full max-w-[1200px] mx-auto p-4 md:p-8 lg:p-15 text-base md:text-lg">
```

---

## 🔴 关键服务不要碰

### 10. **paidJobLedger.ts**

付费任务账本，控制 `holdCredits` / `refundCredits` / `appendAuditEntry` / `reapStuckPaidJobs`。**任何改动 = 真金白银风险**。响应式改造**完全不应该碰这个文件**。

### 11. **maintenanceMode.ts**

维护模式闸门，阻止部署期间新付费任务进来。误改 = 可能让任务在部署中被启动 → 中断 + 退款流。同上：**不要碰**。

### 12. **pdfTemplate.ts 主题色 + cover 排版**

5 套色板 + cover-page 980px 限高都是经过调优的。手机响应式改造**不需要碰这里**。

---

## 🟡 第三方 API 类（背景知识）

### 13. **nanoImage Vercel 端点其实返回 base64 data URL**

之前以为是 GCS https URL，实际返回 `data:image/png;base64,...` 直接入库。已通过双轨制（PR #330）修复：场景图 / 封面优先用 Gemini API key 直连 + GCS 上传拿 https URL，nanoImage 作为 fallback。

**教训**：响应式改造**不碰**生图链路。

### 14. **Vertex API aspectRatio 限制**

Vertex AI Imagen 只接受 `1:1` / `9:16` / `16:9` / `4:3` / `3:4` 五种比例。封面用 `3:4`（竖版海报）。响应式改造不碰。

---

## 🟢 前端开发风格惯例

### 15. **Tailwind 优先于 inline style**

```tsx
// ❌
<div style={{ marginTop: 24, marginBottom: 24 }}>

// ✅
<div className="my-6">
```

### 16. **Tailwind 响应式 prefix 优先于 useMobile()**

```tsx
// ❌（导致 re-render，不好）
const isMobile = useIsMobile();
<div style={{ gridTemplateColumns: isMobile ? '1fr' : 'repeat(4, 1fr)' }}>

// ✅（CSS 切换，无 re-render）
<div className="grid grid-cols-1 lg:grid-cols-4">
```

只有当结构本身要换组件（不止布局）才用 hook。

### 17. **shadcn/ui 已有组件优先复用**

`client/src/components/ui/` 下有 `<Sheet>`、`<Drawer>`、`<Dialog>` 等。手机汉堡菜单直接用 `<Sheet>`，不要自己写。

### 18. **wouter 路由不是 react-router**

注意 import：`import { useLocation, Link } from "wouter"`，API 跟 react-router 不同。

---

## 🟢 测试 / 验证

### 19. **Chrome DevTools 移动模拟器不够**

只验证了 DevTools 模拟，没在真机或 BrowserStack 测，会漏掉：
- iOS Safari 100vh / safe-area-inset
- 触摸热区
- 长按菜单
- 软键盘弹起后 layout

**教训**：关键 PR 至少在 iOS Safari 真机或 [BrowserStack](https://www.browserstack.com/) 验一次。

### 20. **截图发 review 不要只发桌面尺寸**

每个 PR 必须 3 张截图：手机 / iPad / 桌面。

---

## 🟢 沟通 / 协作

### 21. **用户偏好直接，不要绕弯**

用户会直接说「为什么不修」「这个不行」。**不要长篇辩解**，直接修 / 解释 root cause。

### 22. **不确定就先问**

用户多次说「先做完现在任务再处理」/「为何这样改」。**不要预设用户意图**，宁可问「这个改动你接受吗」。

### 23. **不要承诺已部署的事**

部署有可能跑的是旧 image。**确认 image hash 不同 + 关键日志（如启动 reap）出现，才能说"已部署"**。

---

## 🔴 多组件协调类

### 24. **改 UI 前必须先 grep 同主题组件**

PR-1 第一次提交时只改了 `client/src/components/Navbar.tsx`（185 行 tailwind），但 `Home.tsx` 实际 import 的是 `client/src/components/HomeNavbar.tsx`（277 行纯 inline style，视觉风格完全不同 — 紫粉渐变暗色调）。结果首页响应式根本没动，reviewer 在 Vercel Preview 用 Safari DevTools 看 `data-loc` 才发现。

**教训**：动 UI 文件前必须先全局搜索同主题组件，列出所有候选 + 各自在哪些页面用，确认 PR 范围覆盖所有候选才动手：

```bash
# 改 navbar 前
rg -n "import.*Navbar|import.*Header" client/src --type tsx

# 改 sidebar 前
rg -n "import.*Sidebar|import.*Drawer" client/src --type tsx

# 改 layout 前
rg -n "import.*Layout|import.*Shell" client/src --type tsx
```

仓库里同主题组件可能不止一个（HomeNavbar / Navbar / DashboardSidebar / AdminNavbar / MobileHeader 等），别只看名字最贴的那个。光看 `client/src/components/Navbar.tsx` 不够，**用户主要看的入口（首页）import 了哪个文件，那才是必改的**。


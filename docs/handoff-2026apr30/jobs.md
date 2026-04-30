# Jobs — 响应式 + PWA 改造任务清单

每个阶段独立 PR。完成一阶段 → 推 → 父 agent review + typecheck → 合并 → 才进入下一阶段。

---

## 阶段 1 — Quick Win 基础（预估 0.5-1 天）

让网页**至少在手机上不崩**。这是最小可上线版本。

### 任务 1.1 — viewport meta 修正

`client/index.html` line 6-8：

```diff
- <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1" />
+ <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
```

`maximum-scale=1` 禁用了用户缩放（违反 a11y 规范，iOS Safari 体验差）。`viewport-fit=cover` 是为了兼容 iPhone 刘海屏。

### 任务 1.2 — Navbar 汉堡菜单

`client/src/components/Navbar.tsx`：

- 桌面 ≥ md: 现有横向菜单不变
- < md (手机): 显示汉堡图标 → 点击展开 drawer / sheet（用 shadcn/ui 的 `<Sheet>` 组件）
- drawer 里所有菜单项纵向排列，点击关闭

参考 `client/src/components/ui/sheet.tsx`（shadcn 已有）。

### 任务 1.3 — MyReportsPage 卡片响应式

`client/src/pages/MyReportsPage.tsx`：

- 卡片网格 grid：手机 1 列 / iPad 2 列 / 桌面 4 列
- 大量 inline style 中找到 grid container（搜索 `gridTemplateColumns` 或 `display: 'grid'`），把固定列数改成 Tailwind 响应式 className：

```tsx
className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-6"
```

- 单卡片内部 padding / 字号也要响应（手机更紧凑）
- 下载按钮（PDF / HTML）在手机上变大（最小 44×44pt）

### 任务 1.4 — 验证

- iPhone Safari（实机或 Chrome DevTools 移动模拟器）
- iPad Safari
- 桌面 Chrome / Safari
- **截图发父 agent review**：手机 / iPad / 桌面 各一张

### PR 1 验收标准

- [ ] viewport meta 已改
- [ ] Navbar 在 < 768px 显示汉堡，drawer 可正常打开 / 关闭 / 跳转
- [ ] MyReports 卡片在 3 个尺寸下都正常显示，无横向溢出
- [ ] `npm run check` 0 错
- [ ] 3 张截图（手机 / iPad / 桌面）

---

## 阶段 2 — GodView 大重构（预估 2-4 天，最重的一阶段）

`client/src/pages/GodViewPage.tsx` 有 **237 处 inline `style={{...}}`**，全部硬编码像素，不响应式。需要逐块审视重写为 Tailwind responsive className。

### 关键子任务

1. **Hero 大卡 + 企业旗舰款 Hero** — 手机变上下堆叠，桌面横向
2. ~~**IP 基因弹窗 modal** — 手机变全屏 modal，桌面居中~~ ⚠️ **2026-04-30 事实纠错**：reviewer 实测 `client/src/components/IpProfileModal.tsx`（157 行 / 0 inline style）已用 Tailwind Wrapper 响应式（`fixed inset-0 ... px-4` + `w-full max-w-md`），桌面 `max-w-md` 居中、手机 `w-full px-4` 自动收缩。**子组件本次不动**。仅 GodViewPage L582 的 IP 基因条 trigger（含 `whiteSpace: nowrap` 移动溢出）需在 PR-2.1 顺路修。
3. ~~**进度时间轴 8 stage** — 横向时间轴在手机上变**纵向 stepper**~~ ⚠️ **2026-04-30 事实纠错**：reviewer 实测 `DeductionTimeline` 组件源码 L1596 已是 `flexDirection: "column"` 竖排，**8 节点不需改结构**。真正的移动端问题在顶卡 L1528 三列 flex（图标｜标题｜百分比），这一处放 PR-2.3 处理。
4. **表单输入区** — 手机宽度 100%
5. **取消按钮 / 维护模式 toggle** — 手机适配触摸最小尺寸
6. **TemplateStripBanner**（如还存在）— 手机变横向 snap scroll

### 实施建议

- **不要盲改**：用户对视觉设计语言要求高，每改一段先看现状是什么效果，再改。如有疑问截图问父 agent 或用户。
- **优先 Tailwind className**，少用 `useIsMobile()` hook（性能 + 简洁）
- **每改一块跑一次 typecheck + 看本地 dev server 效果**
- 先改最关键的（Hero / IP 弹窗），不重要的（角落 badge）放到阶段 3 精修

### PR 2 验收标准

- [ ] GodView 在手机上能完整跑「下单 → 看进度 → 取消」流程
- [ ] 没有横向滚动条
- [ ] 进度时间轴在手机上可读（不挤成一团）
- [ ] `npm run check` 0 错
- [ ] 多张截图（关键 region 各一张）

### 阶段 2 子 PR 拆分（2026-04-30 reviewer 拍板，4 个子 PR）

**事实数据**（reviewer 自检 + agent 自检双方一致）：237 inline style 跨 region 精确分布如下，agent 与 reviewer 偏差均在 ±10% 内。

| 子 PR | 主题 | 包含 region（行号） | inline style |
|-------|------|-------------------|--------------|
| **2.1** | 入口区响应式 | 顶栏/标题/快照库 (L457-636=44) + 三大 Agent (L637-695=11) + 趋势容器 (L696-700=1) + 半月刊 (L701-757=14) + 已派发外围 (L1085-1132=3) + 启动失败 (L1198-1217=7) | **80** |
| **2.2** | 输入流响应式 | 输入区/补充/启动 (L878-1048) | **31** |
| **2.3** | 任务推演 + 完成 + 审核 | 研报已完成 (L1050-1084=9) + 计划审核 (L1133-1197=12) + DeductionTimeline (L1474-1672=41) | **62** |
| **2.4** | 视觉锚点 + 长尾 | 定价矩阵 (L758-877=22) + ReportRenderer (L1675-1702=12) | **34** |
| **PR-2 总计** | — | — | **207**（不含延后的 Supervisor 30）/ 全 237 |

**PR-2.1 内部分 commit 纪律**（reviewer 要求，降低视觉值漏审风险）：
- commit 1：顶栏 + IP 基因条 trigger + 主标题 + 快照库 banner（L457-636，44 style）
- commit 2：三大 Agent + 趋势 + 半月刊 + 启动失败 + 已派发外围（36 style）
- 可选 commit 0（docs）：本 jobs.md 修订前置在 PR-2.1 内

**PR-2.1 量化验收标准**（reviewer 加，避免模糊"小屏可读性"）：
- 320 / 375 / 414 / 768 四档下不溢出
- IP 基因条 `whiteSpace: nowrap` 移除，改 `pre-wrap` 或 `break-words`
- 字号 ≥ 12px（a11y 红线）
- 点击热区 ≥ 44×44pt
- 桌面分支 inline style **逐字保留**（颜色 / 渐变 / 阴影绝不动）

**视觉风险红线（4 子 PR 共同）**：

```
品牌色（hex）   #7a5410 #a8761b #3d2c14 #fff7df #a87020 #d8a23a #c9a878  ← 咖啡 / 焦糖
              #FCD34D #B8860B #f5c842                                     ← 金色（旗舰 / PDF / 时间轴）
              #ff8a5b #ff4fb3 #8b5cf6 #6366f1                            ← 紫粉
渐变       background: linear-gradient(...)                                 ← ~25 处
阴影       boxShadow: 0 X Y rgba(168,118,27,0.30) 等                       ← ~30 处咖啡色阴影层次
玻璃质感   backdropFilter: blur(14-16px) + 半透明背景
字体       fontFamily: Georgia / 'PingFang SC' / Inter
特色排版   textShadow（DeductionTimeline 黑金）
```

每子 PR 改动**只能加 className（响应式）+ 拆分布局结构**，**绝不能删 / 改 inline style 里的颜色 / 渐变 / 阴影值**。

---

## ⏳ 已知延后项（不在 PR-2 范围）

### Supervisor Debug 面板（GodViewPage L1218-1358，30 inline style）

- **现状**：admin only（`{isSupervisor && (...)}` 包住），黑底荧光绿 monospace 风格
- **延后理由**：使用场景 99% 在桌面，手机适配 ROI 极低
- **何时改 / 由谁改**：PR-4 精修阶段一并清理；如果 supervisor 实际确认永远只在桌面用，可永久 backlog
- **不动条件**：本面板 30 inline style 在 PR-2.4 完成后是 GodViewPage 内唯一未响应式 region；用户/PM 可决定是否永远不改

---

## 阶段 3 — PWA 化（预估 1 天）

让用户「加到主屏幕」从主屏幕打开**全屏无浏览器栏**，看起来像原生 app。

### 任务 3.1 — manifest.json

`client/public/manifest.json`：

```json
{
  "name": "MV Studio Pro",
  "short_name": "MV Studio",
  "description": "AI 驱动的 Deep Research 战略智库",
  "start_url": "/",
  "display": "standalone",
  "orientation": "portrait-primary",
  "background_color": "#FFF7F2",
  "theme_color": "#A8E6CF",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

`theme_color` 用 spring-mint 主色（薄荷绿，参考 `server/services/pdfTemplate.ts` line 90+ 取确切 hex）。

### 任务 3.2 — index.html 引用

```html
<link rel="manifest" href="/manifest.json" />
<meta name="theme-color" content="#A8E6CF" />
<link rel="apple-touch-icon" href="/icons/icon-192.png" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="default" />
<meta name="apple-mobile-web-app-title" content="MV Studio" />
```

### 任务 3.3 — Icons

需要 3 张 PNG（找 placeholder 设计师风格的薄荷绿 + 樱桃粉 logo）：

- `/icons/icon-192.png` (192×192)
- `/icons/icon-512.png` (512×512)
- `/icons/icon-maskable-512.png` (512×512，安全区在中心 80%)

如果暂时没有设计资源，用纯色背景 + 文字「MVS」字母 logo 占位即可（Figma 5 分钟做完，或 SVG 转 PNG）。

### 任务 3.4 — Service Worker（最小骨架，可选）

如果时间紧可跳过；若做：

- `client/public/sw.js`：app shell 缓存（HTML / CSS / JS）
- `client/src/main.tsx` 注册 `navigator.serviceWorker.register('/sw.js')`
- **不缓存 API 响应**（数据要实时）

### PR 3 验收标准

- [ ] iOS Safari「加到主屏幕」打开后**无地址栏全屏**
- [ ] Android Chrome 提示「安装应用」
- [ ] manifest.json 通过 Chrome DevTools Application → Manifest 校验
- [ ] 主屏幕图标清晰（不是 favicon）
- [ ] `npm run check` 0 错

---

## 阶段 4 — 精修（预估 1-2 天）

锦上添花，不阻塞上线。

- iOS Safari 100vh 跳动 → 全局替换 `100dvh`
- 触摸热区 ≥ 44×44pt（按钮、链接最小尺寸）
- 字号阶梯：手机 14-16px / iPad 15-17px / 桌面 14-15px
- 表格 horizontal scroll（`<table>` 外包 `overflow-x: auto`）
- ReportRenderer 在线阅读字号 + 行距 + 留白移动优化
- PDF/HTML 模板预览卡片 → 手机横向 snap scroll
- 防 iOS double-tap zoom（关键按钮 `touch-action: manipulation`）

### PR-4 触摸热区裁定 backlog（PR-2.2 reviewer 4/30 拍板延期）

PR-2.2 实施补充资料区时，2 处 close `×` 按钮严格 < 44pt 但 reviewer 接受现值，归到 PR-4 统一裁定：

- **L991** `lastUploadInfo` 关闭 × 移动 32×32pt（上传成功/失败横条）
- **L1007** 文件 chip 删除 × 移动 28×28pt（文件 chip 内嵌）

**reviewer 接受理由**：Apple HIG 允许次要操作 < 44，做 44 会破坏紧凑文件 chip 视觉一致性。
**PR-4 时裁定方案**（任选其一）：
1. 保留现值 + 加 `touch-action: manipulation` 防 double-tap zoom
2. 改 36×36 折中
3. 改 44×44 + 整体 chip 重排（破坏紧凑视觉，需用户/PM 拍板）

### PR 4 验收标准

- [ ] iOS Safari 滚动时不再有地址栏跳动导致页面跳
- [ ] 主要交互按钮触摸区域 ≥ 44×44pt
- [ ] 长报告在线阅读体验流畅（行距 1.7 / 字号 16px / 段距 18px）
- [ ] `npm run check` 0 错

---

## 总时间预估

| 阶段 | 工时 | 优先级 |
|------|------|--------|
| 1 — Quick Win 基础 | 0.5-1 天 | P0（必做，先上线）|
| 2 — GodView 大重构 | 2-4 天 | P0 |
| 3 — PWA 化 | 1 天 | P1 |
| 4 — 精修 | 1-2 天 | P2 |
| **合计** | **5-8 天** | |

---

## 完成顺序

按阶段顺序，每阶段独立 PR。**1 完成不部署，可以先合 main 等 2 一起部署**（避免短时间内多次 SIGTERM 重启 fly machine）。

合并 + 部署节奏由用户决定，你只负责实施 + 推 PR + 等 review。

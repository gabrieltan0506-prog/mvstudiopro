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
2. **IP 基因弹窗 modal** — 手机变全屏 modal，桌面居中
3. **进度时间轴 8 stage** — 横向时间轴在手机上变**纵向 stepper**（一屏装不下 8 个）
   - 当前 stage 高亮 + 滚到可视
   - 历史 stage 折叠
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

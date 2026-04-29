# Important Codes — 关键代码索引

不需要 grep 全仓库 — 这里直接告诉你看哪。

---

## 🔧 useMobile Hook — 已存在，直接用

`client/src/hooks/useMobile.tsx` （breakpoint 768px）：

```tsx
import * as React from "react";
const MOBILE_BREAKPOINT = 768;

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined);
  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return !!isMobile;
}
```

**只在结构本身要换组件时用**（不止布局）。布局优先 Tailwind responsive prefix。

---

## 🎨 5 套品牌主题色 hex

来自 `server/services/pdfTemplate.ts` `buildPalette()`。PWA `theme_color` 用第 ① 套（默认）：

| ID | primary（H1）| accent（强调）| coverBg | 推荐 PWA theme_color |
|----|------|------|------|------|
| spring-mint **(默认)** | `#10B981` 薄荷翡翠 | `#FB7185` 樱桃粉 | `#ECFDF5` | **`#10B981`** |
| neon-tech | `#7C3AED` 霓虹紫 | `#06B6D4` 电光青 | `#1E1B4B` | `#7C3AED` |
| sunset-coral | `#8B5CF6` 紫罗兰 | `#FB923C` 珊瑚橘 | `#FFEDD5` | `#FB923C` |
| ocean-fresh | `#2563EB` 海蓝 | `#FACC15` 柠檬黄 | `#DBEAFE` | `#2563EB` |
| business-bright | `#1F3A5F` 海军蓝 | `#C9A858` 香槟金 | `#EAF0F6` | `#1F3A5F` |

PWA manifest 用 `#10B981` + `background_color: "#FFFFFF"`。

---

## 📍 重灾区文件（必改）

### `client/index.html`（line 6-8 viewport meta）

当前：

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1" />
```

改为：

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
```

### `client/src/pages/GodViewPage.tsx`

237 处 `style={{...}}`。建议先用 `rg -n 'style=\{\{' client/src/pages/GodViewPage.tsx | wc -l` 确认行数。重点关注：

- Hero / 旗舰款大卡（top section）
- IP 基因 modal 弹窗
- 进度时间轴（8 stage 横向 → 手机纵向 stepper）
- 表单输入区
- 取消按钮

### `client/src/pages/MyReportsPage.tsx`

81 处 `style={{...}}`。重点关注：

- 卡片网格 grid container（响应式列数）
- 单卡片内部 padding / 字号
- 下载按钮（PDF / HTML）
- 模板选择器（如果在卡片上）

### `client/src/components/Navbar.tsx`

部分响应式。需要补汉堡菜单。

---

## ✅ 已响应式做得好的参考标杆

如何从 inline style 转 Tailwind responsive，可以参考这些已经做好的页面：

- `client/src/pages/HomePage.tsx`
- `client/src/pages/Pricing.tsx`
- `client/src/pages/Storyboard.tsx`
- `client/src/components/HomePlans.tsx`
- `client/src/components/HomeFeedback.tsx`

---

## 🧰 shadcn/ui 已有组件（直接 import 复用）

`client/src/components/ui/` 下已有：

- `<Sheet>` / `<SheetContent>` / `<SheetTrigger>` — **手机汉堡菜单 drawer 用这个**
- `<Drawer>` — bottom sheet
- `<Dialog>` / `<DialogContent>` — 居中 modal（已用在 IP 基因弹窗，可能要改成手机全屏）
- `<NavigationMenu>` — 桌面横向菜单
- `<ScrollArea>` — 自定义滚动容器
- `<Card>` / `<Button>` / `<Input>` 等基础

不要自己写 modal / drawer / sheet，复用。

---

## 🚦 路由 — 用 wouter 不是 react-router

```tsx
import { useLocation, Link } from "wouter";

const [location, setLocation] = useLocation();
setLocation("/godview");

<Link href="/myreports">我的报告</Link>
```

API 跟 react-router 不同，注意区分。

---

## 🛠️ 常用命令

```bash
# typecheck（必须 0 错才 push）
npm run check

# 本地 dev server
npm run dev   # 默认 localhost:5173 (Vite)

# build 检查
npm run build

# git worktree 创建独立工作目录
git worktree add /tmp/mvs-responsive -b feat/responsive-mvp origin/main
cd /tmp/mvs-responsive

# 完成清理 worktree
cd /Users/tangenjie/.codex/worktrees/974b/mvstudiopro
git worktree remove /tmp/mvs-responsive

# PR
gh pr create --title "..." --body "..."
gh pr view <num> --json baseRefName,headRefName  # 确认 base 是 main
```

---

## 🚫 不要碰的文件

- `server/services/paidJobLedger.ts` — 付费账本
- `server/services/maintenanceMode.ts` — 维护模式
- `server/services/pdfTemplate.ts` — PDF 主题色 + cover 排版
- `server/services/deepResearchService.ts` — 核心研报逻辑
- `server/services/echartsServerRender.ts` — PDF 图表 SSR
- `server/services/htmlReportTemplate.ts` — HTML 交互导出
- `server/_core/index.ts` — 启动 / SIGTERM 兜底
- `drizzle/` — DB schema
- 任何 `server/services/*.ts` — 本任务**纯前端**
- `Dockerfile` / `fly.toml` / `package.json` 主依赖（除非要加 PWA 库，先问）

如果阶段 3 PWA 化需要 service worker，可以加：

- `vite-plugin-pwa`（如果想要现成方案，但需评估是否跟现有 Vite 配置兼容）
- 或纯手写 `client/public/sw.js`（更可控）

加 npm 依赖**先问**用户。

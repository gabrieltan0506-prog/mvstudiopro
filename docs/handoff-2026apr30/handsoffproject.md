# Handoff — 响应式 + PWA 改造

**交接日期**: 2026-04-30
**项目**: `mvstudiopro`（github.com/gabrieltan0506-prog/mvstudiopro）
**用户**: gabrieltan0506@gmail.com
**生产域名**: https://mvstudiopro.fly.dev
**审核 agent**: 父 agent（同一会话）会在每个阶段 PR 后做 diff review，typecheck 必须 0 错才允许 push

---

## 30 秒上手

mvstudiopro 是一个 AI Deep Research SaaS（B 端为主），核心付费产品是「企业高客单旗舰款」研报，单价高，跑一次 15-20 min，要求**绝对稳定 + 视觉到位**。

本次任务：**让网页在手机 / iPad / 桌面自动响应式适配 + PWA 化**（安装到主屏幕像 app），不开发原生 app。

## 你的工作模式

1. **每个阶段一个 PR**（不要一次大 PR）— jobs.md 里列了阶段
2. 每个 PR：`npm run check` 0 错 → 推 → `gh pr create` → **截图发给父 agent review** → 父 agent 通过后用户决定何时 deploy
3. 中间有疑问、设计 trade-off、不确定的地方 → **先问，不要乱猜**

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | React 18 + TypeScript + Vite + **Tailwind CSS 4.1.14** + wouter |
| UI 库 | shadcn/ui（Radix）+ sonner（toast）|
| 后端 | Express + tRPC + drizzle-orm（不需要你碰，本任务纯前端）|
| 部署 | Fly.io 单 machine `mvstudiopro` SIN |

## 当前部署状态

```
778ff9c  fix(pdf): 修复封面后 2 页空白 (#331)   ← 已合 main，未部署
c2f34ff  feat: 维护模式 + 取消不退积分 (#329)   ← 已部署
878f120  feat: 取消任务按钮 + 退积分账本 (#328)
```

**注意**: 主 worktree（`/Users/tangenjie/.codex/worktrees/974b/mvstudiopro`）还有另一个 subagent 在跑 PR，working tree dirty。**你不能在主 worktree 工作**，必须用 `git worktree add` 创建独立目录：

```bash
cd /Users/tangenjie/.codex/worktrees/974b/mvstudiopro
git fetch origin main
git worktree add /tmp/mvs-responsive -b feat/responsive-mvp origin/main
cd /tmp/mvs-responsive
# 在这里干活
```

**完成后清理**: `cd /Users/tangenjie/.codex/worktrees/974b/mvstudiopro && git worktree remove /tmp/mvs-responsive`

## 目录速查

```
client/
├── index.html                       ← viewport meta（重要！见 jobs.md 阶段 1）
├── public/                          ← 静态资源（manifest.json / icons 放这）
└── src/
    ├── hooks/useMobile.tsx          ← 已存在！useIsMobile() hook，breakpoint 768px
    ├── pages/
    │   ├── GodViewPage.tsx          ← 237 处 inline style，重灾区
    │   ├── MyReportsPage.tsx        ← 81 处 inline style，重灾区
    │   ├── HomePage.tsx / Pricing.tsx / Storyboard.tsx ← 已响应式（参考标杆）
    │   └── ...
    └── components/
        ├── Navbar.tsx               ← 缺手机汉堡菜单
        └── ReportRenderer.tsx       ← 在线阅读

server/services/
├── pdfTemplate.ts                   ← 5 套 PDF 主题色（spring-mint / neon-tech / sunset-coral / ocean-fresh / business-bright）
└── ...                              ← 本任务不要碰
```

## 5 套品牌主题色（用于 PWA manifest theme_color 候选）

来自 `server/services/pdfTemplate.ts`：

| ID | 色调 |
|----|------|
| `spring-mint` | 薄荷绿 + 樱桃粉（清新轻奢，**默认**）|
| `neon-tech` | 电光青 + 霓虹紫（科技潮玩）|
| `sunset-coral` | 珊瑚橘 + 紫罗兰（创意策划）|
| `ocean-fresh` | 海蓝 + 柠檬黄（商务清爽）|
| `business-bright` | 海军蓝 + 香槟金（B 端正式）|

PWA manifest 用 `spring-mint` 主色（确切 hex 值见 `pdfTemplate.ts` line 90+）。

## 关键 useMobile 用法示例

```tsx
import { useIsMobile } from "@/hooks/useMobile";

export function SomePage() {
  const isMobile = useIsMobile();
  return (
    <div className={isMobile ? "p-4 flex flex-col gap-4" : "p-8 grid grid-cols-2 gap-6"}>
      ...
    </div>
  );
}
```

但**优先用 Tailwind responsive prefix**（`md:` / `lg:`）— 比 hook 性能好（CSS 切换无 re-render）：

```tsx
<div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
```

只有当**结构都不一样**（手机要换组件，不只是布局）才用 `useIsMobile()`。

## 工作流约定

1. 永远基于 `main` 拉分支：`git checkout main && git pull`
2. typecheck 0 错：`npm run check`
3. PR 标题用中文：`feat(responsive): 阶段 1 — viewport + Navbar 汉堡菜单`
4. PR description 列：改了什么 / 截图（手机/iPad/桌面） / 测试 checklist
5. **不要部署、不要 force push、不要碰 paidJobLedger / maintenanceMode / pdfTemplate 主题色**

## 边界（绝对禁止）

- **绝对不要 `flyctl deploy`**（部署只由用户决定）
- **绝对不要碰**：`paidJobLedger.ts`、`maintenanceMode.ts`、`pdfTemplate.ts` 主题色 + cover 排版
- **不要修改 git config / amend 已推 commit / force push**
- **不要在主 worktree 工作**（用 git worktree add 自己的）

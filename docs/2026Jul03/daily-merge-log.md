# 2026-07-03 · 合并时间线

## 时间线（Asia/Shanghai）

| 时段 | 事件 |
|------|------|
| 凌晨 | 素材分析热修延续（#689/#690 已于 Jul 2 merge；Jul 3 线上复测与文档补录） |
| 15:17 | **#691** merge — 全站平台用户可见文案清扫 + 自定义文案 PDF 导出 |
| 20:29 | **#692** merge — Canvas 多方块连线递归传递上游 prompt/output/图片 |
| 20:44 | **#693** merge — 成长营迁移首版（redirect + vision 优化 + 一键 handoff） |
| 21:00+ | 用户反馈 #693 体验不达标：跳页、说明过长、busy 时下方全案区未隐藏 |
| 21:14 | **#694** merge — 按用户标准重写 #693（同页三步、步骤卡片、收起全案区、`/platform` 统一入口） |

## 依赖关系

```
#689/#690 素材分析合规与 fallback 删除
    ↓
#691 文案清扫 + PDF 导出
    ↓
#692 Canvas 上游传递（独立线，与平台迁移并行）
    ↓
#693 成长营 → platform 首版迁移
    ↓
#694 重写 #693（现行标准， supersede 693 的 UX）
```

## #693 vs #694（为何重写）

| 项 | #693（已 supersede UX） | #694（现行） |
|----|-------------------------|--------------|
| 入口 URL | redirect 到 `/creator-growth-camp/platform#...` | 统一 `/platform`，旧路径 redirect |
| 素材分析闭环 | 分析后「填入并深度优化」切 Tab + scroll | 同 Tab：分析 → 优化 → 生图 |
| 步骤说明 | 长段落 | 每步两行（`PlatformWorkspaceStepHint`） |
| busy 态 | 下方全案分析区仍显示 | `customWorkspaceOperating` 时整块隐藏 |
| 全站链接 | 仍指向旧 platform 路径 | 首页/MVAnalysis/MyReports → `/platform` |

**注意**：#693 的后端能力（`platformLiveTrendBrief`、`visionContext` 优化、handoff 格式化）在 #694 中**保留复用**，仅前端交互与路由重写。

## 部署

- Vercel：各 PR Preview 通过后 merge，生产随 `main` 自动部署
- #694 Preview：`mvstudiopro-git-fix-platfo-*-.vercel.app`（merge 前已验证 Ready）

## 待用户线上验收

- [ ] `/creator-growth-camp` → `/platform`
- [ ] 素材分析四步同 Tab（含生成图预览在 Tab 内）
- [ ] 自定义文案 / 选题 / 抠像 步骤卡片可读
- [ ] busy 时下方全案区隐藏
- [ ] Canvas `/canvas` 多级连线传递（#692）

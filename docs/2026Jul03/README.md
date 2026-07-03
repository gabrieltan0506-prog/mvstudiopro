# 2026-07-03 · 当日流程总览

> 记录 2026 年 7 月 3 日合并至 `main` 的产品与技术交付，便于后续接手与线上验收。
>
> **存放位置**：工作区 `downloads/2026Jul03/`（本地 handoff）；本目录 `docs/2026Jul03/` 为仓库镜像（可 git 追踪）。

## 当日已合并 PR

| PR | 标题 | 合并时间 (UTC+8) | 文档 |
|----|------|------------------|------|
| [#691](https://github.com/gabrieltan0506-prog/mvstudiopro/pull/691) | 用户可见文案清扫 + 自定义文案 PDF 导出 | ~15:17 | [platform-copy-pdf-691.md](./platform-copy-pdf-691.md) |
| [#692](https://github.com/gabrieltan0506-prog/mvstudiopro/pull/692) | Canvas 多方块连线递归传递上游文案与素材 | ~20:29 | [canvas-upstream-handoff-692.md](./canvas-upstream-handoff-692.md) |
| [#693](https://github.com/gabrieltan0506-prog/mvstudiopro/pull/693) | 成长营迁移至自定义创作工作台闭环（首版，后被 #694 取代） | ~20:44 | [growth-camp-to-platform-migration.md](./growth-camp-to-platform-migration.md) §历史 |
| [#694](https://github.com/gabrieltan0506-prog/mvstudiopro/pull/694) | **重写成长营迁移 — 同页三步闭环**（现行标准） | ~21:14 | [platform-migration-v2-694.md](./platform-migration-v2-694.md) |

## 产品主线（一句话）

**成长营能力全部并入 `/platform` 自定义创作工作台**：四个 Tab 同页完成、每步两行说明、任务进行中自动收起下方全案分析区；旧路径重定向，不再跳新页。

## 用户验收路径（复制即用）

```
1. https://www.mvstudiopro.com/creator-growth-camp  → 应到 /platform
2. https://www.mvstudiopro.com/platform?tab=assets   → 素材分析 Tab
3. 上传封面+分镜 → 分析 → 深度优化 → 生分镜/卡片（全程同 Tab）
4. 任一 Tab 生成中 → 下方「平台顾问台 / 全案分析」应隐藏
```

## 本目录文件索引

| 文件 | 内容 |
|------|------|
| [README.md](./README.md) | 本页 · 当日 PR 与索引 |
| [daily-merge-log.md](./daily-merge-log.md) | 按时间线的合并记录与依赖关系 |
| [platform-migration-v2-694.md](./platform-migration-v2-694.md) | #694 最终迁移标准、路由、UI、关键文件 |
| [platform-workspace-flows.md](./platform-workspace-flows.md) | 四个 Tab 逐步用户流程 |
| [platform-copy-pdf-691.md](./platform-copy-pdf-691.md) | PDF 导出与文案清扫 |
| [canvas-upstream-handoff-692.md](./canvas-upstream-handoff-692.md) | Canvas A→B→C 连线传递 |
| [growth-camp-to-platform-migration.md](./growth-camp-to-platform-migration.md) | 迁移背景、数据白名单、#693→#694 演进 |
| [platform-asset-analysis-hotfix.md](./platform-asset-analysis-hotfix.md) | 凌晨素材分析热修（#689 系，Jul2–3） |
| [canvas-home-naming.md](./canvas-home-naming.md) | /canvas 首页命名记录 |
| [jobs.md](./jobs.md) | Omni 视频画布 /canvas 线上状态 |

## 关联仓库内文档

- `docs/2026Jul03/growth-camp-to-platform-migration.md` — 技术计划（与 downloads 同步维护）
- `docs/2026Jul03/platform-asset-analysis-hotfix.md` — 素材分析热修详情

## main 最新提交（文档撰写时）

```
960575a fix(platform): 重写成长营迁移 — 同页三步闭环 (#694)
```

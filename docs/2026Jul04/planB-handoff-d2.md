# 方案 B · D2 迁移交接（2026-07-04）

> 完整验收清单：`downloads/2026Jul04/planBscedule.md` §5

## 已 merge（D1）

| PR | 内容 |
|----|------|
| #696 | Research Hub + 首页三主站 |
| #697 | Platform MP4 视频分析 |

## D2 本 PR（#698 待开）

- Research Hub：Tab 横向滚动（mobile）；子页 `ResearchHubEmbedProvider` 隐藏重复顶栏
- Agent 子页 / 作品库：`/god-view` → `/research?tab=god-view`；Hub 内隐藏「返回」
- legacy 成长营：`GrowthCampLegacyGate` — 非 supervisor 访问 `/creator-growth-camp/legacy` → `/platform`
- `Navbar` 三主站；`RemixLanding` 登录后 → `/platform`
- `docs/产品定价与使用说明.md` 三主站路径
- 邮件 CTA：`magazineScheduler` → `/research?tab=god-view`

## 文档索引（Jul02–04 downloads）

| 目录 | 用途 |
|------|------|
| `2026Jul02/` | 成长营图片 GCS/Job 修复记录（#673–#676） |
| `2026Jul03/` | Platform 迁移 #691–#694、Canvas #692、当日 merge 日志 |
| `2026Jul04/planBscedule.md` | 方案 B 日程 + **§5 验收勾选** |

## 剩余

- [ ] §5 线上验收（Production / Preview）
- [ ] 验收 bug → 追加 PR

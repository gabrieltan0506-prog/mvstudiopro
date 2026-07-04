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
- **Growth Debug 迁至 `/platform`**：`GrowthSystemDebugPanel`（live/回填/Burst/各平台累计）
- **`/creator-growth-camp` 恢复 MVAnalysis 直达**（与 `/platform` 并存，主成长营页不再自动跳转）
- `Navbar` 三主站；`RemixLanding` 登录后 → `/platform`
- `docs/产品定价与使用说明.md` 三主站路径
- 邮件 CTA：`magazineScheduler` → `/research?tab=god-view`

## 路由（Debug 并存，2026-07-05）

| 路径 | 行为 |
|------|------|
| `/creator-growth-camp` | MVAnalysis（完整分析 + Debug） |
| `/creator-growth-camp/platform` | redirect → `/platform` |
| `/platform` | 页顶 Debug On → Growth 运行控制面板 |

## 文档索引（Jul02–04 downloads）

| 目录 | 用途 |
|------|------|
| `2026Jul02/` | 成长营图片 GCS/Job 修复记录（#673–#676） |
| `2026Jul03/` | Platform 迁移 #691–#694、Canvas #692、当日 merge 日志 |
| `2026Jul04/planBscedule.md` | 方案 B 日程 + **§5 验收勾选** |

## 剩余

- [ ] §5 线上验收（Production / Preview）
- [ ] 验收 bug → 追加 PR

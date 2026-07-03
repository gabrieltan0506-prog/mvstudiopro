# 方案 B · D1 日终交接（2026-07-04）

> 本地 handoff 镜像：`downloads/2026Jul04/planBscedule.md`（含完整验收清单 §5）

## 今日交付

| PR | 摘要 |
|----|------|
| [#696](https://github.com/gabrieltan0506-prog/mvstudiopro/pull/696) | `/research` Hub 五 Tab；`/god-view`、`/agent/*` redirect；首页仅 platform / research / canvas |
| [#697](https://github.com/gabrieltan0506-prog/mvstudiopro/pull/697) | Platform 素材 Tab 支持 MP4（`growth_analyze_video`），可与 PNG/JPG 混传合并；**不是 remux 二创** |

**main HEAD**：`90db12a`

## 还剩几块迁移？（2.5 天 scope）

| # | 块 | 优先级 | 说明 |
|---|-----|--------|------|
| 1 | Research Hub 抛光 + 内链清扫 | P0 | 子 Tab 样式/mobile；Agent 子页「返回智库」改 `/research?tab=god-view`（约 4 处仍写 `/god-view`，redirect 可用但体验未统一） |
| 2 | 线上验收 | P0 | §5 清单：Platform 三步闭环、MP4、Research 五 Tab、Canvas 连线 |
| 3 | 文档同步 | P1 | `docs/产品定价与使用说明.md` 等路径改 `/platform` |
| 4 | legacy 成长营页 | P2 待拍板 | `/creator-growth-camp/legacy` 是否仅 supervisor；**不删** `MVAnalysis.tsx` |

**不算待迁移（已砍 scope）**：Canvas 并 kling/workflow、MVAnalysis 删源码、Enterprise 并 research、Canvas Hub 多 Tab。

## 验收清单（快捷）

完整版见 [`planBscedule.md`](../../downloads/2026Jul04/planBscedule.md) §5 或仓库内 [`planBscedule.md`](./planBscedule.md)（若已同步）。

### 首页
- [ ] 顶栏 / Hero 仅三主站
- [ ] 无 HomeRemixStrip

### Platform
- [ ] 素材 Tab：PNG → 优化 → 生图同 Tab
- [ ] 素材 Tab：MP4 视频分析
- [ ] busy 时隐藏全案区

### Research
- [ ] 五 Tab 可切换 + 旧 URL redirect
- [ ] 无双层顶栏

### Canvas
- [ ] `/canvas` + A→B→C 连线

### 不动项
- [ ] `/kling-studio`、`/workflow-nodes` 直链仍可访问

## 明日建议 PR

- 分支：`fix/hub-polish-d2` → PR #698  
- 内容：Hub 抛光、god-view 内链、文档、验收 bugfix

## 备注

```
验收人：________  日期：________



```

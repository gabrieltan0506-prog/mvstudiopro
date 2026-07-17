# 动态 TDL · 工作区置顶

**最后刷新：** 2026-07-17 11:23

## 铁律
- 开 PR ≥15 分钟 · Deploy success 才能合下一刀 · 未喊停不准停
- 日常部署只认 Fly；Vercel Git 保持断开（防日限）

## 明日（额度恢复后 · 约 11:00）
- [ ] **一次打包部署到 Vercel Production**：用当时 `main` 最新提交做**单次** `vercel deploy --prod`（或后台 Redeploy 最新 production），把断连期间累计更新一次性上线
- [ ] **不要**重新打开每 PR Preview；打完这一包后继续只走 Fly

## 此刻
- [x] #798 craft · #799 Fly-only / 关 Vercel Git MERGED
- 排队：`feat/apply-factory-scene-prefs` · `feat/seedance-probe-cli`

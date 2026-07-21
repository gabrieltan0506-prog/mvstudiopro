---
name: manhua-visual-narrative
description: >-
  漫剧视觉叙事：关键静帧分层提示、分镜戏剧功能、CG/仿真人画风硬锁。
  用户谈分镜、静帧、古装、CG 画风、视觉简报或关键帧对不齐时使用。
---

# 漫剧视觉叙事（Cursor）

完整条文与产品同源：

- 顾问块：`shared/distilledAgencyAdvisorBlocks.ts` → `DISTILLED_MANHUA_VISUAL_NARRATIVE_ZH`
- 平台/文档 Skill：`docs/2026Jul11/skill/manhua-visual-narrative.md`

## 何时启用

分镜表、关键静帧、画风（CG/仿真人）、古装时代、视觉简报、首镜对不齐题材。

## 执行要点

1. 改静帧链路时对照 `shared/manhuaKeyartEditFusion.ts` 与 `shared/jsonDirectorMiddleware.ts`：CG 勿走仿真人 edit 底图；分镜段须进主体。
2. 前台零技术泄漏；手法中性标签，不点名致敬。
3. 建议用户产出「## 故事大纲」+「## 分镜表」，便于工作台同步。
4. 可与 `craft-shot-bank`、`manhua-viral-hits` 叠用：手法原子 / 爆款情报 → 本 Skill 管画面与分镜兑现。

---
id: seedance-i2v-motion
name: Seedance图生视频微动
description: 已退役。禁止「运镜+微动+氛围」三件套减法；成片用完整导戏单。
version: 2026-07-23-retired
defaultEnabled: false
---

# Seedance 图生视频 · 已退役 Skill

## 状态：退役（禁止再用）

旧版把有静帧的成片 prompt **压成**：

`[镜头运动] + [主体微动] + [环境氛围]`

这在概念层就不合格：会丢掉导戏单、对白秒位、`@角色N` 锁与动作轨迹。  
运行时 `compileI2VMotionPrompt` **已废除该减法**；仅路径运镜配方/标注仍可编译为分阶段时段句。

## 现行口径

1. 漫剧 / Canvas 成片：整段导戏单进 Seedance（含对白锁、按秒单、引擎 Audio on）。
2. 禁止再教模型或代码「有静帧就只写三句微动」。
3. 身份靠参考图 + `@角色/@场景/@道具`；叙事靠导戏正文，不靠空话公式。

## 代码真源

- `shared/jsonDirectorMiddleware.ts` → `compileI2VMotionPrompt`（原样放行）
- `shared/manhuaScriptWorkbench.ts` → `formatWorkbenchSegmentClipInjectBlock`
- `client/src/lib/canvasRunBlock.ts` → `runSeedance20`

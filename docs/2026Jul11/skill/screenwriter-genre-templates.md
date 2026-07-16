---
id: screenwriter-genre-templates
name: 编剧剧种模板
description: 按剧种套编剧骨架（钩子/角色槽/节拍），题材一句微调即可；正文待填
version: 2026-07-17a
defaultEnabled: false
---

# 编剧剧种模板 Skill

## 用途
**仅 /canvas 漫剧工厂**（不进 `/platform` Skill 池与路由）。  
选剧种 → 套 `shared/screenwriterGenreTemplates.ts` 骨架 → 用户题材一句微调 → 再跑故事/角色/节拍。

## 与漫剧六段的关系
| 阶段 | 模板作用 |
|------|----------|
| story_brief | 钩子公式 + 调性 |
| character_bible | 角色槽位 + 禁止崩坏 |
| episode_beats | 节拍骨架（因果顺序勿打乱） |
| video_reverse / key_art / seedance_clip | 一般不改模板，吃上游产出 |

## 怎么填模板（你稍后把原文给我即可）
1. 打开 `docs/2026Jul16/screenwriter-templates/` 对应 md，把正文贴进字段。  
2. 同步到 `SCREENWRITER_GENRE_TEMPLATES` 同 id 条目，设 `ready: true`。  
3. 可选：为某阶段写 `stageAddons.story_brief` 等附加句。  

占位 id：`campus_angst` · `sweet_romance` · `rebirth_revenge` · `workplace_power` · `family_ethics` · `scifi_farewell` · `custom_slot_a` · `custom_slot_b`。

## 硬规则
- 未 `ready` 的剧种**不得**覆盖默认漫剧 prompt（只显示「待填」）。  
- 套模板后只允许改人设/场景名词，**禁止**打乱钩子与节拍因果。  
- 成稿去导演名 / 片名 / 真人名。  
- 创作者题材一句优先于模板里的示例专名。

## 禁止
- 把未审核的外部剧本全文当系统默认强灌全站  
- 与 `review-safe-voice` 冲突的强监管擦边题材默认开启  

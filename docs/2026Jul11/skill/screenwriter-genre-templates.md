---
id: screenwriter-genre-templates
name: 编剧剧种模板
description: 七剧种骨架 + 挂载 20 场景资产包；题材一句微调即可开写
version: 2026-07-17b
defaultEnabled: false
---

# 编剧剧种模板 Skill

## 用途
**仅 /canvas 漫剧工厂**。  
选剧种（仙侠/古风/都市/校园/末日/科幻/悬疑）→ 自动挂 `manhua-scene-asset-library` 默认场景包 → 题材一句微调。

可再单选 `scene_01`…`scene_20` 覆盖默认包。

## 与六段关系
| 阶段 | 注入 |
|------|------|
| story_brief | 剧种钩子 + 场景包 |
| character_bible | 角色槽位 |
| episode_beats | 节拍骨架 + 场景解析/元素 |
| video_reverse / key_art | 场景生图提示词（静帧优先主场景） |

详见：`shared/screenwriterGenreTemplates.ts` · `shared/manhuaSceneAssetLibrary.ts`

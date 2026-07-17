---
id: manhua-scene-asset-library
name: 漫剧场景资产库
description: 20 个爆款场景模板（解析/元素/生图提示），按剧种套用告别廉价拼贴感
version: 2026-07-17b
defaultEnabled: false
---

# 漫剧场景资产库 Skill

## 用途
**仅 /canvas 漫剧工厂**。选剧种或单场景 → 故事/节拍/反推/静帧注入场景定位、核心元素与生图提示词。

代码：`shared/manhuaSceneAssetLibrary.ts`  
剧种接线：`shared/screenwriterGenreTemplates.ts`

## 剧种 → 默认场景包
| 剧种 | 场景 |
|------|------|
| 仙侠 | 01–05 宗门/云海/练剑/秘境/魔宫 |
| 古风 | 06–10 大殿/街市/府邸/废墟/边塞 |
| 都市 | 11–13 豪宅/办公室/酒吧 |
| 校园 | 14 教室 |
| 末日 | 17（可借 09） |
| 科幻 | 15–16、18 |
| 悬疑 | 19–20（可借 18） |

## 自动推荐（⑤D）
- `recommendManhuaSceneFromTopic(topic, { genre? })`：题材关键词 → **一条**具体场景  
  - 例：「秘境」→ `scene_04` 秘境洞府（不是仙侠默认宗门）  
  - 例：「办公室」→ `scene_12`；「黑客」→ `scene_20`  
- `recommendManhuaSceneIdFromTopic`：先推断/手选剧种，再关键词细匹配；无命中回退剧种池首条  
- Canvas：未手选时自动写入场景下拉；手选后锁定，可「恢复自动推荐」

## 每条模板四段
1. 场景定位 / 解析  
2. 视觉核心元素  
3. 适用剧情  
4. AI 生图提示词  

## 硬规则
- 角色必须「站进」场景，禁止空棚抠贴。  
- 可改专名，不可抽空核心元素。  
- 成稿去导演名/片名。  
- 一集主用 **一条** 主场景，勿灌整包目录。 

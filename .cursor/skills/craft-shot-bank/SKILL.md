---
id: craft-shot-bank
name: 拍摄手法条目库
description: 灯光/运镜/情绪/转场原子条目；Canvas 点选注入节拍·反推·静帧；成稿去导演名
version: 2026-07-17c
defaultEnabled: false
---

# 拍摄手法条目库 Skill（⑧A）

## 用途
**仅 /canvas**。与整卡气质库 `CRAFT_TECHNIQUE_PROFILES` 互补：本库是可点选的**原子镜头手法**（学条目库结构，不成稿抄外仓）。

运行时：`shared/craftShotBank.ts` → `buildCraftShotInjectBlock` → 节拍 / 反推 / 静帧 prompt。

## 分类
| 类 | 数量 | 例 |
|----|------|----|
| 灯光塑形 | 8 | 窗光动机、高反差、霓虹溢色 |
| 运镜调度 | 8 | 慢推、固定长镜、正反打 |
| 情绪表演 | 8 | 克制压迫、暧昧欲言又止 |
| 转场卡点 | 6 | 匹配切、硬切卡点、声先画后 |

## 硬规则
1. 成稿只写手法词；禁止导演名、片名、「某某风」、外仓名。
2. 一集主用 1–2 条；可微调变奏，勿混炖。
3. 与包装动效库 `motionPromptBank` 分表：动效管片头包装，本库管叙事镜头。

## 自动套用
- `recommendCraftShotFromTopic(topic)`：题材关键词 → 1 条推荐
- 细项优先：审讯/精算、修仙/洞府、群戏 等先于「对峙」等泛词
- Canvas 工厂手选后锁定；可「恢复自动推荐」
- 铺节点未选手法时，spawn 也会按题材自动注入一条
- 细项覆盖：边塞/烽火、声先画后/硬切、密室黑客、末日废土、校园、科幻、古风、武侠、谍战
- 已铺板：`applyFactoryPrefsToBlocks` 同步手法/动效/场景/剧种/男女主/反推档（防抖），不必整板重铺

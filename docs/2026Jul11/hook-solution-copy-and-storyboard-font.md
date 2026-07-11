# 钩子·半成品解法·审核友好 · 2026-07-11

> 分支：`feat/hook-solution-copy-and-storyboard-font`  
> 动机：Downloads Jul10/11 交接 + 用户整理的「吸睛选题 / 咨询转化 / 去临床化审核」方向；**产品逻辑可泛化**，非单一人设硬编码。

## 产品目标

全案分析与自定义选题生成时，每条文案须回答：

1. **客户是谁**（从用户背景/赛道挖掘）  
2. **痛点是什么**  
3. **吸睛标题 + 钩子**（好奇缺口 / 反常识 / 反差 / 时事）  
4. **半成品解法**（2–3 点，故意留白）→ 促成咨询  
5. 强监管赛道：**审核友好表达**（学者向、去病名/去临床视觉）  
6. 分镜简中：**大字号、短表文、防糊字**

## 代码

| 文件 | 作用 |
|------|------|
| `shared/platformCreatorInsightFraming.ts` | 钩子/咨询闭环 + 审核友好口吻 + 知识变现约束 |
| `shared/storyboardTextClarity.ts` | 分镜屏内字英文外壳 + 中文短约束 |
| `server/routers.ts` | Stage1/Stage2 注入上述指引；示例去临床硬锚点 |
| `server/services/decisionIntelBonusBlueprints.ts` | 自定义选题 / 战略扩写对齐 |
| `client/.../PlatformPage.tsx` | 自定义选题 structure 商业闭环；默认灯光去「医学权威」 |
| `geminiPlatformCompositeTranslation.ts` + `proxyImageService.ts` | 分镜防糊字 |

## 手测

- [ ] 全案 Stage2：标题有脑洞/反差；正文有客户+痛点+半成品+CTA；含 highlightKeywords  
- [ ] 自定义选题：同上  
- [ ] 健康类人设：少病名/听诊器/CT；偏生命科学与生活美学  
- [ ] 分镜：表内字更短更清晰  

## 非目标

- 不写死「哈佛医学博士」专用模板；由 `needsReviewSafeVoice(context)` 与人设挖掘泛化触发。

---

## 续：文化素材反坍缩（同日）

**根因（`11.pdf` 复盘）**：决策智库骨架默认「宋代点茶 / 苏东坡 / 李清照」，Stage1/2 few-shot 亦偏宋词人 → 全案与分镜反复坍缩到宋朝。

**修复**（软边界措辞，避免硬禁令导致模型拒写）：

| 文件 | 改动 |
|------|------|
| `shared/platformCulturalMaterialDiversity.ts` | 跨朝代/典籍/阶层/当代：**强烈建议 / 高度需求 / 包括但不限于** |
| `shared/advancedPredictionEngine.ts` | 默认骨架改为史记/爵士/银发/唐边塞/影视等 |
| `shared/storyboardLightingEmotion.ts` | 分镜六栏含运镜/灯光/情绪；手法卡（电影+剧集）。**A+B+C**：成稿去名只写手法词；系统 Prompt 可溯源点名；曹译文=内地剧集 |
| `decisionIntelligenceFlashPipeline.ts` | Call B 多样性软边界 |
| Stage1/2 + 自定义选题 | 注入多样性 + 灯光情绪 + 替换苏东坡示例 |

**验收**：同一人设重跑全案/智库，选题面拉开（少扎堆宋词人）；分镜表可见灯光与情绪栏。

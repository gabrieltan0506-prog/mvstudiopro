---
id: image2-quick-templates
name: Image-2 一键复刻模板
description: 10 套图生图/编辑提示（职业照、Plog、清晰化、全景、发型卡、旅行贴纸等）供用户一键套用
version: 2026-07-17-hb
defaultEnabled: false
---

# Image-2 一键复刻模板 Skill

## 用途
用户上传参考图（或纯文生）后，从模板库选一套 **Image-2** 提示一键套用，快速复刻效果。模板定义见 `shared/image2PromptTemplates.ts`。

## 硬约束
1. 标明 `needsReference=true` 的模板：**必须**把用户图作为多模态参考输入，不能只在文案写“参考人脸”。
2. 锁脸类（职业照/清晰化/发型卡）：禁止换脸成陌生人、禁止磨皮塑料感。
3. 一次只套用 **1** 套模板主效果，避免提示词互相打架。
4. 画幅按模板 `aspectHint`；用户另有指定时以用户为准。

## 模板清单
1. 棒球赛直播抓拍  
2. 一键职业照  
3. 手绘 Plog 注释  
4. 一键清晰 4K  
5. 360° 全景  
6. 恋爱游戏卡面  
7. 丑丑涂鸦蜡笔  
8. 发型分析卡  
9. Colorwalk 旅行贴纸封面  
10. 武魂真身双重曝光  

套用函数：`buildImage2TemplatePrompt(id)`。

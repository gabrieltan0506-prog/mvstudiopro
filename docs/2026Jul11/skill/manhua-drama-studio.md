---
id: manhua-drama-studio
name: 漫剧工作室链路
description: 故事→角色→节拍→反推→静帧→Seedance；借鉴 AI-CanvasPro 阶段感但不抄闭源桌面
version: 2026-07-16b
defaultEnabled: true
---

# 漫剧工作室 Skill

## 用途
Canvas「一键漫剧工作室」与短剧/漫剧选题。样本：`~/Downloads/2026Jul16/c1.mp4`（阿硕 AI-CanvasPro Story Studio 演示）、`c2.mp4`（成片/片段选择）。

开源对照：https://github.com/ashuoAI/AI-CanvasPro —— **Electron 桌面二进制**，非可调用 API/Skill 库；许可证禁止商业抄袭。我们只学阶段感，用 Web + 自有导演中台做得更好。

## 六段硬链路
1. **story_brief**：标题钩子 + 欲望 + 冲突 + 收束  
2. **character_bible**：1–3 角色外形锚点与禁止崩坏点（去真人名）  
3. **episode_beats**：6–10 镜，每镜 2–4s  
4. **video_reverse**：有参考片则 Gemini 反推；无片则节拍补全分镜  
5. **key_art**：JSON 导演中台→竖屏静帧  
6. **seedance_clip**：I2V 微动公式成片  

## 比桌面竞品更好的点（必须兑现）
- 与 Platform Skill / 成稿去导演名统一口径  
- JSON 导演中台锁摄影，系列镜只换 Subject/Environment  
- 反推结果可直接连 Seedance，无需另开客户端  
- 云端 job + 计费一体，非本机塞一堆 API Key  

## 禁止
- 整段照搬 AI-CanvasPro 文案/UI 商标  
- 把闭源二进制当可嵌入 workflow library  

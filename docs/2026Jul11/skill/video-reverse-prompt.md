---
id: video-reverse-prompt
name: 视频反推提示词
description: Gemini 拉片→分镜表+Seedance 微动句；浏览器本地抽帧；成稿去导演名
version: 2026-07-16c
defaultEnabled: false
---

# 视频反推提示词 Skill

## 用途
**仅 /canvas**（不进 `/platform` Skill 池与路由）。「视频反推」方块、漫剧工作室拉片时启用。对齐 nanophoto 思路，**主看片用 Gemini**，非 GPT 纯文编译。

运行时：`/api/google?op=videoReversePrompt` · 浏览器 `extractVideoFramesFromUrl`。

## 输入
- 优先：本方块上传的 MP4/MOV/WebM（建议 ≤120s）
- 或：上游图片帧序列
- **不要**指望 Fly/Vercel 直接抓 YouTube（机房 IP 常被 Google 封锁）

## 输出结构（硬）
1. 一句话摘要  
2. 分镜表（镜号｜时码｜景别｜运镜｜画面｜音频｜时长）  
3. 角色与场景锁定  
4. 每镜 Seedance/I2V 微动句（运镜+微动+氛围）  
5. 可复制首镜总提示  

## 模型选择
- **看片 / 分镜**：Gemini 3.1 Pro（默认）  
- **可选后处理**：GPT-5.6 仅用于把分镜压成更短 I2V 句（非必须）

## YouTube
云端直抓不可靠。用户本机执行 `pnpm run yt:local-fetch -- <url>`（见 `scripts/yt-local-fetch.mts`）下载后上传画布。

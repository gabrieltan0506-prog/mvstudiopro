---
id: manhua-drama-studio
name: 漫剧工作室链路
description: 故事→角色→节拍→反推→静帧→Seedance；借鉴 AI-CanvasPro 阶段感但不抄闭源桌面
version: 2026-07-19b
defaultEnabled: false
---

# 漫剧工作室 Skill

## 用途
**仅 /canvas**（不进 `/platform` Skill 池与路由）。「一键漫剧工作室」与短剧/漫剧选题。样本：`~/Downloads/2026Jul16/c1.mp4`（阿硕 AI-CanvasPro Story Studio 演示）、`c2.mp4`（成片/片段选择）。

开源对照：https://github.com/ashuoAI/AI-CanvasPro —— **Electron 桌面二进制**，非可调用 API/Skill 库；许可证禁止商业抄袭。我们只学阶段感，用 Web + 自有导演中台做得更好。

## 资产墙 + 多集导出（Web 侧）
- **资产墙**：复用人物 photoreal 设定卡 + 20 场景文案库 + 已落盘场景/道具示范图（`ManhuaAssetWall`）
- **成片坞**：勾选集 → 运行范围；「一键导出全部有产物」打 zip（`epXX/` + `README.md` + `playlist.json` + 可选 `library/` 角色/示范参考）
- 不含长片自动拼接

## 编剧室闸门（先剧情，后编导）
1. 用户给题材 + 三到五句条件，选 **2–6 集**（默认 3），点「扩写剧情」
2. 预览连载包（每集正文 + **片尾钩子** + 人物/道具/场景）
3. 「确认并进入编导」后才解锁节拍 / 静帧 / 成片；可「跳过连载扩写」进编导（无剧情包）
4. **前台禁止**出现模型名、供应商、私下话术（如「仿写某某」）；内部 prompt 仍可写硬禁令

## 文本模型（画布）
- 默认 / 主力：**GPT-5.6 Sol**；备选 **GPT-5.6 Terra**
- **Gemini 3.1 Pro** 仅保留选项（知识截止约 2025-01-01，偏旧）
- **编剧室扩写**：官方 **Responses API · reasoning.mode=pro**（失败回退 Chat Completions）
- 页首**模式选择**（不左右分栏、不拆路由）：**漫剧创作**展开完整工作流；**自由画布**只开多节点接线（文生图/视频、提文字、文案等），不铺漫剧流水线；可「切换模式」回选

## 六段硬链路（确认后）
1. **story_brief**：标题钩子 + 欲望 + 冲突 + 收束（可注入编剧室剧情包）  
2. **character_bible**：1–3 角色外形锚点与禁止崩坏点（去真人名）  
3. **episode_beats**：6–10 镜，每镜 2–4s（可挂编导手法块）  
4. **video_reverse**：有参考片则反推；无片则节拍补全分镜  
5. **key_art**：JSON 导演中台→竖屏静帧  
6. **seedance_clip**：I2V 微动公式成片  

## 比桌面竞品更好的点（必须兑现）
- 与 Platform Skill / 成稿去导演名统一口径  
- JSON 导演中台锁摄影，系列镜只换 Subject/Environment  
- 反推结果可直接连成片引擎，无需另开客户端  
- 云端 job + 计费一体，非本机塞一堆 API Key  

## 禁止
- 整段照搬 AI-CanvasPro 文案/UI 商标  
- 把闭源二进制当可嵌入 workflow library  
- 前台泄漏后台技术口径（模型 / 供应商 / 仿写话术）

## Seedance 探针
- `pnpm run manhua:seedance-probe` **默认 SKIP**
- 真打：`CANVAS_PROBE_SEEDANCE=1` + `CANVAS_PROBE_IMAGE_URL`（密钥在 Fly；不走 fal）

## 爆款情报
- Skill：`.cursor/skills/manhua-viral-hits/SKILL.md`（给链接 → 拆解为何火 → 题材/场景/手法建议）
- 源笔记：`docs/2026Jul17/manhua-viral-hits-2026h1.md`（名单出处 + 待补充案例分析）

# AI-CanvasPro 对照 + c1/c2 抽帧 + 漫剧/反推落地

## AI-CanvasPro
- URL：https://github.com/ashuoAI/AI-CanvasPro（~1092★）
- 形态：**Electron 桌面应用**（Release 二进制），GitHub 仅文档，**不是**可 npm 调用的 workflow/Skill 库
- 许可：非开源 NC + 商业书面授权；不可当 SaaS 白标抄袭
- 可学：Story Studio 阶段（想法→分集剧本→分镜→生成）、`@` 资产、任务队列
- 不可用：闭源内核、Comfy/RH 封装当我们的后端

## c1.mp4 / c2.mp4（4fps 超高抽帧）
| 文件 | 时长 | 分辨率 | 帧数(4fps) | 内容 |
|------|------|--------|------------|------|
| c1.mp4 | ~283s | 576×1280 | 1133 | 阿硕讲 AI-CanvasPro「从想法到分集剧本」Story Studio |
| c2.mp4 | ~325s | 1280×576 | 1300 | 片段选择/生成后全选导出类操作演示 |

OCR 要点：不懂提示词也能做短剧；剧本摘要/资产拆解；多 Provider Key 墙。

## YouTube（方案 C）是否能在 Fly/Vercel 做到？
**不能可靠做到。** 机房 IP 常在 Google/YouTube 黑名单；服务端 yt-dlp 会间歇性失败。

真正可行的突破：
1. **本机脚本**（已加）：`pnpm run yt:local-fetch -- "<url>"` → 用用户出口 IP 下载 → 上传画布  
2. 未来可选：轻量桌面/浏览器扩展 companion（仍走用户 IP）  
3. **不要**在 Fly/Vercel 上承诺「粘贴 YouTube 即反推」

## 我们已落地（更好路径）
- Canvas：`video_reverse` 方块 +「一键漫剧工作室」六段  
- API：`/api/google?op=videoReversePrompt`（Gemini 看帧）  
- Skill：`video-reverse-prompt` · `manhua-drama-studio`  
- 浏览器本地抽帧，云端只吃 JPEG 帧（体积可控）

## 自动漫剧工厂（`/canvas`，PR #770）
链路：题材一句 → 故事 → 角色卡 → 镜头节拍 → 编导反推（**无片可跑**）→ 关键静帧 → Seedance≈15s。

编排核：`client/src/lib/canvasDramaStudio.ts`
- `skipDone` 跳过已完成；`forceFromStage` /「从失败处续跑」
- 反推完成后把分镜表/锁定/微动句灌进静帧与成片 prompt
- 瞬时失败（超时/502/网关）单阶段自动重试最多 2 次

探针：`pnpm run manhua:probe`（故事→角色→节拍→无片反推→静帧）

## 编剧剧种模板（骨架已留，正文待填）
- 代码：`shared/screenwriterGenreTemplates.ts`
- Skill：`docs/2026Jul11/skill/screenwriter-genre-templates.md`（Canvas only）
- 粘贴区：`docs/2026Jul16/screenwriter-templates/`
- `/canvas` 工厂下拉「剧种模板」：未 `ready` 显示「待填」且不覆盖默认 prompt

# line-canvas · 漫剧工厂线（动态层，每班收班更新）

> 更新：2026-08-12 深夜（Fable 5 接手班）。产品骨架见 `../manhua-factory-brief.md`，此处只放当前态。

## 红线（先背再动手）
- **0 号红线：视频/成片生成永远不得由 agent 触发**——最远推进到「审阅成片提示词」+报价单；紫钮（确认静帧生成全部成片）只能用户点。
- 每段恰 3 镜是全仓不变量；三阶段门控（剧本→资产→静帧→成片）；导入顺序**先剧本后资产 ZIP**（反了清资产）。
- 画布批次运行中，agent 自己不得合并部署（双烧 $1.1–1.7 实锤）。

## 雁门照山河 ep01 现状
- 设定图 67 张（人物/场景清零，道具剩灶牌特写 1 张未出）；22 对同名重复等**用户**点清（agent 写请求被 WAF 拦，点了无效）。
- 静帧：第 01 段已近齐（以页面「静帧 N/9」为准）；成片 **0**。
- 段 01 提示词七要素 5/7：对白四句缺失+秒轴只 1 拍——齐帧后点「审阅成片提示词」重铺应自愈；不自愈则修 `client/src/lib/canvasDramaStudio.ts` ~1947 dialogueLines → `shared/manhuaScriptWorkbench.ts` hydrateWorkbenchShotsWithSegmentDialogue 注入链。
- 出片报价：四段 2.5·720p ≈ $18–19，等用户出片令。

## 在修 / 待办（刀序）
1. [在修，分支 fix/canvas-zoom-and-node-size] 缩放控件（FreeformCanvas.tsx 底部 ±/复位 + Ctrl/捏合 wheel）+ 节点尺寸三组常量 1.5×（canvasDramaStudio.ts ~2429，间距必须同步放大否则互叠）。
2. ZIP 导入造 URL 入口（importAssetZipFromUrl 路由 / URL 粘贴框）。
3. 齐帧重铺审阅 → 四段七要素核（对白！）→ 报价单 → 等出片令。
4. 出片后：段 01 抽谢无咎声线 → 后续段 audio_urls 复用 → 成片坞拼 120s。
5. 认领按名回绑 cast id / 批次断线续航（抄 #1190 模式）/ TTS 试听改 submit+poll / H3 官方契约接入 / 模板 listApproved 服务端剥具名。

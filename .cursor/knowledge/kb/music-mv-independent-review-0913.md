# 音乐 MV 独立审查 · 2026-09-13

状态：发现三项 P2，待修复与复审；不能据本审查合并。

- 被审分支：`feat/music-mv-canvas-0913`。
- 被审 HEAD：`3261afa24cdb9e50e7a4794ef9b8c3cb1d4a229e`；基线 `origin/main`：`9d15eadb39174a148419072138bbdca68a37a3b7`。
- 只读 `gh pr list --head feat/music-mv-canvas-0913 --json number,url,headRefOid,state` 返回 `[]`，本次尚无可关联 PR。
- 已读仓库及全局适用 AGENTS、CLAUDE、always 规则、知识库，包含本轮新增发布闭环章节。审查原有代码、类型、存储与测试差异；全链涉及音乐节点、Suno worker、GLM 分镜、视频生成/恢复、素材权限、合成与云草稿。主代理并行编辑的规则尚未提交，后续 HEAD 必须另复审。

## P2：合成终态后没有采用新镜头的重新合成路径

定位：`client/src/components/canvas/CanvasMusicMvStudio.tsx:575–610`、`620–647`。

触发：正常合成一次后，在镜头节点重做或切换另一历史视频，再点音乐节点合成按钮。`finish()` 优先采用已保存 `assembleInput` 与 `assembleJobId`，只有从未合成过才读取 `getBlocks()`。因此始终查旧任务，已成功则再次返回旧成片；已失败则始终返回失败。界面没有新一轮合成入口，改变镜头也不失效父节点合成身份。唯一绕行是改变创意重新付费制作分镜并重新铺点，不能满足已有计划下重剪/失败重试。

修复应保留原快照用于未知任务恢复，在服务端终态得到确认后提供显式的新一轮合成，重新采集当前镜头与画幅，保留旧成片/任务。不得在未知任务状态下自动清编号重提。

## P2：分镜进程中断后原请求永久等待

定位：`server/routers/canvasMusicMv.ts:146–154`、`240–247`；客户端 `pendingPlan` 及选歌/创意禁用分支。

触发：`request.json` 已占位，进程在写 `result.json`/`interrupted.json` 前被终止或重启。新进程同编号调用只检查旧结果，没有结果即恒定 CONFLICT；`getPlan` 在没有 interrupted 时恒定 pending_or_unconfirmed。不存在租约、超时终态核对或原始证据恢复执行。前台继续 planning，无法切歌/改创意/开始新一轮。

离线真实函数复现：用依赖注入预置匹配的 request-only 持久状态，连续两次调用 `draftCanvasMusicMvPlan`。两次原始结果均为 `code=CONFLICT`，提示“原分镜请求已受理但尚无可交付结果，请查询原编号，勿重复生成”；`llmCalls=0`。执行命令 `pnpm exec tsx --eval ...` 退出 0，无网络/付费调用。修复须在确认原执行已结束后安全恢复已有证据或给明确终态及显式重试，不能自动重复购买未知上游请求。

## 复验及边界

继续追链新增 P2：`client/src/lib/canvasRunBlock.ts:1437–1440` 只排除 keyart/clip 上游全文，MV 子镜没有排除。新 `canvasTypes.ts:643–652` 音乐 handoff 将整首歌词与全部分镜 JSON 写入文本，`FreeformCanvas.tsx:1702` 再传给每镜。每镜因此同时接到整曲其他人物、场景、动作，并在 12000 字处分割上游全文。离线调用真实 `createMusicMvShotBlocks`、`collectUpstreamTexts`、`formatCanvasUpstreamPrompt`，第一镜“雨夜女主走过街道”的实际合并 prompt 同时包含第二镜“白昼海滩男主驾驶快艇”，原始输出 `shotOneContainsOtherShot:true`。现有测试只断言时长/图片/无歌曲 URL，未检查逐镜文字隔离；应与逐镜已编译正文契约一致，排除音乐父节点的整份计划与无关歌词。

执行 `pnpm exec vitest run server/routers/canvasMusicMv.test.ts server/routers/canvasMusicMvAssemble.test.ts server/services/canvasMusicMvMedia.test.ts client/src/lib/canvasMusicMvRecovery.test.ts client/src/lib/canvasMusicMvGuards.test.ts client/src/lib/canvasMusicMvWorkflow.test.ts client/src/lib/canvasVideoTaskResume.test.ts`。

原始摘要：`Test Files 7 passed (7)`，`Tests 48 passed (48)`，`Duration 2.19s`，退出 0。上述两项不在现有测试覆盖内，不能用通过数量否定发现项。

未执行线上登录、真实音乐/分镜/视频生成、生产扣退或部署。未修改运行代码、提交、推送、建 PR、合并或发起付费调用；仅按主代理本轮指令写此独立记录。正式发布前仍需复核最新 HEAD 与真实在途任务。

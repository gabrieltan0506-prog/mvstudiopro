# 音乐 MV 独立审查 · 2026-09-13

最新状态：`404f850e` 四项 P2 均已闭合，独立复审未发现新的 P1/P2 或代码阻断。此结论不替代合并前真实在途任务/部署检查与线上验收。下文原发现保留为历史。

## 2026-09-13 11:53:52 CST · 独立子代理最终复验

被审 HEAD `404f850eaeb341633ec31128fc4b03c9f31b631e`；实时读取 PR #1456 为 OPEN、远端 HEAD 相同。本轮审查 `aa8b26fe...404f850e` 全部新增运行代码与测试差异，结合前两轮已审链路。

第四项闭合：`hasPendingMusicMvPlan` 同时用于 FreeformCanvas 外层音乐 textarea 禁用和 Studio 输入同步 effect。网络错误仅影响状态文案，不释放未知原 requestId/planInput；外部或云同步强制改 prompt 时 effect 保留原身份，原任务仍可轮询/恢复，旧稿与当前创意有差异时显示明确提示与用户主动的新稿入口。新稿开始前保留旧请求快照。核查代码及新增浏览器强制改外层输入、刷新恢复的断言，未发现原漏洞残留。

独立执行 `pnpm exec vitest run client/src/lib/canvasMusicMvRecovery.test.ts client/src/lib/canvasMusicMv.browser.test.ts client/src/lib/canvasMusicMvWorkflow.test.ts`：`Test Files 3 passed (3)`、`Tests 15 passed (15)`、`Duration 8.48s`，退出 0。代码/规则限定 `git diff --check aa8b26fe...HEAD -- client server shared AGENTS.md .cursor/rules` 退出 0。完整 diff 检查仅提示保留的原始构建日志末尾空行与 Vite 日志尾部空格，非运行代码问题；没有修改原始日志。

最终审查结论：四项原发现已全部闭合，未发现新的阻断项。此次未另跑类型/构建，仅核对主代理该提交的既有回执；未做生产登录、真实音乐/分镜/视频模型调用、真实 GCS/数据库写入、真实扣退或发布。正式质量与端到端付费验收仍未完成；合并是否安全由主代理紧邻操作实时检查正式/隔离机器任务、进程及双端部署。本代理只更新本审查条目，未改核心代码/远程状态。

## 2026-09-13 11:41:53 CST · 独立子代理复审

被审 HEAD `aa8b26feb101260154cf2e56c7b8a07e12a6b16d`；实时查询 PR #1456 为 OPEN，HEAD 与本机相同：`https://github.com/gabrieltan0506-prog/mvstudiopro/pull/1456`。已读取 `3261afa2...aa8b26fe` 新增差异及受影响路径，并读取新增十分钟知识库/发布闭环规则。

原三项闭合证据：合成终态后显式新版本重新采集当前镜头，旧输入、任务和最终节点保留；分镜 request 带固定截止时间，resolution 原子对象约束迟到执行，过期原 parsed 可恢复，403 等存储错误不冒充不存在；MV 子镜不再合入父节点整首歌词与计划，真实离线出站 prompt 由 504/507 字降至 60/63 字，并断言不包含另一镜动作。

复验命令：`pnpm exec vitest run server/routers/canvasMusicMv.test.ts server/routers/canvasMusicMvAssemble.test.ts client/src/lib/canvasMusicMv.browser.test.ts client/src/lib/canvasMusicMvWorkflow.test.ts client/src/lib/canvasMusicMv.persistence.test.ts client/src/lib/canvasMusicMvRecovery.test.ts`。原始结果 `Test Files 6 passed (6)`、`Tests 35 passed (35)`、`Duration 9.64s`，退出 0，包含 6 项真实离线浏览器测试。

新增 P2：`CanvasMusicMvStudio.tsx:420–429` 对输入变化无条件执行 `invalidateMusicMvPlan`；`FreeformCanvas.tsx:3340–3354` 外层 `block.prompt` textarea 没有 pendingPlan/busy 锁。默认 creativePrompt 为空时提交分镜，再修改外层音乐提示词，effect 会清空原 planRequestId/planInput 并停止查询。若原请求断网待确认，busy 解锁后允许使用新编号生成，旧服务端执行仍可成功扣费，但旧回包会因身份不符被丢弃。应在未知请求期间保留原身份/快照，处理完原任务再显式开始下一轮；不能只锁 Studio 内的创意文本框。该路径现有浏览器 fixture 未渲染 FreeformCanvas 外层输入，尚未动态执行；结论依据两端真实 handler/effect 的赋值链。

此轮只读代码/PR与运行隔离测试，仅更新本记录。未新增付费、生产调用、提交或远程写操作。等待主代理修复后复验新 HEAD。

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

# 剧情音轨工作台：施工证据与验收

## 改前证据表

| 检查项 | 当前证据及本轮边界 |
| --- | --- |
| 用户结果 | 先看剧本，再逐句生成/审听对白；同角色可分别选择变身前后声音；BGM多版试听、每次只裁一个动作段；明确角色、镜头和片内秒窗后采用。 |
| 允许/禁止 | 本地实现与验证；不提交、推送、合并、部署，不新发付费媒体；不修改定价、全局角色声线、旧生成结果。 |
| 入口 | 原FreeformCanvas逐句按钮只读临时草稿，旧整段按钮会重新购买全部台词；新增共用工作台替代这两个操作，并按用户补充接入ManhuaScriptWorkbench当前段，切段不跳画布。 |
| 真实生产者 | 逐句复用既有TTS通道和人声门禁；BGM复用queueManhuaBgm已有持久jobs；裁切、秒锁试听由post_prod的真实ffmpeg任务执行。 |
| 契约/存储 | 新增block.audioStudio；候选保留，采用独立；新字段穿过canvasTypes、云草稿过滤、同步与恢复；长期身份用GCS而非仅签名地址。 |
| 最终消费者 | runCanvasBlock按最终音频数组顺序编译编号、角色和秒窗；有新音轨时拒绝不支持模式及超量，不静默丢轨；无新字段时旧路径惰性。 |
| 计费/权限 | 沿用每句3积分、BGM每次20积分；纯裁切/拼轨不新增计费；本人素材服务端验主；逐句操作同号不重发上游，未知回执保留等待核对。 |
| 失败/恢复 | 保留旧候选及待完成任务编号；后台结果读取后对照输入指纹，不将旧结果自动采用；修改秒窗不重新合成对白。 |
| 已知断点 | 旧逐句仅扣费幂等但生成不幂等；旧音频gs身份被云过滤；全局角色声线无法表达同人前后态；BGM旧创建异常退款与永久原始回执有独立已知风险，不能宣称本轮已解决。 |
| 验证目标 | schema往返/旧草稿；最终真实请求编号与非空音频；单句并发幂等与未知不重烧；裁切越界/所有权/真实字节时长；目标及上下游测试、类型和构建。 |

## 状态

本地部分验证；未发布、未线上实跑，不能称完整产品能力已验收。

## 最终实现与双向追链

正向：工厂「本段对白与配乐」或自由画布可选入口 → 当前clip ID的audioStudio → 页面明确费用确认 → 单句持久操作／原有BGM队列／免费后期队列 → 真实音频GCS身份＋实测时长 → 独立试听和确认 → runCanvasBlock按最终数组生成角色、镜头和秒窗 → API扣费前本人素材校验 → worker现签 → 实际供应商请求body。

反向：供应商audio_urls／audio_url → worker从task.audioUrls现签而不改长期身份 → API保存audioReferences → compileCanvasAudioBindings中候选gcsUri及@audio编号 → 当前cue的selectedTakeId、inputKey、enabled和approved → 原billingRequestId或post_prod jobId → 原生产回执。同号恢复仅保存与结算，不重新合成；GET只读。

已追查另一按钮、批量/重跑、旧草稿、重分段、整集重铺、归档、换剧备份与回落路径。原段同源revision保留；新段不克隆旧声音；旧声音和在途单归档且退出自动队列。换剧ZIP保留audio/state.json完整节点和长期索引，不内嵌音频；自动ZIP导入音轨不在本轮实现范围，日常恢复走原本机/云草稿链。

## 分层验收

| 层 | 状态 | 证据 |
| --- | --- | --- |
| 需求与边界 | 已验证 | 工厂与自由画布复用，不新增自由画布关键帧前置；没有远端写入与新增付费实跑。 |
| 入口与交互 | 已验证（离线） | 两份真实浏览器测试8项；完整工厂切两段分别写clip-e01-g01-audio、clip-e01-g02-audio，focus为空、review为0、生成调用为空。 |
| 数据生产 | 部分完成 | 真FFmpeg输出通过时长/字节验收；TTS/BGM沿既有真实生产服务，但本轮未新发线上音频。 |
| 契约与转换 | 已验证（本地） | 云序列化→清洗→恢复→最终音频数组同GCS；未知标签、越界、超量明确拒绝，不截断。阶段名仅分组，实际声音由音色/合法语气控制。 |
| 服务与副作用 | 部分完成 | 唯一抢占、同号结算、原单恢复、超时容量、越权零提交测试通过；真实DB并发与实际扣退未验。 |
| 存储与恢复 | 部分完成 | 任务实际写盘仍存GS；重分段归档、本机/云往返、原单恢复测试通过；真实GCS/数据库/浏览器刷新待线上验收。 |
| 消费与展示 | 部分完成 | 非空PCM、浏览器播放器与供应商实际body构造已验；声音品质与视频口型/节奏尚未验。 |
| 静态与回归 | 已验证（目标范围） | 统一30文件345 tests passed；类型、服务端构建、Vite构建通过。未跑本轮全仓测试及Docker部署。 |
| 真实线上链路 | 已实现但未验证 | 尚未上线，未实跑真实用户动作→上游→持久化→扣退→最终视频质量。 |

## 命令与原始结果

- `pnpm install --force --frozen-lockfile --ignore-scripts`：退出0，恢复本机缺失依赖工具；没有增加依赖，锁文件未改。
- `pnpm check`：退出0。
- `pnpm exec tsc --noEmit --incremental false`：退出0，不依赖增量类型缓存。
- `pnpm build`：退出0（tsc服务端构建）。
- `pnpm exec vite build`：退出0，最后一次3562 modules transformed，built in 25.86s；仍有既有混合静态/动态导入及大chunk警告。
- `git diff --check`：退出0。
- 统一目标回归 `pnpm exec vitest run`，传入以下30个文件：

```text
shared/canvasAudioStudio.test.ts
shared/canvasDialogueControls.test.ts
shared/manhuaCloudDraft.test.ts
shared/manhuaCloudDraft.roundtrip.test.ts
client/src/lib/manhuaCloudDraftSync.test.ts
client/src/lib/canvasRunBlock.referenceIntent.test.ts
client/src/lib/canvasRunBlock.videoEdit.test.ts
client/src/lib/canvasRunBlock.pilot.test.ts
client/src/lib/canvasDramaStudio.test.ts
client/src/lib/canvasDramaStudio.seriesSwitch.test.ts
client/src/lib/canvasDramaStudio.videoEditOnly.test.ts
client/src/lib/manhuaSeriesSwitchGate.test.ts
client/src/lib/canvasAudioStudio.browser.test.ts
client/src/lib/manhuaAudioStudio.browser.test.ts
client/src/lib/postProdWorkshop.test.ts
server/routers/canvasAudio.test.ts
server/services/canvasDialogueOperation.test.ts
server/services/audioTimelineRender.test.ts
server/jobs/postProdJob.test.ts
server/services/postProdMediaSource.test.ts
server/services/qwenDialogueTts.test.ts
server/jobs/staleJobsReaper.test.ts
server/services/manhuaDialogueTtsRoute.test.ts
server/services/manhuaDialogueTtsService.test.ts
server/services/tokenPlanDialogueTts.test.ts
server/services/tokenPlanDialogueTtsWs.test.ts
server/services/evolinkSeedanceVideo.test.ts
server/services/byteplusSeedanceVideo.test.ts
server/services/canvasVideoAudioReference.test.ts
server/services/canvasVideoTask.audioReference.test.ts

Test Files  30 passed (30)
     Tests  345 passed (345)
  Duration  15.09s
```

另用当前已下载BGM通过实际TS参数构造器裁13–21秒、1秒入场：`/private/tmp/audio-seconds-lock-check.iOY7Eq/typed-real-bgm-timeline.wav`，10.000000秒、1920172字节、48kHz双声道PCM。原曲未覆盖。此为本地媒体验收，不是线上产物。

## 实际修改文件

```text
.cursor/knowledge/PROGRESS.md
.cursor/knowledge/manhua-factory-brief.md
api/jobs.ts
client/src/components/ManhuaScriptWorkbench.tsx
client/src/components/canvas/CanvasAudioStudio.tsx
client/src/components/canvas/FreeformCanvas.tsx
client/src/components/canvas/PostProdWorkshopCard.tsx
client/src/lib/canvasDramaStudio.ts
client/src/lib/canvasDramaStudio.test.ts
client/src/lib/canvasRunBlock.ts
client/src/lib/canvasRunBlock.referenceIntent.test.ts
client/src/lib/canvasTypes.ts
client/src/lib/manhuaCloudDraftSync.ts
client/src/lib/manhuaCloudDraftSync.test.ts
client/src/lib/manhuaSeriesSwitchGate.ts
client/src/lib/manhuaSeriesSwitchGate.test.ts
client/src/lib/postProdWorkshop.ts
client/src/lib/postProdWorkshop.test.ts
client/src/lib/canvasAudioStudio.browser.test.ts
client/src/lib/manhuaAudioStudio.browser.test.ts
client/src/pages/OmniCanvas.tsx
server/jobs/postProdInput.ts
server/jobs/postProdJob.ts
server/jobs/postProdJob.test.ts
server/jobs/staleJobsReaper.ts
server/jobs/staleJobsReaper.test.ts
server/routers.ts
server/routers/canvasAudio.ts
server/routers/canvasAudio.test.ts
server/services/canvasDialogueOperation.ts
server/services/canvasDialogueOperation.test.ts
server/services/canvasVideoTask.ts
server/services/canvasVideoTask.audioReference.test.ts
server/services/canvasVideoAudioReference.ts
server/services/canvasVideoAudioReference.test.ts
server/services/audioTimelineRender.ts
server/services/audioTimelineRender.test.ts
server/services/manhuaDialogueTtsRoute.ts
server/services/postProdMediaSource.ts
server/services/postProdMediaSource.test.ts
server/services/postProduction.ts
server/services/qwenDialogueTts.ts
server/services/qwenDialogueTts.test.ts
shared/canvasAudioStudio.ts
shared/canvasAudioStudio.test.ts
shared/canvasDialogueControls.ts
shared/canvasDialogueControls.test.ts
shared/manhuaCloudDraft.ts
docs/canvas-audio-studio-0908.md
```

## 未验证、限制与下一步

没有本轮全仓测试、Docker构建、生产数据库并发、线上GCS续签、真实费用/退款、TTS声音品质、BGM新生成及最终口型实跑。现有BGM原始供应商回执永久保存与创建异常退款边界的已知风险未扩改；不能把本次界面复用解释成这些风险已解决。

音频裁段/合听单段最多30秒，合听最多12片，出片参考最多10条，超量拒绝；采用音频长于秒窗也拒绝，不自动截词。物理合听是秒级定位；视频模型参考并非硬口型保证，必须审片。未支持声音投料的引擎有事前提示，不能静默丢轨。

以上为首次本地验收时点；发布授权与最新结果见下节。真实付费验收仍不随上线授权自动扩大。

## 2026-09-08 联合发布增量

用户明确要求「一起上线，你派一个子代理审查」，因此将本批音轨工作台与原 PR #1419 的普通视频参考职责修正统一发布，不另建 PR。本文记录提交前状态，不能代替合并后双通道部署回执。

独立子代理提出的四项问题均已修正并复审通过：已扣至零余额时凭原账恢复、最近30条以外的旧BGM按持久任务补查、长对白合听签名固定71字符并在入队前校验整份状态、TTS完整解码成PCM并使用实测时长而非门禁舍入值。独立复审6文件42项全过，未发现新的P0–P2；原失败MP3转换为540058字节、2.812396秒PCM后可完整合听。

新增文件：`client/src/lib/canvasAudioStudioRecovery.ts`、同名`.test.ts`、`server/services/canvasDialogueCharge.ts`及同名`.test.ts`。本批共53个修改/新增文件，列表为上节49项加本段4项。四处修正的正反向追链均回到同一个账目键、持久任务ID、预览摘要和PCM对象，不改定价、凭证存放或全局计费函数。

最新统一回归：上节30文件加两个新测试文件，原始结果为 `Test Files 32 passed (32)`、`Tests 353 passed (353)`、`Duration 11.88s`。包含新增真实浏览器回归：旧BGM取回并选择、六条长对白实际入队与71字符持久签名。

最终 `pnpm exec tsc --noEmit --incremental false`、`pnpm build`、`pnpm exec vite build` 均退出0；Vite输出 `3563 modules transformed`、`built in 11.08s`，既有chunk/混合导入警告保留。无新增依赖，package、锁文件及部署配置没有改动。Docker验证由获准合并后的既有CI执行，本地未执行Docker。

本轮亦执行全仓 `pnpm exec vitest run`：`555 passed | 2 failed | 2 skipped (559)`，`5334 passed | 2 failed | 4 skipped (5340)`。失败仅为既有 `manhuaNativeDeepReadBatchCli.test.ts` 与 `manhuaNativeDeepReadProbeCli.test.ts` 对7201上限的两项CLI断言；相关脚本与测试无本轮diff，此前PROGRESS已记录同样失败。本轮未改冻结读片契约来消除旧失败。

分层状态更新：入口、契约、恢复和消费已完成本地双向追链及目标回归；真实数据库并发、实际扣退、声音品质、最终视频口型仍未线上验收。发布成功也只证明新版本上线，不能把这些项目改称已验证。BGM原始回执/异常退款的既有风险仍保留。

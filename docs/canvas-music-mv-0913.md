# 音乐与 MV 画布链路施工证据

状态：部分验证。本地实现与隔离测试已执行；未做线上或付费验收，不能称为正式产品全链完成。

| 门禁 | 改前证据与范围 |
|---|---|
| 最终结果 | 独立音乐节点，生成或导入整首音频，选版后生成完整时间轴分镜、逐镜制作、合成回写 |
| 入口 | FreeformCanvas / runCanvasBlock；已有音轨工具只在视频节点内 |
| 生产者 | queueManhuaBgm → audio job → TTAPI；MV分镜新增鉴权生产接口；视频复用runCanvasBlock |
| 转换存储 | canvasTypes、manhuaCloudDraft sanitizer、cloud sync必须共同保存musicMv及任务身份 |
| 消费者 | 视频节点读取每镜提示词和参考；最终合成明确传所选musicUrl与精确trim |
| 计费权限 | 沿用音乐、分镜、单镜视频、合成现价；先持久请求ID，未知结果查原任务 |
| 失败恢复 | 保留成功音乐变体、成功视频及旧版本；刷新查原任务，禁止自动重提未知付费单 |
| 验证 | 类型、相关回归、草稿往返、部分失败续跑、真实本地ffmpeg音画验真；付费与生产未授权不执行 |

本地实现不自动授予发布或付费重试权限。

## 实际行为与双向追链

音乐节点调用已有 queueManhuaBgm，worker 向 TTAPI 提交 Suno V6，原始请求、响应和解析分别存证。每个候选保存实际 ffprobe 时长、SHA、musicId 和永久 GCS 地址；缺少候选明确展示，不补发任务。也支持上传已有音频。

选定 audioId 后，鉴权 draftPlan 使用歌词与创作描述产生覆盖整首实际时长的分镜；请求、结果和结算凭据按用户及 requestId 保存。确认后生成带 planRequestId/audioId/shotId 和参考图绑定的视频节点，复用现有 runCanvasBlock 生产、扣费及恢复路径。合成以同一计划身份反向读取服务端已结算记录，逐项核对音频及视频任务所有权、GCS 产物和镜头齐备，再进入现有合成 worker。最终视频节点由同一合成任务回写。

刷新从云草稿恢复原请求编号及输入，查询原任务；成功镜头跳过，明确失败可手动重做，未知提交停止并保留编号。视频提交指纹单独持久化，运行中改稿后旧结果进入历史，避免覆盖新稿。无参考镜头不会从父节点隐式补入图片。参考签名刷新失败在提交前拒绝。

## 分层状态

| 层 | 状态 | 证据与边界 |
|---|---|---|
| 需求与范围 | 已验证 | 改前证据表；本轮无付费调用、无远程发布 |
| 入口与交互 | 部分完成 | 实际 React 面板离线浏览器 5 项通过；正式登录页面未验 |
| 数据生产 | 部分完成 | 路由、worker、供应商解析、实际时长提取接通并测试；真实模型未调用 |
| 契约与转换 | 已验证 | 同一 schema 校验连续时间线、候选与引用，云草稿往返及另一视频入口回归通过 |
| 服务与副作用 | 部分完成 | 同请求幂等、拒绝/未知分离、素材归属、扣退恢复测试通过；真实扣退未验 |
| 存储与恢复 | 部分完成 | 本地/云草稿序列化及刷新恢复验证，实际 GCS/数据库本轮未写入 |
| 消费与展示 | 部分完成 | 真组件回写视频节点、真实 FFmpeg 音轨与时长验真；真实生成内容质量未验 |
| 静态与回归 | 已验证 | 专项 31 文件 396 项、类型、非增量构建、Vite、格式与 diff 通过；未跑全仓 |
| 真实用户全链 | 已实现但未验证 | 未做正式登录→付费音乐→分镜→视频→合成→计费实跑 |

## 验证命令与原始结果

- `pnpm install --frozen-lockfile --offline`：退出 0，干净工作树安装 1317 包；没有新增依赖或修改锁文件。
- 29 文件专项 `pnpm exec vitest run ...`：367 项通过，0 失败，30.50 秒，完整文件列表可在 tests.log 核对。
- 公共素材权限与合成完整性 2 文件：29 项通过，0 失败，2.33 秒。因此本次专项共 31 文件、396 项，不是全仓测试。
- 最后两处测试类型修正后重跑恢复测试，18 项通过，结果记录在 final-recovery-tests.log；没有修改运行时代码。首次类型检查暴露测试对象推断与 MapIterator 的默认编译目标问题，已补类型及 Array.from。
- `pnpm check`、非增量服务端构建、Vite 构建全部退出 0；Vite 29.96 秒，仍有体积和动态/静态导入警告。新增源码 Prettier 检查与 `git diff --check` 退出 0。
- 原始日志保存在本目录 evidence/music-mv-0913；测试中的 OAuth 缺配置、模拟 db down 是隔离环境/故障注入输出，不是生产回执。

真实 ffmpeg/ffprobe 使用虚构正弦测试媒体，无模型、网络或用户歌曲。4 秒成片 120 帧、72786 字节，歌曲幅度约 0.125；原视频 440/880 Hz 分量低于 0.000037。对照组保留原声约 0.125，证明只对 MV 的 musicOnly 路径静音。十段 0.53 秒采用累计时间量化后为 159 帧、5.300 秒；音频容器 5.312 秒，存在 12 毫秒 AAC 尾差，不宣称容器零误差。证据：[音轨验真](./evidence/music-mv-0913/evidence.json)、[分数帧时长验真](./evidence/music-mv-0913/fractional-timing.json)。

## 限制与待验事项

本节点新生成通道为 Suno V6；Mureka 仅可导入已有音频，本次没有接入其新生成 API。分镜依据歌词、描述与实际时长，不包含真实听歌、节拍识别或精准口型对齐。视频模型质量、长歌曲峰值、正式浏览器、生产 GCS/数据库以及真实扣费退款仍未验。请求结果未知时保留原编号等待核对，不自动支付重试。没有改现价、权限合同或启动任何已有付费任务。

当前本地分支 feat/music-mv-canvas-0913，基线 9d15eadb39174a148419072138bbdca68a37a3b7；未 commit、push、创建 PR 或部署。发布前需确认本轮交付去向及远程动作授权；真实付费验收需另行明确最小范围。

## 实际修改文件

- `.cursor/knowledge/PROGRESS.md`
- `.cursor/knowledge/kb/INDEX.md`
- `.cursor/knowledge/kb/channels.md`
- `.cursor/knowledge/kb/line-canvas.md`
- `client/src/components/canvas/FreeformCanvas.tsx`
- `client/src/lib/canvasRunBlock.ts`
- `client/src/lib/canvasTypes.test.ts`
- `client/src/lib/canvasTypes.ts`
- `client/src/lib/canvasVideoTaskResume.test.ts`
- `client/src/lib/canvasVideoTaskResume.ts`
- `client/src/lib/manhuaCloudDraftSync.ts`
- `client/src/pages/OmniCanvas.tsx`
- `server/jobs/manhuaBgmJobInput.test.ts`
- `server/jobs/manhuaBgmJobInput.ts`
- `server/jobs/manhuaBgmRefundRecovery.test.ts`
- `server/jobs/runner.manhuaBgmV6Settlement.test.ts`
- `server/jobs/runner.ts`
- `server/routers.ts`
- `server/services/manhuaAssembleFinalService.ts`
- `server/services/manhuaScoringRoom.test.ts`
- `server/services/manhuaScoringRoom.ts`
- `server/services/ttapiSunoMusic.test.ts`
- `server/services/ttapiSunoMusic.ts`
- `server/vercel-api-core/renderSourceAudio.ts`
- `server/vercel-api-core/renderTypes.ts`
- `shared/manhuaAssembleJobInput.ts`
- `shared/manhuaCloudDraft.ts`
- `.cursor/knowledge/kb/music-generation-variants.md`
- `client/src/components/canvas/CanvasMusicMvStudio.tsx`
- `client/src/lib/canvasMusicMv.browser.test.ts`
- `client/src/lib/canvasMusicMv.persistence.test.ts`
- `client/src/lib/canvasMusicMvGuards.test.ts`
- `client/src/lib/canvasMusicMvGuards.ts`
- `client/src/lib/canvasMusicMvRecovery.test.ts`
- `client/src/lib/canvasMusicMvRecovery.ts`
- `client/src/lib/canvasMusicMvWorkflow.test.ts`
- `client/src/lib/canvasMusicMvWorkflow.ts`
- `docs/canvas-music-mv-0913.md`
- `server/routers/canvasMusicMv.test.ts`
- `server/routers/canvasMusicMv.ts`
- `server/routers/canvasMusicMvAssemble.test.ts`
- `server/routers/canvasMusicMvAssemble.ts`
- `server/services/canvasMusicMvMedia.test.ts`
- `server/services/canvasMusicMvMedia.ts`
- `server/vercel-api-core/renderMusicOnly.integration.test.ts`
- `shared/canvasMusicMv.ts`

附带证据文件：`docs/evidence/music-mv-0913/commands.txt`、`evidence.json`、`fractional-timing.json` 及 7 份原始验证日志。

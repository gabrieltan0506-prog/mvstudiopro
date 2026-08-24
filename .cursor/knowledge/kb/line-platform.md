# line-platform · /platform 内容创作线（动态层，每班收班更新）

> 更新：2026-08-17。本线已交接给 UI/功能线 agent，此处存事实供跨线查阅。

## 已上线的关键机制（改动时别打破）
- **逐镜拆片表**：schema `shared/platformStoryboardCells.ts`（7 列，cellIndex 1–12，normalize/fallback/两种格式化器，5 用例）；生产者在 `server/services/platformTopicShortlist.ts` 扩写 prompt；消费端结果卡表格 + 六栏出图文本。
- **扩写双引擎按条计费**：20 点/条 × 勾选数，确认弹窗明示「失败条自动退款」；引擎枚举 稳定档(kimi-k3)/轻快档(qwen3.8-max)，attempts 双通道 fallback，退款幂等（runner.ts expand 分支）。
- **出图断线续航三件套**（#1190 样板，可复用到画布批次）：localStorage 记录（jobId+kind+30min 龄期）→ mount 恢复轮询（posterResumeRanRef 防重）→ finally 清账。PlatformPage.tsx 常量 ~:300、mount effect ~:3190。
- 单页知识卡多页循环 + lastResult 找回（「N 分钟前」toast）。

## 本地已实现（未部署）
- **原生精读面板真值热修**：`/platform` 的 AI 漫剧学习区按 owner 能力显示原生视频精读说明、计划预演按钮与批次范围；抖音原生候选在权限读取失败或 owner 不匹配时关闭式停止，不再静默建立旧抽帧任务。历史任务按 `pipelineMode` 明示「原生精读／旧抽帧」。
- **批准模板 owner 查看/优化**：入口位于 `/platform` → AI 漫剧 →「模板库（已批准 · 编剧室可选）」。完整库、单卡详情、原始 GCS 列表、优化调用与修订批准都以 `OWNER_OPEN_ID` fail-closed；角色和监管会话不能替代 owner。
- 优化结果只落 `manhua-template-learn/proposals/`；owner 批准后旧版先归档到 `archive/`，再以原内部 id 与 publicCode 替换 `approved/`。`/canvas` 未改，继续只读匿名 `listApprovedPublic`。
- 模型档：Terra High、Kimi K3 Max、Claude Opus 5 High、DeepSeek V4 Pro 0813 High。DeepSeek 不传 temperature/top_p，固定 65536 + JSON + `require_parameters=true`。未做付费实跑或线上 GCS 写入。

## 待执行（已批口径）
1. CREDIT_COSTS 双源合并（shared/plans.ts + server/plans.ts → 单真源）。
2. 旧同步扩写 mutation 下线（routers.ts expandPlatformTopicPicks 同步版）。
3. 5 处复制按钮**拿掉**（不许拿报错当交付）：GodViewPage:249 / VideoParserWidget:248 / HomeMyWorks:167 / ManhuaEditMultitrackPanel:399 / ManhuaScenePropDemoStrip:236。
4. 出图 90s 超时滑贵价通道：服务端修超时（用户侧通道选择已否决）。

## 待批
- 长文→图文知识卡（提炼 25 点/次 + 按页现价），全案 `~/Downloads/2026Aug12/功能提案-长文转知识卡.md`。

## 已否决（别再提）
- 用户侧出图通道下拉；B 线媒体水印（当期）；Neon 迁移。

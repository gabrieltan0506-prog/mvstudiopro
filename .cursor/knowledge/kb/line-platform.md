# line-platform · /platform 内容创作线（动态层，每班收班更新）

> 更新：2026-08-17。本线已交接给 UI/功能线 agent，此处存事实供跨线查阅。

## 已上线的关键机制（改动时别打破）
- **逐镜拆片表**：schema `shared/platformStoryboardCells.ts`（7 列，cellIndex 1–12，normalize/fallback/两种格式化器，5 用例）；生产者在 `server/services/platformTopicShortlist.ts` 扩写 prompt；消费端结果卡表格 + 六栏出图文本。
- **扩写双引擎按条计费**：20 点/条 × 勾选数，确认弹窗明示「失败条自动退款」；引擎枚举 稳定档(kimi-k3)/轻快档(qwen3.8-max)，attempts 双通道 fallback，退款幂等（runner.ts expand 分支）。
- **出图断线续航三件套**（#1190 样板，可复用到画布批次）：localStorage 记录（jobId+kind+30min 龄期）→ mount 恢复轮询（posterResumeRanRef 防重）→ finally 清账。PlatformPage.tsx 常量 ~:300、mount effect ~:3190。
- 单页知识卡多页循环 + lastResult 找回（「N 分钟前」toast）。

## 本地已实现（未部署）
- **原生精读五分钟失联根因修复**：线上两次 `fetch failed` 分别发生在 326 秒和 342 秒；代码虽然有 30 分钟业务总时限，但 Node/Undici 仍使用默认 300 秒响应头时限。现为该模型请求单独配置 30 分钟 headers/body timeout，仍由原 AbortSignal 负责总时限；同时把底层 `cause.code/name/message` 写入 owner 回执。Growth Backup 已有互动租约让行机制，但 Job runner 原来只给 `platform` 任务建租约，现把真实登录用户的 `video/manhua_template_learn` 纳入同一租约，避免学习期间同机冷备拉取与打包大文件。
- **原生精读长请求与学习面板稳定性**：非流式 Qwen 请求的 socket idle 由 120 秒改为 10 分钟，总时限保留 30 分钟；任务轮询不再依赖整颗 tRPC query 对象，无变化的服务端 Job 快照复用旧数组引用，避免 3 秒轮询退化成无间隔 GET 并重绘原生下拉。静态与全量测试已过，Fly 旁路真跑待执行。
- **原生精读占位与刷新恢复**：历史 claim 继续隔离但不再挤占“学习 N 集”的名额，计划确认仅在执行清单与 claim 重叠时拒绝，逐集调用前仍原子抢 claim。终态失败在当前会话可见，刷新后清掉失败自动焦点并回正常入口；运行中与成功待续仍恢复。静态与全量测试已过，线上面板真跑待执行。
- **原生精读面板真值热修**：`/platform` 的 AI 漫剧学习区按 owner 能力显示原生视频精读说明、直接开始按钮与自由批次范围；点击后直接建立持久任务，不再先走前台预演。抖音原生候选在权限读取失败或 owner 不匹配时关闭式停止，不再静默建立旧抽帧任务。历史任务按 `pipelineMode` 明示「原生精读／旧抽帧」。
- **原生精读 300 秒四片与页面收口**：生产分片固定最长 300 秒，约 18 分钟素材拆 4 片；取消旧 64MB 整集媒体预算与预转码，每片原样上传 GCS、独立调用。当前学习页面只恢复原生精读任务，点击后开始态立即写 `native_deep_read`，不再先闪旧抽帧页面；模型返回只显示“正在校验”，门禁拒收会先写明拒因再重试。300 秒以内固定 10fps；视觉首轮温度 0.7，后续两次为 0.65 / 0.6，不得归零。模型徽章固定显示 Gemini 3.1 Pro。
- **原生精读分片重试与透明回执（2026-08-27 施工中）**：同一 Vertex 分片所有失败统一最多三次，固定温度 `0.7 → 0.65 → 0.6`、两次间隔各 60 秒；用户中止不重试，也不得静默换供应商。每次模型请求均记录 started 与 completed/failed，包含尝试序号、温度、HTTP/底层网络 cause、request id、finish reason、token、费用与耗时。单集媒体备料和模型调用各最多四并发，跨集仍串行；任一 worker 失败后不再领取新段，但等待已在途任务收尾并统一清理。GLM 5.3 整集结构化输出上限固定 131072，真实四分片聚合曾在 12 分钟客户端边界被中止，现只把单次等待放宽到 30 分钟，不自动重提。
- **首张新模板范本**：系列 `36a7c84f485b` 的第 1 集原生精读成果已直接写入 `approved/tpl_native_36a7c84f485b_ep001.json`；包含 96 镜、115 条字幕，进度为 1/4。它虽来自一次 360 秒分片，但属于原生视频精读的新模板成果，继续保留；后续发车仍统一按 300 秒分片，并从同一来源补全。
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

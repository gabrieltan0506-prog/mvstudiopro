# EvoLink 视频永久 JSON 证据与恢复边界审计（2026-09-08）

## 当前状态：阻塞，未实施生产补丁

本次只审查代码并新增本文，**未实施永久生成证据自动化**，未改 provider、任务状态机、公共 API、UI、模型参数、计费价格或账本。尤其保留现行可恢复任务的 **24 小时退款规则**，不以存证修复为由改变其语义，也不把未知结果提前标为成功或已结算。

审计基线为 `24123bb2ac2d59b90f92f167e0acff2cc179c37f`，工作分支为 `fix/canvas-pilot-evidence-0908`。下文行号来自该基线；同工作树另一项普通视频提示词改动不属于本审计。

主代理报告本轮三段已有视频均已生成成功。本审计未访问生产服务核验其任务或画面，不复制该报告为独立验收结论。现有代码没有保存当时的创建响应原文；当前三段只能另行补采已知供应商任务号的终态查询 JSON，必须标记“补采时间／查询回执”，不能冒充当时的提交响应或历次轮询原文，也不能为补证据重新生成视频。当前可见链路无法恢复已被丢弃的创建原文；若将来供应商提供当时原始记录，需另外注明来源、原始时间和取得方式。

## 改前证据表

| 层次 | 已读取的事实与边界 |
| --- | --- |
| 最终结果 | 每次响应先保存完整原始字节，再解析并另存完整 JSON；存证失败不引发重新 POST、误退款或换通道重购。当前未实现。 |
| 授权范围 | 本轮最终只允许只读代码及新增单份中文审计文档；不施工生产代码，不提交、推送、部署或真实调用。 |
| 真实入口 | 异步画布两个提交包装；三个同步 API 调用；画布及首页共享的 EvoLink 查询函数。完整列表见下节。 |
| 数据生产者 | `POST /v1/videos/generations` 的创建响应，以及 `GET /v1/tasks/:id` 的查询响应。 |
| 转换与存储 | 当前 provider 直接 `.json()`，解析失败降为 `{}`；任务层只保存抽取字段，并非完整原始／解析 JSON。 |
| 最终消费者 | 轮询快照、MP4 镜像、`succeedTask` 与 UI 任务状态；完整供应商字段在此之前已被丢弃。 |
| 计费及失败 | 提交异常进入 `failTask`；轮询／镜像异常通常保留运行态；账本另有 24 小时退款硬底，暂停不足以绕开。 |
| 已知断点 | 永久原文缺失、提交意图缺失、同步请求无稳定身份、未知提交无法与确定失败统一处理、账本超时语义与“未知结果不自动退款”要求冲突。 |
| 验证边界 | 只做代码追链和文档差异检查；未执行新 provider 测试、类型／构建、故障注入、生产读取或付费调用。 |

## 当前调用点与消费者

路径均相对仓库根目录，行号为本次实际读取位置。

| 入口／环节 | 代码位置 | 当前行为 |
| --- | --- | --- |
| 创建响应生产者 | `server/services/evolinkSeedanceVideo.ts:119`；请求 `:141`；解析 `:151` | POST 后直接解析；未先持久保存响应字节；返回抽取的任务 ID／即时 URL。 |
| 单次查询生产者 | `server/services/evolinkSeedanceVideo.ts:62`；解析 `:85` | GET 后直接解析；只返回 completed/sourceUrl、failed/error 或 running/status。网络／HTTP 查询故障不是任务终态。 |
| 同步封装 | `server/services/evolinkSeedanceVideo.ts:273`；旧名 `:292` | 提交→循环查询→镜像；无稳定调用身份和永久响应回执。旧名为兼容导出，本次搜索未发现其他生产调用点。 |
| 异步 Seedance 2.5 | `server/services/canvasVideoTask.ts:408` | `submitSeedance25Evolink`，返回之后才保存供应商 ID、模型和运行态。 |
| 异步 Mini／2.0／fast | `server/services/canvasVideoTask.ts:440` | `submitSeedanceEvolinkVersioned`，同样在 provider 返回后才保存句柄。 |
| 画布 Seedance 查询 | `server/services/canvasVideoTask.ts:1079` | 共用单次查询；完成后镜像，明确失败才调用 `failTask`。 |
| 画布 HappyHorse／Wan 查询 | `server/services/canvasVideoTask.ts:1111`、`:1154` | 也调用同一查询函数，不可因修改 Seedance 而改变其异常／退款语义。 |
| 首页 HappyHorse 查询 | `server/services/homePhotoAnimateTask.ts:434` | 同一查询函数；外层 `:540` 捕获查询异常保持 running。 |
| 同步场景视频 API | `api/jobs.ts:3319` | `workflowGenerateSceneVideo`；`:3331` 的 catch 返回普通生成失败。 |
| 同步仿真人探针 | `api/jobs.ts:5192` | `isProbe` 分支调用同步封装；外层 `chargeCanvasVideoAndRun` 此处设置 `skipCharge:true`，不等于上游免费。 |
| 同步 Mini 探针 | `api/jobs.ts:5394` | `isProbe` 分支调用同步封装；未建立稳定提交意图。 |
| 旧场景 UI | `client/src/pages/WorkflowNodes.tsx:688`、`:709` | 先单独 `chargeStepMutation`，再请求场景生成；请求没有稳定提交键。 |
| 另一旧场景 UI | `client/src/pages/WorkflowStoryboardToVideo.tsx:596` | 经 `runAuxStep` 提交场景请求，也未传稳定提交键。 |

## 为什么不能只把 `.json()` 换成“存文件再解析”

### 异步任务：存证错误可能被当成创建失败

- `canvasVideoTask.ts:409`、`:444` 等待 provider 返回后才赋值 `evolinkTaskId`。如果 POST 已被受理，而原始证据／解析证据保存失败后抛异常，本地任务仍可能没有供应商句柄。
- `canvasVideoTask.ts:985` 的首次提交 catch，以及 `:1036`、`:1056` 的回落提交 catch，直接进入 `failTask`；`failTask` 在 `:567` 写失败状态，并走 `:573` 的退款流程。存证异常不能直接复用这种普通异常分类。
- `canvasVideoTask.ts:336` 的 `canvasVideoTaskNeedsSubmit` 仅以供应商句柄判断是否需要提交。启动恢复 `:1503` 及后续 advance 若看到无句柄任务，会再次进入提交；必须先有持久化提交意图，不能只在返回后写 ID。
- 两个提交包装即时成功后的镜像发生在 `canvasVideoTask.ts:418`、`:464`。镜像异常仍可能落入提交 catch，不能把“视频已生成、搬运失败”当成上游生成失败。
- 轮询／镜像外层 `canvasVideoTask.ts:1274` 已将异常视为瞬态，保留运行态；但新增证据错误仍需要保证优先恢复已收到的原文，而不是用下一次 GET 回执替代它。

### 24 小时账本规则是独立且现行的限制

- `paidJobLedger.ts:872` 定义 `RESUMABLE_HARD_CAP_MS = 24 * 60 * 60 * 1000`。
- `paidJobLedger.ts:955` 先处理 `hold.resumable`；超过硬底即走 `refundHoldAndSyncJob`，随后 `continue`。
- 暂停检查位于 `paidJobLedger.ts:969`，在可恢复任务分支之后。`pauseActiveJob` 虽会在 `:251` 写 `holdPausedAt`，不能阻止上述可恢复任务的 24 小时退款。
- 因此，只将存证失败转成 `reconcile_manual` 并暂停，最多避免任务状态机的即时误退款，不能证明跨 24 小时仍不误退款。本文保留该现行规则，不将它擅自修改为无限期冻结，也不把提前 `settled` 当补救。

### 同步入口：缺少可区分“重试”与“新生成”的身份

若自动随机生成 callId，HTTP 重试或重启可能再次 POST；若按相同输入哈希永久去重，会误拦用户主动以相同内容再次生成；若强制请求提供新字段，则改变旧接口契约。旧 `WorkflowNodes` 又在请求前独立扣费，服务端去重不能单独证明不重复扣用户积分。这需要另行授权 UI、稳定提交键和现有扣费链的统一改造，本轮完全不改。

## 将来可复用的能力与必须同时满足的条件

以下是实现约束，不是已实施功能或验收证据：

1. 异步 taskId 可作为真实内部身份；每个供应商尝试需要独立、可恢复的 attempt 身份，POST 前排他持久保存意图。已存在意图但结果未知时禁止自动 POST。
2. 原始字节和完整解析结果分对象保存，附内部任务身份、供应商任务 ID（收到后）、实际模型／路由、HTTP 状态、完整性、字节数、SHA-256 和存储对象名。不把 Authorization、Cookie、生产密钥或签名 URL写入日志。
3. `server/services/gcs.ts:284` 已有 `uploadBufferToGcsIfAbsent`，`:305` 使用 `ifGenerationMatch=0`；可以复用条件创建。重复上传需核对已有对象的完整字节／哈希，相同才是幂等成功，不能覆盖不同内容。
4. 证据应使用独立持久卷目录，不能继承 `canvasVideoTask.ts:215` 的 `/tmp` fallback。`fly.toml:163` 的现有挂载声明指向 `/data`，只证明配置，未在本审计中验证线上卷或 GCS 生命周期。永久保留还需确认清理任务和桶生命周期不会删除证据，不能仅凭对象名前缀宣称永久。
5. 存证阶段失败必须与上游明确失败分开；已受理、结果未知、已有 raw 待补 parsed、即时完成待镜像均不应自动换通道或新建单。最终状态语义必须先与现行 24 小时规则取得一致，才能实施完整恢复链。
6. 共享 poll 可通过内部可选 context 隔离改动，但须覆盖画布及首页稳定 taskId 的调用点。旧同步调用保持现有行为时，应明确披露其仍没有永久证据自动化，不能称全入口完成。

## 最小需要用户决定的事项

- **本轮已确定：保留 24 小时退款规则，暂不实施这套自动恢复。** 若未来要求“结果未知时不自动退款”覆盖 24 小时之后，需要另行决定如何处理仍未核清的供应商任务和用户退款，不能由代理代改账本规则。
- 若未来要修复旧同步入口，需要单独授权两个旧 UI、稳定提交身份和扣费链一并调整；在此之前，不以 provider 内部去重冒充端到端防重购。

这两项决策之外，现有三段视频无需重新生成。安全后续是对已知原单补采终态证据、核验视频字节和画面，并如实保留“创建原文缺失”的限制。

## 本次执行与未执行验证

- 执行：`git status --short`、`git rev-parse HEAD`，以及针对 provider、任务包装、共享 poll、API、两个旧 UI、GCS helper、账本 reaper 和 Fly 挂载配置的 `rg`／`sed` 只读检查。
- 执行：新增本文后运行 `git diff --check`；原始结果由本轮工具回执记录。
- 未执行：生产代码编辑、类型检查、构建、provider 故障注入、真实任务查询、上游调用、读取凭证、提交／推送／部署。本文无相应通过结论。
- 状态：代码现状与调用关系为“已验证（静态）”；永久生成证据自动化为“阻塞／未实施”；三段历史创建原文为“当前证据链缺失”；画面质量及线上账本验收由主代理另行核验。

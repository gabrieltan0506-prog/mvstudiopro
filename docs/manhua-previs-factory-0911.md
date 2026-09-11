# 动作白模工厂接入：分批证据与断点

## 最终本地验收与交付 · 2026-09-11

**状态：部分验证，未上线。** 第一批 `dd7a18ad` 与第二批 `be0beec1` 已推送统一草稿 [PR #1444](https://github.com/gabrieltan0506-prog/mvstudiopro/pull/1444)；本节为第三批验收与交接记录。没有合并、生产部署或新增付费模型调用。

| 验证 | 原始结果 |
| --- | --- |
| 最终固定源码全仓 | `pnpm exec vitest run --maxWorkers=4 --minWorkers=1 --reporter=dot --silent`；615文件中606过／6失败／3跳过，5758项中5732过／21失败／5跳过，302.28秒，退出1 |
| 最终目标回归 | 11文件200项全部通过，20.17秒，退出0；含工作台10项、消费18项、配置6项、任务／权限8项，以及编排和后期邻接 |
| 真实渲染独立执行 | 配置／失败保全／Blender集成共13项通过；48帧、34356字节、16骨，视频SHA与前稿一致。全仓中的渲染项是显式开启测试而默认跳过，不能与独立真渲染回执混淆 |
| 静态／构建 | `pnpm check`、`pnpm exec tsc --noEmit --incremental false`、`pnpm build`、`pnpm exec vite build --logLevel warn`均退出0；保留现有大包／混合导入警告 |
| 格式／差异 | 12个新增TS/TSX/test文件Prettier检查通过；完整diff及`git diff --check`通过 |
| 证据归档 | 知识库附件6文件与本机真实渲染源逐字节一致；保留原v3/v4，没有覆盖旧工程或视频 |

全仓21项失败全部在本轮前 `edeb254d9610728212d741b62ed8864b87e03ab4` 隔离源码复现，明细为：

- `manhuaWriterTimedGate.test.ts`：3项，测试运行上下文未注入方向策略依赖。
- `manhuaAssetEditSubmit.test.ts`：14项，测试上下文缺少现有图片变体偏好读取依赖，导致调用断言失败。
- `manhuaAssembleAccess.test.ts`：1项，测试上下文缺少取消错误判定函数。
- `manhuaSegmentCapacityWiring.test.ts`：1项，文本断言要求容量字段是旧依赖数组末项，与已有追加字段不符。
- `manhuaNativeDeepReadBatchCli.test.ts`、`manhuaNativeDeepReadProbeCli.test.ts`：各1项，7201边界断言与本轮前代码不符；未改冻结读片参数。

首轮施工中全仓为5730过／23失败／5跳过，其中另2条新白模断言与运行期间源码变更交叠；停止源码改动后的本次完整复验已确认这2条通过，不再列为残余失败，也不冒称它们是基线问题。没有为通过测试删除断言或修改无关业务。

第三批结论：本地生产者、原请求恢复、角色动作说明、三种引擎实际离线出站、旧候选／旧参考保留与失败存证已覆盖；**Linux容器构建、真实DB/GCS、正式工厂点击全链、部署强杀恢复、6角色30秒峰值和付费成片动作跟随仍未验证**。当前环境无Docker/Podman，未以本地Mac渲染替代Linux运行验收。维持草稿PR，后续仅在取得相应授权后做正式环境验收。

下方各时间点为保留的过程快照，遇到提交／测试状态冲突以本节及PR实际状态为准。


## 最新交付状态 · 两批代码已推送

当前统一草稿 [PR #1444](https://github.com/gabrieltan0506-prog/mvstudiopro/pull/1444) 已包含第一批 `dd7a18ad`（渲染底座）和第二批 `be0beec1`（工厂编辑／采用恢复／参考消费）；远端头提交已读回核对为 `be0beec1987b6b69fcc593ac46818b47617da9fe`。未合并、未生产部署。

最终 `pnpm check`、`pnpm exec tsc --noEmit --incremental false`、`pnpm build` 均退出0；最新前端Vite构建也已通过。最终目标回归11文件200项全部通过。已复现的19项基线失败不改为“通过”（另加容量接线测试1项：硬编码旧依赖数组末项，施工前版本同样失败）。首轮全仓启动于施工中，后新增2条白模断言出现失败，但最新代码目标复验均通过；不把这2项冒称基线，已在停止修改源码后另起固定版本全仓，最终总数待回执。第三批是回归与证据收口，不另开PR。

为避免临时目录失效，真实底座验收6个文件已保留至：
`/Users/tangenjie/Downloads/mvstudiopro-知识库/漫剧工厂/附件-0911动作白模/工厂底座验收-0911/`。
其中 `preview.mp4` 为48帧／34356字节，SHA与临时原件一致；`report.json`逐字节比对一致；另有 `scene.blend`、`request.json`、`evidence.json`、`验收结果.json`。JSON中的 `test-bucket` 是离线上传替身身份，不代表正式云上传；视频与工程本身来自真实Blender运行，不是固定假产物。

生产Linux镜像、线上数据库／GCS、完整正式UI链路、峰值与模型动作跟随仍未验证；PR保留草稿待验，不能称产品已上线。


## 2026-09-11 18:02 · 第一批已推送，后续统一 PR #1444

- 第一批提交：`dd7a18ad2e2f03c8398a7b89b8f297cfbf73117f`，已推送分支 `feat/manhua-action-previs-0911`。
- 唯一交付 PR：[PR #1444](https://github.com/gabrieltan0506-prog/mvstudiopro/pull/1444)，真实查询为 OPEN／DRAFT，未合并、未部署。此前“无 PR／未提交”仅是17:55快照，不能沿用。
- 底座补修：61条同毫秒任务按30/30/1完整分页；严格校验双键游标；管理员／监管可用，普通用户零服务调用。新增路由与任务测试8项通过。
- 最终本地渲染与配置专项13项通过：48帧、34356字节、16骨，SHA仍为 `0b1e11bc4a93cb45645611debaef409bfd357b9d68508a5fcdfb8f9edaaefc6f`；本轮最终产物保留于 `/private/tmp/previs-server-audit-final-0911/`。
- 防截断：动作说明不再按4000字符静默裁尾；机位至少占一帧，Python与提交schema统一半帧舍入。无新增模型调用。
- 第二批当前段UI／草稿／消费已通过整合回归：10文件191项；扩充的消费与邻接3文件48项全部通过，三种视频引擎均实际出站非空视频和动作说明。显式图生／文生模式**既有最终校验已经关闭式拒绝、零提交**，此前疑似“会静默发错单”已实测纠正，未为该推测改业务。
- 非增量 `pnpm exec tsc --noEmit --incremental false` 退出0；Vite生产构建退出0（3580模块、36.35秒，有现存大包／混合导入警告）。额外 `pnpm check` 与全仓回归仍在结束中，不能把未结束写成通过。
- 全仓发现的三组18项失败，已在施工前 `edeb254d9610728212d741b62ed8864b87e03ab4` 隔离全源码复现：WriterTimedGate 3失败/17过，AssetEditSubmit 14失败/6过，AssembleAccess 1失败/17过。失败为测试执行上下文缺少源码现有依赖（activeDirectionCanon、buildManhuaDirectionCanonFromSelection、readOpenAiImageVariantPref、isKnowledgeCardCancelledJobError），不是白模增量或原素材丢失。未改这些原测试或业务；隔离基线保留在 `/private/tmp/previs-writer-gate-before.84QNHx`。全仓最终总数尚未回执，仍不能称全仓绿。

### 改动文件与跨层证据

第一批16文件：`Dockerfile`；`shared/manhuaPrevis.ts`、对应test、`shared/manhuaSegmentReference.ts`；`server/routers.ts`、`server/routers/manhuaPrevis.ts`及test；`server/jobs/postProdInput.ts`、`postProdJob.ts`；`server/services/postProdMediaSource.ts`、`manhuaPrevisTask.ts`及test、`manhuaPrevisRender.ts`及单测/真实渲染integration test；`server/scripts/render-manhua-previs.py`。

第二批10文件（本条记录时本地已实现）：`client/src/components/ManhuaScriptWorkbench.tsx`、`canvas/ManhuaPrevisStudio.tsx`；`client/src/pages/OmniCanvas.tsx`；`client/src/lib/canvasTypes.ts`、`canvasDramaStudio.ts`、`canvasRunBlock.ts`、`manhuaCloudDraftSync.ts`、`manhuaPrevisChain.test.ts`、`manhuaPrevisStudio.browser.test.ts`；`shared/manhuaCloudDraft.ts`。文档另写仓库PROGRESS、line-canvas、本验收文以及外部知识库/指定交接文件。

| 分层门 | 状态／证据 |
| --- | --- |
| 需求与边界 | 已验证：本地小样升级为工厂能力；三批同PR，仅推送开PR、不合并部署，不新增付费 |
| 入口与交互 | 部分完成：真实离线React10项；正式工厂页面尚未上线验证 |
| 数据生产 | 已验证（本机）：固定脚本真实16骨、48帧、可解码MP4，不用mock替代渲染 |
| 契约与转换 | 已验证（离线）：完整提交schema、可编辑草稿、同scope/requestId、无动作尾部截断与非支持路径拒绝 |
| 服务与副作用 | 部分完成：幂等/权限/分页/超时和失败存证通过，真实DB竞争/GCS未验；不改普通用户计费 |
| 存储与恢复 | 部分完成：本机/云序列化、原编号恢复、旧候选/旧参考归档离线通过，真实云与强杀恢复未验 |
| 消费与展示 | 部分完成：三引擎实际执行器的离线出站有视频与秒位，线上供应商跟随质量未验 |
| 静态与回归 | 部分验证：非增量类型、Vite、目标回归通过；全仓基线失败已复现，最终总数待回执 |
| 真实链路 | 未做线上实跑：没有正式工厂→Fly→GCS→采用→付费成片／真实账本验收 |

后续先追加第二批提交，再把全仓最终回执与剩余Linux／线上断点写入第三批文档。此处分层“部分完成”不能改写为“工厂已上线可用”。


## 2026-09-11 17:55 · 工厂接入续工快照（部分验证，尚未发布）

此前“工厂接线未实现／不在范围”的结论仅描述 v3 本地小样阶段，已被用户后续“就是要接进工厂”“没有 Blender 就安装”“改好后推送开 PR”“分几次做”的要求更新。当前目标是可编辑、可恢复的工厂能力，不是上传固定样片。用户本轮授权验证后 commit、push、建立一张统一 PR；不合并、不部署、不新增付费模型调用。

### 分三批，同一张 PR

| 批次 | 范围 | 当前状态 |
| --- | --- | --- |
| 1 渲染底座 | 受控配置、权限、同号幂等队列、固定 Blender 脚本、MP4、失败存证 | 已实现，真实本地渲染及专项通过；生产部署未验 |
| 2 工厂接入 | 当前段角色／动作／机位编辑、候选预览、明确采用、旧参考恢复、刷新／切段保护 | 已实现，10 项真实离线浏览器测试通过；正式 UI 未验 |
| 3 消费与总验收 | 两视频引擎与 Mini 消费、容量／模式限制、草稿与归档、类型／构建／完整回归 | 部分验证；正在修模式边界并统一复验 |

每批验后提交、推送，同性质修正追加同一 PR，不按小补丁反复开张。当前分支 `feat/manhua-action-previs-0911`，代码目录 `/private/tmp/growth-release-fix-0911.o7K6II/repo`。17:55 核查：HEAD `edeb254d`，改动尚未提交；指定旧 PR #1412 已合并，当前分支无 PR、仓库无开放 PR。本条不是推送／发布回执，后续必须以 GitHub 实际记录更新。

### 真实数据链与修正

- 工厂当前段入口 → `manhuaPrevis.submit` 管理／监管权限 → 用户+requestId 确定性任务 ID → 既有单并发 `post_prod` 队列。普通后期入队接口拒绝该 action，不能旁路管理权限。
- 固定脚本先准备可保存的场景与报告；服务先永久归档原始报告、字节数和 SHA，再验结构／关节指标、保存 scene，之后才启动长时帧渲染。失败、Abort、坏 JSON 与门禁拒绝均有保全测试；不执行用户 Python，不自动重排渲染。
- MP4 计帧、时长、非空验证后成为候选。用户明确“采用为本段参考”才写 `manhuaSegmentRefs.previs` 与动作秒位说明，不自动触发成片，原参考保留可恢复。
- 入队前须确认本机保存成功；失败不提交。历史预览直接使用保存的 requestId，不从 jobId 或对象路径反推；StrictMode、首次保存重挂、迟到响应与跨 scope 均有离线测试。
- 编辑中空名称、零值或未闭合时间轴允许保存草稿，但提交完整 schema 仍拒绝；避免输入框清空一步导致规范化／云备份失败。
- 生成白模超当前视频参考上限、不支持视频参考的生成档，改为明确拒绝而不静默丢参考。显式图生／文生模式清空参考的旁路正在补回归。旧上传、局部编辑／延长／试片按既有语义核对，不能一并误改。
- 新段不克隆旧白模；改稿、换档、整集替换和清链保留旧工作／候选／原请求。无白模旧稿不生成空工作室、不增加动作提示或预算。

### 已执行验证及原始结果

- 服务专项含本机 Blender：8 文件、59 项通过。真实 2 秒、24 fps、48 帧、960×540、34356 字节、16 骨；接触误差 `7.450580596923828e-8`、支撑漂移 `2.79967400849699e-7`，报告无出画。
- 两阶段视频 SHA256：`0b1e11bc4a93cb45645611debaef409bfd357b9d68508a5fcdfb8f9edaaefc6f`，与修改前同配置视频一致。产物／回执：`/private/tmp/previs-server-audit-two-stage-0911/`。这是本机上传替身保存的验收目录，不是生产 GCS 已上传。
- `pnpm exec vitest run client/src/lib/manhuaPrevisStudio.browser.test.ts`：最终 10 项通过，18.53 秒；首次并发默认 5 秒曾超时，已改合理 20 秒测试时限，未削减断言。
- 消费／草稿专项及相邻段参考／试片测试：最近一轮 3 文件、46 项通过；其中新增链路 16 项。真实执行器出站断言保留现签视频、“白模角色1对应阿菁”“2—6秒抬臂保护”，网络仅测试替身。
- 首次 `pnpm check` 报 TS2802（Array/Map/NodeList 迭代）；已逐处处理／通知对应修正，最终无增量类型检查仍需确认。不能把专项绿写成全仓类型与构建已绿。
- 已做局部格式检查和 `git diff --check`；完整 diff、最终构建与全仓回归尚未收口。

### v4 本地精修补记

另有独立 v4 工程与 `回读验收.json`，目录为工作区 `outputs/墨菁传-动作白模-v4-0911/`。本次读取回执：阿菁／家丁各16骨，支撑世界漂移分别 `2.8115454709698567e-7`／`2.980232238769531e-7`；攻击174帧、防御187帧归零；第五镜96帧头脚端点在画内并留2%边界。该回执明确不包含网格碰撞／面部表演，马腿沿v3、未做动物脚锁。本次文件检查未发现 v4 根目录 MP4，不把工程与帧存在写成 v4 视频已交付；v3 工程／视频保持原样。

### 未验证与下次准确断点

尚未做 Docker/Linux 干净镜像构建、真实 DB 并发／GCS、正式前台点击→队列→采用→生成、生产重启恢复、6角色30秒峰值及付费成片动作跟随。当前本机未找到 Docker/Podman 命令；不能宣称生产镜像可运行。普通用户计费未新增，管理路径不调用付费模型不等于服务器资源免费。无新付费、无合并／部署、无重做已有模型任务。

接手先核对当前 git/PR 与已保存产物；继续完成第三批门禁，再按用户授权分批推送与开同一 PR。失败恢复只能查询原编号，不为恢复重复提交付费任务；生产凭证始终留 Fly。

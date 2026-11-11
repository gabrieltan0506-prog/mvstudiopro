# 可灵停用 · 方案 A 盘点清单（1111）

开关真源：`shared/klingRetired.ts`（服务端缺省停用，`KLING_RETIRED=0|false|off` 紧急恢复，其余值一律按停用；前端常量 `KLING_RETIRED_CLIENT = true`）。
服务端守卫：`server/kling/retired.ts`（HTTP 410 + `kling_retired`；tRPC 无 410 码，用 `PRECONDITION_FAILED`(412) + `KLING_RETIRED_MESSAGE_ZH`）。
盘点命令：`grep -rli kling server client/src shared api`（非测试 46 个文件，另新增 `server/kling/retired.ts`）。

类别：新建入口 / 轮询收尾 / 前端入口 / 售卖 / 自动路由 / 仅历史展示 / 配置·类型 / 死代码 / 误命中。

| 文件 | 类别 | 处理方式 | 已改 |
|---|---|---|---|
| shared/klingRetired.ts | 开关 | 统一开关（本分支既有），不改 | — |
| server/kling/retired.ts（新增） | 新建入口 | 守卫、入口清单（action/op/通道名）、通道链过滤 | 是 |
| server/kling/omni-video.ts | 新建入口 / 轮询收尾 | `createOmniVideoTask` 停用即抛 kling_retired（底层兜底，零上游）；`get*/list*` 不拦 | 是 |
| server/kling/motion-control.ts | 新建入口 / 轮询收尾 | `createMotionControlTask` 兜底；查询不拦 | 是 |
| server/kling/lip-sync.ts | 新建入口 / 轮询收尾 | `identifyFaces`、`createLipSyncTask` 兜底；查询不拦 | 是 |
| server/kling/elements.ts | 新建入口 | `createImageElement`、`createVideoElement` 兜底；get/list/delete 不拦 | 是 |
| server/kling/image-generation.ts | 新建入口 / 轮询收尾 | `createImageTask` 兜底；`getImageTask` 不拦 | 是 |
| server/kling/fal-proxy.ts | 新建入口 / 轮询收尾 | `falKlingSubmit`、`falKlingQueue` 兜底；status/result 不拦 | 是 |
| server/kling/client.ts / index.ts / types.ts | 配置·类型 | 客户端、导出、类型，不改（代码暂留） | 否 |
| server/routers/kling.ts | 新建入口 / 轮询收尾 | 11 个新建 mutation 改走 `klingCreateProcedure`（扣费、建任务、上游之前拒绝）；getTask/listTasks/getFaceResult/elements 查询删除/status/estimateCost 放行 | 是 |
| server/_core/index.ts | 新建入口 | POST /api/jobs：6 个可灵 action 先于鉴权 410、不入队；`/api/kling-image` 挂载不变（由 handler 自拦）；video 类任务的 provider 标签 `kling-cn` 只是落库标签，不改 | 是 |
| server/jobs/runner.ts | 新建入口 / 轮询收尾 | 停用前已入队、尚未执行的可灵单直接失败（不建上游任务；这些 action 无服务端计费，无需退款），不重排；`virtual_idol` 的 provider 标签不改 | 是 |
| api/jobs.ts | 新建入口 / 轮询收尾 | op `klingCreate/klingT2V/klingI2V/workflowGenerateVideo` 先于鉴权 410；`klingTask` 轮询保留 | 是 |
| api/kling-image.ts | 新建入口 / 轮询收尾 | POST 与 `op=probe` 先于鉴权 410；GET 轮询保留（仍须监管） | 是 |
| api/openai-image.ts | 误命中 | 注释提到 /api/kling-image，不改 | 否 |
| shared/internalMediaEndpointPolicy.ts | 新建入口（鉴权档位） | 停用闸位于其之前；`KLING_RETIRED=0` 时原鉴权档位照旧生效，不改 | 否 |
| server/routers.ts | 自动路由 | `video.generate` 的通道链来自 `getTierProviderChain`，停用后已不含可灵；`generateKlingBeijingVideo` 与 fal 分支另有底层兜底。大文件不改 | 否 |
| server/services/tier-provider-routing.ts | 自动路由 | `getTierProviderChain` 停用时剔除 `kling_beijing/fal_kling_video`，其余原序保留 | 是 |
| server/services/provider-manager.ts | 配置·类型 | 通道名类型，不改 | 否 |
| server/services/provider-diagnostics.ts | 配置·类型 | 监管诊断，只读 env 不打上游，不改 | 否 |
| server/vercel-api-core/workflow.ts | 自动路由 | 旧工作流唯一视频通道是可灵：停用时不再自调，直接记中文失败原因 | 是 |
| server/routers/workflow.ts | 自动路由（旧工作流） | 停用时不许再打开动作控制/口型同步/角色元素；模板新建的工作流不再继承可灵开关；已有行不改 | 是 |
| server/workflow/steps/videoStep.ts | 自动路由（已退役） | 已退役步骤，报错文案去掉通道名 | 是 |
| server/router/router.ts | 死代码 | 无调用方；video 默认 kling。不改，待拍板删除 | 否 |
| server/router/modelRouter.ts | 死代码 | 只被已退役的 videoStep 引用（抛错在用到路由之前）。不改，待拍板删除 | 否 |
| server/prompts/promptLibrarySchema.ts | 死代码 | 无引用的示例 `recommendedModel: "kling"`，不改 | 否 |
| server/config/env.ts / server/config/klingCn.ts / server/vercel-api-core/env.ts | 配置·类型 | 密钥读取与缺失提示，不改 | 否 |
| server/plans.ts | 售卖 | `CREDIT_FEATURE_BREAKDOWN` 停用时不列可灵 7 行；`CREDIT_COSTS.kling*` 计价键保留 | 是 |
| shared/plans.ts / shared/credits.ts | 售卖（计价键） | 计价键与历史账目不删；`IMAGE_UPSCALE_BASE_CREDIT_KEYS` 里的可灵键保留（历史可灵图放大仍要基准价） | 否 |
| server/routers/customerService.ts | 售卖 | 客服提示词去掉可灵工作室与「Kling 视频 80」报价，改为「旧版专业视频工作室已下线」中性口径 | 是 |
| client/src/components/HomePlans.tsx | 售卖（死代码） | 组件无引用；仍删掉「Kling 2.6 生成」卖点 | 是 |
| client/src/pages/TestLab.tsx | 前端入口（监管） | 停用常量下隐藏可灵生图/视频选项 | 待改 |
| client/src/pages/WorkspaceStudio.tsx | 前端入口 / 旧工作流 | 停用常量下隐藏「工作室控制」；旧工作流开过这些开关时给中文提示、不改数据 | 待改 |
| client/src/pages/Showcase.tsx | 前端入口（营销位） | 去掉恒为空的「影视级视频」筛选页签；风格画廊图片保留（标签中性、无创建入口） | 待改 |
| client/src/lib/aiStudioRegistry.ts | 前端入口（死代码） | 无引用；按族/分组列模型时停用常量下过滤可灵项，`getModelById` 保留 | 待改 |
| client/src/pages/RemixStudio.tsx | 死代码 | #1772 已拿掉路由，无入口，不改 | 否 |
| client/src/pages/Redeem.tsx | 死代码 | 未挂路由；「视频生成」文案中性，不改 | 否 |
| client/src/components/CreationManager.tsx | 仅历史展示 | 可灵作品类型的展示/播放/下载照常，不改 | 否 |
| client/src/components/HomeMyWorks.tsx | 仅历史展示 | 同上，不改 | 否 |
| client/src/pages/MyWorks.tsx | 仅历史展示 | 同上（含「视频」筛选），不改 | 否 |
| server/routers/creations.ts | 仅历史展示 | 作品类型枚举保留，不改 | 否 |
| shared/graphicNoteFusionTemplates.ts / shared/songCraftNative.ts | 误命中 | `sparkling` 命中，不改 | 否 |

路由残留核对：`client/src` 内无指向 `/kling-studio`、`/remix`（旧可灵工作室）的链接；`/creator-growth-camp/premium-remix` 是成长营二创页，与可灵无关。

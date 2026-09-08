# 图文笔记统一4K与成本核对

## 改前证据与范围

| 层 | 当前证据与计划 |
|---|---|
| 最终结果 | 用户要求知识卡不随页数降档，全部4K；页费数值保持不变；用户随后要求新提炼仅保留精细和轻量。 |
| 基线 | Fly运行镜像sha-24123bb；本目录从相同提交独立检出，避免触碰其他任务改动。 |
| 入口 | PlatformPage.handleGenerateCustomNote、优化稿出图、generateCustomNoteOne，上传/粘贴均归入single_page_knowledge_card。 |
| 生产 | knowledgeCardDistill抽文/OCR、分段提炼与统稿；planKnowledgeCardPages纯函数分页。 |
| 契约 | 路由逐页接收notePageIndex/notePageTotal，proxyImageService按kind识别知识卡；目前只传quality，未显式传4K尺寸。 |
| 通道 | 通用网关auto顺序由gptImage2ProviderPricing决定：EvoLink→OpenAI；OpenRouter默认关闭。旧日志与注释不代表实际路由。 |
| 费用恢复 | 路由根据提炼receipt计价，paidJobLedger登记/失败退款；管理员免平台积分但上游仍付费。 |
| 存储消费 | 上游图落GCS/Fly存储，API/job返回imageUrl；页面逐张累积到customNoteImages，PDF消费图片。 |
| 修改范围 | 知识卡质量/实际尺寸参数及UI提示、对应回归；共享网关仅新增可选尺寸参数，其他调用省略时原行为不变。 |
| 禁止范围 | 仅按用户明确要求移除超凡/均衡新提炼入口；不改生图路由选择、积分/人民币售价、数据库schema、旧图片、失败重试次数；不提交付费任务，不commit/push/PR/部署。 |
| 验证 | 分页计价/长文提炼提示测试、供应商请求参数测试、共享网关知识卡与其他调用回归、类型检查、构建。 |
| 已知断点 | 未获得完整单单usage成本账；尚未线上4K实跑，真实像素和质量待验收。 |

## 费用口径

平台积分是收费，不是供应商成本。精细档4页120积分；轻量96；历史均衡108、超凡144仅用于旧账核对，新入口移除。前8页满价，第9页开始原有折扣；上传文档提炼含页费，长纯文本主动提炼有独立费。上游费用由提炼/OCR调用、逐页生图、重生成和存储组成。管理员免积分不免上游费用。

## 追加范围：提炼只留精细与轻量

- 用户明确移除超凡Claude Opus5及均衡Kimi，仅保留Sol/Qwen。
- 前端选项/本地存储归一、新提炼API枚举/默认值、prepare服务及后台job调用同时检查；不得只隐藏下拉框。
- 历史receipt的模型身份与原积分费率保留，已生成稿件和旧图不改；新提炼通过active resolver限制模型。
- 现有图文后端页数校验上限80，整份出图文案上限50000字符；不修改这些上限。


## 追加范围：原始材料分框与EPUB转换

用户明确：原始材料超过50,000字符时先分为两个或更多输入框，各框独立提炼和出图；EPUB转PDF工具放在图文笔记下方。

| 证据门 | 修改前链路与本批约束 |
|---|---|
| 入口 | 原文粘贴、优化稿出图入口、文档上传和新增EPUB正文导入；超过上限先分框，不把整书先交模型。 |
| 生产 | 文档用既有抽文服务，新增MD/TXT直接读文本；EPUB用既有JSZip与浏览器DOM解析按spine读取；无新增依赖。 |
| 转换 | 每份保留原材料，最多50,000 UTF-16字符且不切断代理对；提炼稿保留可编辑，超限拒绝出图。 |
| 持久化 | 按用户/材料/框身份保存原稿、提炼稿、模型、待核对任务及已完成图片；历史素材可恢复，保存失败禁止提交。 |
| 消费 | 各框完整提炼稿+页码传原出图API，累计图片继续供展示与导出消费；已完成页不重复提交。 |
| 副作用 | 用户逐份确认，文档提炼不另收费；纯文本主动提炼沿用原费率；未知任务不自动重发，已知ID仅查询。 |
| EPUB | 未加密EPUB本机解析与安全清理，经既有PDF转换服务导出；不调用提炼或生图；线上转换服务尚未验收。 |
| 测试 | 原文无损分框/保存恢复/超限、路由模型限制/GCS账号隔离/失败抽文、浏览器EPUB顺序/图片/安全与坏包，最终类型/构建。 |

已知限制：分框素材保存在当前浏览器，不能跨设备自动恢复；无任务编号的提炼请求如果断线需人工对账，系统禁止自动重复付费。未做线上付费实跑；真实4K像素、正式页面、生产PDF转换仍待验证。


## 本地验收结果与状态审计

状态：部分验证。尚未上线，未做付费生产、真实4K像素质量与生产PDF服务验收。

| 层 | 状态 | 实际证据 |
|---|---|---|
| 需求与边界 | 已验证 | 仅知识卡4K、新提炼两档、原始材料分框及EPUB工具；不调整既有页费。 |
| 入口与交互 | 部分完成 | 原文/上传/EPUB/优化稿入口已接；5项离线Chromium组件实跑通过；正式页面未点击。 |
| 数据生产 | 部分完成 | 14项提炼规则与原文抽取测试、7项真实浏览器EPUB解析测试；实际模型本轮未调用。 |
| 契约与转换 | 已验证 | 新模型路由限制、每框50000、超限稿拒出图、保存schema与分页变化保护均有断言。 |
| 服务与副作用 | 部分完成 | 12项实际路由caller测试含本人GCS/跨账号拒读/坏抽文；10项4K网关参数测试；扣费退款沿原机制，未实扣。 |
| 存储与恢复 | 部分完成 | 浏览器验证原job仅查询、已完成页跳过、坏存储/空间不足禁止提交；父页面历史素材切换尚未DOM实跑。 |
| 消费与展示 | 部分完成 | 浏览器验证恢复图片和剩余页结果展示、EPUB正文与图片解码非空；最终真实成品质量未验收。 |
| 静态与回归 | 已验证 | 下述204项独立测试通过；最终全量无增量类型及Vite构建均退出0。 |
| 真实链路 | 部分完成 | 未提交付费任务、未commit/push/PR/部署；不把本地测试当上线。 |

### 已执行命令及原始结果

- `pnpm exec vitest run server/routers.knowledgeCardModels.test.ts`：`Test Files 1 passed (1); Tests 12 passed (12)`，日志 `/tmp/knowledge-card-router-final-tests.log`。首次新增GCS mock缺少其他路由静态导出导致suite收集失败，已改为部分mock后复跑通过。
- 首轮整合中的其他7文件：`Tests 84 passed (84)`，包括当时21项分框测试；日志 `/tmp/knowledge-card-final-integrated-tests.log`。
- 最终分框/浏览器/共享网关/画布回归5文件：`Test Files 5 passed (5); Tests 129 passed (129)`，日志 `/tmp/knowledge-card-final-regression.log`。其中更新后的分框22项替代前述21项，合计204项独立测试通过。
- `pnpm check --incremental false` 前轮退出0，日志 `/tmp/knowledge-card-integrated-typecheck.log`。
- `pnpm exec vite build` 前轮退出0，`built in 49.43s`，存在既有大chunk告警；日志 `/tmp/knowledge-card-integrated-build.log`。
- `git diff --check` 退出0；完整diff与关键调用已逐项检查。项目未提供独立lint命令。

### 实际修改文件

- `client/src/pages/PlatformPage.tsx`：入口、原始抽文、分框/历史/EPUB接线及任务恢复。
- `client/src/components/platform/KnowledgeCardMaterialBatches.tsx`、`client/src/lib/knowledgeCardMaterialBatches.ts`：材料分框、独立操作、付费前保存、状态核对。
- `client/src/components/platform/EpubToPdfPanel.tsx`、`client/src/lib/epubToPdf.ts`：本机解析、导入、转换下载。
- `server/routers.ts`：新提炼仅两档、原文抽取GCS本人校验及读取失败拒绝。
- `server/services/knowledgeCardDistill.ts`：仅保留两模型调用、MD/TXT文本读取。
- `server/services/proxyImageService.ts`、`shared/knowledgeCardPagination.ts`：各页与回退显式4K，保留费用。
- `shared/knowledgeCardDistillModels.ts`：新入口与历史回执分离。
- 对应新增/修改测试：`server/routers.knowledgeCardModels.test.ts`、`server/services/knowledgeCard{Distill,DistillActive,4kRouting}.test.ts`、`shared/knowledgeCard{Pagination,DistillTradeoff}.test.ts`、`client/src/lib/knowledgeCardMaterialBatches{,.browser}.test.ts`、`client/src/lib/epubToPdf.browser.test.ts`。

残余风险：浏览器存储配额会限制整书大小，失败时停止提交并保留当前材料；提炼请求未返回ID而断线时须对账，不能自动恢复重发；原有PDF转换入口是publicProcedure，本批复用且未改鉴权，生产入口改造需独立明确范围。无新增依赖、数据库schema或生产凭证本地化。

最终代码收口后再跑：`pnpm check --incremental false` 退出0（`/tmp/knowledge-card-complete-typecheck.log`）；`pnpm exec vite build` 退出0，`built in 26.92s`（`/tmp/knowledge-card-complete-build.log`）；`git diff --check` 退出0。正式线上与付费产物验收仍未执行。

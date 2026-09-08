# 知识卡全稿图文阅读与方案生成验收记录

状态：部分验证。尚未执行线上付费模型阅读、成品图质量及真实账单验收；用户明确将在发布后亲自重跑。禁止以本地测试代替线上效果。

## 本轮边界与结果

用户确认全稿图文精读后由模型规划精简、均衡、完整版本，精简优先；完整内容四页足够时仅给完整四页方案，不制造三个版本。最低四页，页数由内容、预算和目标决定。原书有效构图进入独立视觉证据与重绘说明，不再只提取文字。既有 GPT-5.6 Sol / Qwen 档位和页价保持，上传文档不新增提炼费；手输超过3200字保留原50/30积分确认。横版16:9与主体左侧/居中属于本批已有用户授权。

用户已授权独立知识卡PR及验证后推送、合并；每次合并必须紧邻查询学习排队/运行和冲突部署。不得取消任务或调用未授权付费探针。生产凭证仅留Fly。

## 改前证据及跨层检查

| 层 | 真实入口、生产者与消费者 | 实现与验证边界 |
| --- | --- | --- |
| 需求边界 | PlatformPage：文件、手输、优化正文、素材、旧稿入口 | 新阅读统一流程；旧材料保留查看/下载与原任务查询，不再开旧式两页生成 |
| 交互 | KnowledgeCardReadingPlans + ReadingSession | 预算/目标、方案确认、精简默认、四页单方案、恢复与当前版次导出；浏览器组件及实际父控制器测试 |
| 生产 | DocumentPages → Reading → Gateway | PDF全部物理页1920宽渲染；图片真实解码；TXT按12000字符逻辑段完整连接，UTF-16代理对不拆；4单元每批图文阅读 |
| 契约 | shared/knowledgeCardReadingPlan → ReadingEdition | 精读身份/数量/空白物理依据校验；完整方案逐页引用或逐页说明排除；冻结页面不再本地切字分页 |
| 服务副作用 | protected reading router → 专用单并发worker → 原模型通道 | 用户原件版本锁定、6小时任务上限、30秒心跳；独立领取不占旧主队列名额；未知模型请求不自动重买 |
| 存储恢复 | GCS raw/parsed/analysis/plan/edition/render + jobs/paid ledger | 原始响应解析前永久保存、只创建不覆盖、SHA校验；成功页复用，同一身份恢复；只有明确未收费/已退款失败可新attempt |
| 消费展示 | generatePlatformCompositeSheet → proxyImageService → frozen page prompt | 服务端冻结正文、序号、模型、价费覆盖客户端声明；原页图片独立进入参考数组，不当人脸替换参考；4K统一路由 |
| 静态回归 | 目标vitest、全仓类型、Vite构建、完整diff和代理复审 | 以最终命令实际输出为准，见下方验证记录 |
| 真实链路 | 用户PDF本地物理页解析/渲染；线上模型待用户重跑 | 原PDF实际276页全部渲染解码：74,052,269 PNG字节；全书视觉理解与最终售卖成品质量尚未线上验收 |

## 双向追链

正向：用户原件 → uploads/u{userId}版本 → 全页/全文清单 → 每批原始响应及精读证据 → 全量证据方案 → 方案确认 → 冻结版次 → 固定页面身份及扣费 → 生图原页参考与重绘正文 → GCS结果/jobs → 当前版次图与导出。

反向：当前展示页 → editionId/pageId/attempt/风格/位置 → render result及账本 → 冻结正文与sourcePageIds → 方案及排除理由 → 精读原始/解析JSON → 锁定版本的真实原件。另一入口统一进入此链；旧素材与历史成品保留，不混入当前版次导出。

## 失败与费用

- 扣费前原子claim，同身份请求只查询原任务；费用元数据写失败按既有幂等账单恢复原金额，不要求再次具备余额。
- 仅明确业务失败且未收费/已退款的failure回执允许重试；jobs通用超时failed本身不足以证明可重生。
- 图片已返回时，成品、jobs或结算写入失败只补存储/结算；ledger先查真实成功证据，缺证据保持对账，不因部署或超时自动退款。
- 全部成品回执持续无法落盘且进程退出时，必须人工/供应商对账，不能自动再买。此边界未假称自动恢复已完成。
- 原请求claim存在却无响应、响应截断、模型不匹配、覆盖不足、缓存损坏均明确停止并保留证据，不换模型补位或假装成功。

## 已知容量和未验证项

单文件200MB、文字64MB、临时渲染图片1GB、单次规划证据500000字符、单方案80页、每成品最多16张模型明确选择的原页参考；超限明确失败，不静默裁尾。这些是本次实现容量，不代表所有长书都能规划。Office/EPUB需先转PDF以保留视觉；EPUB浏览器转换保留本地路径并有相关测试。

新文本校对服务尚未接入正式模型调用，页面的规则检查不能称事实审校。线上付费图文精读、最终4K实际像素与内容正确性、线上重试退款和全书实跑尚未执行。本批不新增依赖，不修改其他视频/学习冻结合同。

## 最终验证记录

已同步主分支 `f27e65f`（PR #1419），手工解决一处staleJobsReaper名单冲突，同时保留对白任务与本次阅读任务保护。其余上游改动保持。

- `pnpm check --incremental false`：退出0，无类型错误。日志 `/tmp/knowledge-final-main-typecheck.log`。
- `pnpm exec vite build`：退出0，`built in 1m 9s`；保留既有大chunk警告。日志 `/tmp/knowledge-final-main-build.log`。
- 最终目标与跨层回归：`Test Files 55 passed (55)`、`Tests 613 passed (613)`、`Duration 39.66s`，退出0。日志 `/tmp/knowledge-final-main-tests-rerun.log`。
- 首次合并后同批运行曾611通过/2失败：一项结算mock仍返回undefined而非真实`{ok:true}`，改正夹具；一项浏览器测试5000ms超时。构建结束后以4worker重跑全部55文件，未跳过任何失败项。
- `git diff --cached --check`：退出0。三个子代理分别检查生产/计费、消费/界面与完整恢复，最后前端attempt提前递增P2已修正并复审关闭。
- 本机PDF真实读取原始输出：276页全部渲染且sharp解码，总PNG 74,052,269字节；未调用付费模型。日志 `/tmp/knowledge-document-pages-276-verification.log`。

完整测试命令：

```sh
pnpm exec vitest run --maxWorkers=4 --minWorkers=1 client/src/lib/canvasAudioStudioRecovery.test.ts client/src/lib/canvasDramaStudio.seriesSwitch.test.ts client/src/lib/canvasDramaStudio.test.ts client/src/lib/canvasDramaStudio.videoEditOnly.test.ts client/src/lib/epubToPdf.browser.test.ts client/src/lib/knowledgeCardDocumentOrigin.parent.test.ts client/src/lib/knowledgeCardMaterialBatches.browser.test.ts client/src/lib/knowledgeCardMaterialBatches.test.ts client/src/lib/knowledgeCardReadingController.test.ts client/src/lib/knowledgeCardReadingPlans.browser.test.ts client/src/lib/knowledgeCardReadingSession.test.ts client/src/lib/knowledgeCardTextReviewPanel.browser.test.ts server/credits.readChargeByKey.test.ts server/jobs/knowledgeCardReadingPool.test.ts server/jobs/runner.knowledgeCardEdition.test.ts server/jobs/runner.knowledgeCardPool.test.ts server/jobs/runner.knowledgeCardReading.test.ts server/jobs/runner.knowledgeCardRetiredModel.test.ts server/jobs/staleJobsReaper.test.ts server/routers.knowledgeCardModels.test.ts server/routers.knowledgeCardReadingRender.test.ts server/routers/canvasAudio.test.ts server/routers/knowledgeCardReading.test.ts server/services/canvasDialogueCharge.test.ts server/services/canvasDialogueOperation.test.ts server/services/evolinkGptImage2.pro.test.ts server/services/evolinkGptImage2.test.ts server/services/knowledgeCard4kRouting.test.ts server/services/knowledgeCardDistill.test.ts server/services/knowledgeCardDistillActive.test.ts server/services/knowledgeCardDocumentPages.test.ts server/services/knowledgeCardFrozenPrompt.test.ts server/services/knowledgeCardFrozenRouting.test.ts server/services/knowledgeCardLayoutDirective.test.ts server/services/knowledgeCardReading.test.ts server/services/knowledgeCardReadingEdition.test.ts server/services/knowledgeCardReadingFee.test.ts server/services/knowledgeCardReadingGateway.test.ts server/services/knowledgeCardReadingRender.test.ts server/services/knowledgeCardReadingResume.test.ts server/services/knowledgeCardReadingSettlement.test.ts server/services/knowledgeCardReadingStore.test.ts server/services/knowledgeCardTextReview.test.ts server/services/openaiGptImage2.test.ts server/services/openrouterGptImage2.test.ts server/services/paidJobLedger.reaper.test.ts server/services/paidJobLedger.refundPending.test.ts shared/canvasAudioStudio.test.ts shared/gptImage2ProviderPricing.test.ts shared/knowledgeCardDistillTradeoff.test.ts shared/knowledgeCardPagination.test.ts shared/knowledgeCardReadingPlan.test.ts shared/knowledgeCardSubjectPosition.test.ts shared/knowledgeCardTextReview.test.ts shared/manhuaSeedanceLayout.test.ts
```


## 实际修改文件

- `.cursor/knowledge/PROGRESS.md`
- `.cursor/knowledge/kb/line-platform.md`
- `client/src/components/platform/EpubToPdfPanel.tsx`
- `client/src/components/platform/KnowledgeCardMaterialBatches.tsx`
- `client/src/components/platform/KnowledgeCardReadingPlans.tsx`
- `client/src/components/platform/KnowledgeCardTextReviewPanel.tsx`
- `client/src/lib/epubToPdf.browser.test.ts`
- `client/src/lib/epubToPdf.ts`
- `client/src/lib/knowledgeCardDocumentOrigin.parent.test.ts`
- `client/src/lib/knowledgeCardMaterialBatches.browser.test.ts`
- `client/src/lib/knowledgeCardMaterialBatches.test.ts`
- `client/src/lib/knowledgeCardMaterialBatches.ts`
- `client/src/lib/knowledgeCardReadingController.test.ts`
- `client/src/lib/knowledgeCardReadingPlans.browser.test.ts`
- `client/src/lib/knowledgeCardReadingSession.test.ts`
- `client/src/lib/knowledgeCardReadingSession.ts`
- `client/src/lib/knowledgeCardTextReviewPanel.browser.test.ts`
- `client/src/pages/PlatformPage.tsx`
- `docs/2026Sep08/knowledge-card-4k-audit.md`
- `docs/2026Sep08/knowledge-card-full-reading-audit.md`
- `docs/2026Sep08/knowledge-card-subject-position-audit.md`
- `docs/2026Sep08/knowledge-card-text-review-audit.md`
- `server/credits.readChargeByKey.test.ts`
- `server/credits.ts`
- `server/jobs/knowledgeCardReadingPool.test.ts`
- `server/jobs/repository.ts`
- `server/jobs/runner.knowledgeCardEdition.test.ts`
- `server/jobs/runner.knowledgeCardPool.test.ts`
- `server/jobs/runner.knowledgeCardReading.test.ts`
- `server/jobs/runner.knowledgeCardRetiredModel.test.ts`
- `server/jobs/runner.ts`
- `server/jobs/staleJobsReaper.test.ts`
- `server/jobs/staleJobsReaper.ts`
- `server/routers.knowledgeCardModels.test.ts`
- `server/routers.knowledgeCardReadingRender.test.ts`
- `server/routers.ts`
- `server/routers/knowledgeCardReading.test.ts`
- `server/routers/knowledgeCardReading.ts`
- `server/services/geminiPlatformCompositeTranslation.ts`
- `server/services/knowledgeCard4kRouting.test.ts`
- `server/services/knowledgeCardDistill.test.ts`
- `server/services/knowledgeCardDistill.ts`
- `server/services/knowledgeCardDistillActive.test.ts`
- `server/services/knowledgeCardDocumentPages.test.ts`
- `server/services/knowledgeCardDocumentPages.ts`
- `server/services/knowledgeCardFrozenPrompt.test.ts`
- `server/services/knowledgeCardFrozenRouting.test.ts`
- `server/services/knowledgeCardReading.test.ts`
- `server/services/knowledgeCardReading.ts`
- `server/services/knowledgeCardReadingEdition.test.ts`
- `server/services/knowledgeCardReadingEdition.ts`
- `server/services/knowledgeCardReadingFee.test.ts`
- `server/services/knowledgeCardReadingFee.ts`
- `server/services/knowledgeCardReadingGateway.test.ts`
- `server/services/knowledgeCardReadingGateway.ts`
- `server/services/knowledgeCardReadingRender.test.ts`
- `server/services/knowledgeCardReadingRender.ts`
- `server/services/knowledgeCardReadingResume.test.ts`
- `server/services/knowledgeCardReadingResume.ts`
- `server/services/knowledgeCardReadingSettlement.test.ts`
- `server/services/knowledgeCardReadingStore.test.ts`
- `server/services/knowledgeCardReadingStore.ts`
- `server/services/knowledgeCardTextReview.test.ts`
- `server/services/knowledgeCardTextReview.ts`
- `server/services/paidJobLedger.reaper.test.ts`
- `server/services/paidJobLedger.ts`
- `server/services/proxyImageService.ts`
- `shared/knowledgeCardDistillModels.ts`
- `shared/knowledgeCardDistillTradeoff.test.ts`
- `shared/knowledgeCardPagination.test.ts`
- `shared/knowledgeCardPagination.ts`
- `shared/knowledgeCardReadingPlan.test.ts`
- `shared/knowledgeCardReadingPlan.ts`
- `shared/knowledgeCardSubjectPosition.test.ts`
- `shared/knowledgeCardSubjectPosition.ts`
- `shared/knowledgeCardTextReview.test.ts`
- `shared/knowledgeCardTextReview.ts`

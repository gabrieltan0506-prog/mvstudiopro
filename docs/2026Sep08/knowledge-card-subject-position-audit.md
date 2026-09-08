# 知识卡主体位置审计（2026-09-08）

状态：已实现并完成本地跨层验证；未做线上付费成图验收，不据此宣称真实供应商居中效果已验收。无提交、推送、部署或付费操作。

## 范围与实际文件

知识卡增加左侧／居中选择，默认左侧，两种均固定横版16:9。没有修改模型、积分价格、退款规则或其它产品的竖版模板。

生产文件：

- `client/src/pages/PlatformPage.tsx`：普通入口、资产及优化稿共同生成函数，位置选择持久化；首次分框种子继承位置。
- `client/src/components/platform/KnowledgeCardMaterialBatches.tsx`：每框选择、显式生成参数、任务与图片记录、位置往返恢复。
- `client/src/lib/knowledgeCardMaterialBatches.ts`：旧记录默认左侧、未知值拒绝、编辑新增框继承位置、generationHistory按稿／模型／位置复用已完成页。
- `shared/knowledgeCardSubjectPosition.ts`：严格位置契约、知识卡横版模板副本转换、最终位置指令。
- `server/routers.ts`：输入枚举，同步及异步调用明确传值。
- `server/jobs/repository.ts`：进度任务输入保存位置。
- `server/services/proxyImageService.ts`：位置传入知识卡生产prompt。
- `server/services/geminiPlatformCompositeTranslation.ts`：主体常量改为中性，最终指令唯一决定左／中；模板方向仅在知识卡消费副本转换。

测试文件：`shared/knowledgeCardSubjectPosition.test.ts`、`client/src/lib/knowledgeCardMaterialBatches.test.ts`、`client/src/lib/knowledgeCardMaterialBatches.browser.test.ts`、`server/services/knowledgeCard4kRouting.test.ts`、`server/routers.knowledgeCardModels.test.ts`。另执行既有`server/services/knowledgeCardLayoutDirective.test.ts`。

## 九层检查

| 层 | 状态 | 证据及边界 |
|---|---|---|
| 需求与边界 | 已验证 | 左／中均横版16:9；不把开关做成横竖切换。 |
| 入口与交互 | 已验证 | 普通、资产、优化稿经过generateCustomNoteOne；分框显式传位置。离线Chromium实际选择居中，4页回调全为center。 |
| 数据生产 | 已验证 | 普通选择值及分框subjectPosition构造真实请求字段；并非空map或提示性占位。 |
| 契约与转换 | 已验证 | API枚举及shared resolver拒绝未知值；省略默认left。画幅方向清理保留内部纵向时间轴语义。 |
| 服务与副作用 | 部分完成 | 同步／异步生产prompt与回退使用同一位置，mock供应商调用已验证；未实跑付费及退款。 |
| 存储与恢复 | 已验证 | seed、pending、generation、images、进度任务input保存位置；新增generationHistory保留左中往返记录；旧存储兼容。数据库写入代码已追查，未在线写库实跑。 |
| 消费与展示 | 部分完成 | 最终prompt与离线DOM结果已验证；实际供应商图片主体位置未线上验收。 |
| 静态与回归 | 已验证／最终整批检查由主代理汇总 | 类型检查、目标测试、构建结果见下；最后审查修正后仅重跑相关测试与check，未无谓重构建。 |
| 真实链路 | 未验证 | 未做线上付费生成、计费／退款实跑，没有部署。 |

## 双向追链

正向：普通下拉或分框下拉 → 页面/分框subjectPosition → generateCustomNoteOne显式入参 → protected API枚举 → 同步或异步generateSheet调用 → proxyImageService → buildSinglePageKnowledgeCardImagePrompt末尾位置约束 → 既有4K横版供应商请求。

反向：最终LEFT third／CENTER指令 → opts.subjectPosition → API input.subjectPosition → 普通选择或冻结的分框参数。分框pending、generation、images记录同一位置。改变位置先保存原generation，再按稿／模型／位置查历史，原左侧页不因生成居中版而被重新列为待购买。

进度任务`platform_composite_sheet_progress`是已有TRPC异步旁路占位；runner既有保护禁止将其重新当作生产任务执行。位置已写入该任务input用于查询审计，没有新建自动重跑机制。

## 命令与实际结果

工作目录：`/tmp/mv-knowledge-card-4k-0908`。

1. `pnpm check`：exit 0。日志`/tmp/card-position-check.log`；收口检查exit 0，日志`/tmp/card-position-check-final.log`。
2. `pnpm exec vite build`：exit 0，`built in 10.83s`。日志`/tmp/card-position-vite.log`。包含大chunk提示，无构建错误。
3. `pnpm exec vitest run server/services/knowledgeCard4kRouting.test.ts server/services/knowledgeCardLayoutDirective.test.ts server/routers.knowledgeCardModels.test.ts client/src/lib/knowledgeCardMaterialBatches.test.ts client/src/lib/knowledgeCardMaterialBatches.browser.test.ts`：exit 0，5文件63项通过。组成12＋6＋16＋23＋6。该次原始结果为工具stdout，未单独重定向文件。
4. `pnpm exec vitest run shared/knowledgeCardSubjectPosition.test.ts`：exit 0，4项通过；日志`/tmp/card-position-shared.log`。因此当时报告67项=上一条63项＋共享4项，不是67个测试文件。
5. 消除旧常量“左侧或某一栏”冲突后，`pnpm exec vitest run server/services/knowledgeCardLayoutDirective.test.ts server/services/knowledgeCard4kRouting.test.ts`：exit 0，2文件18项再次通过。日志`/tmp/card-position-prompts-final.log`。这18项为重跑，不重复计入独立覆盖数。
6. 最后三项审查修正后，`pnpm exec vitest run shared/knowledgeCardSubjectPosition.test.ts client/src/lib/knowledgeCardMaterialBatches.test.ts client/src/lib/knowledgeCardMaterialBatches.browser.test.ts server/services/knowledgeCardLayoutDirective.test.ts server/services/knowledgeCard4kRouting.test.ts`：exit 0，5文件55项通过（5＋25＋7＋6＋12）。日志`/tmp/card-position-revisions-tests.log`。
7. 最后三项修正后的`pnpm check`：exit 0，日志`/tmp/card-position-revisions-check.log`。主代理另做整批终验。
8. `git diff --check`：exit 0。

浏览器测试使用独立无头Chromium、localhost临时服务、合成回调，外部请求全部拦截。实测包括首次3框、编辑新增框、超长稿阻断、原job恢复、居中参数与刷新保存、左中往返不重复购买、存储失败时零生成调用。它们不是线上图片视觉验收。

残余限制：普通旧成品没有历史位置回执时不能据视觉反推；知识卡模板图片实际文字密度及主体位置仍需获授权后实图验收。当前没有需要擅自追加的计费决策。

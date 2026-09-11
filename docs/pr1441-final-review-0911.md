# PR1441 终审与补修证据

## 范围与结论

用户本轮授权：终审 PR1441，若改动小则直接修正并合并。原审查基线为 `2a6e6ee0ef1e71b8439bfe379cdadb4b571703b8`。本次仅修模型路由误判、安全拒绝的跨层吞错和严格读取器兼容性；没有改价格、扣费、供应商模型配置、存储 schema、冻结读片参数或生产凭证。线上功能仍属部分验证：本轮不新增付费实跑，不以离线通过冒充生产质量验收。

合并前必须重新确认无排队/运行学习、生成或冲突部署。具体提交、合并 SHA 与发布结果见本次任务最终回执，本文件不预写成功。

## 改前证据表与修正

| 最终结果 | 真实入口/生产者 | 转换与消费 | 改前断点及补修 |
| --- | --- | --- | --- |
| GLM 主路失败能用同档备用 | PlatformPage → worker → knowledgeCardDistill | 档位 ID → 供应商模型 → 正文与 receipt | 合法 `glm-5.3-flash` 与档位同名，被相等断言误拦；移除误判，真实离线请求断言为 OpenRouter GLM → EvoLink GLM |
| 安全拒绝不跨供应商重发，不交部分稿 | 主提炼/派生/挑页/经济档 fetch | SSE/JSON finish_reason → 类型错误 → 各层 catch | 原来派生/挑页、经济内外层吞拒绝；统一类型终止，统稿也不以输入稿冒充成功 |
| 旧学习链不被新严格模式改变 | bailianChat → 共用读取器 | 旧 finish/usage 收口 | error 帧检查补 strict 条件；四条新链仍显式严格，旧默认行为保留 |
| 已取消不发下一跳 | 派生/挑页 abortSignal | 调用前检查与 catch | 保留超时回退，显式取消终止 |

## 实际补修文件

- `server/services/knowledgeCardDistill.ts`
- `server/services/knowledgeCardLevelDerive.ts`
- `server/services/knowledgeCardPageTriage.ts`
- `server/services/sseChatStream.ts`
- `server/services/platformTopicShortlist.ts`
- `server/services/visualReportLlm.ts`
- `server/services/knowledgeCardStreamIntegrity.test.ts`
- `server/services/knowledgeCardModelRouting.test.ts`（新增）
- `server/services/economyContentSafety.test.ts`（新增）
- `.cursor/knowledge/PROGRESS.md`、`.cursor/knowledge/kb/line-platform.md` 与本报告。

## 双向追链与九层状态

| 层 | 状态 | 证据 |
| --- | --- | --- |
| 需求与边界 | 已验证 | 仅在原 PR 小修；无新依赖、无付费调用、无数据迁移 |
| 入口与交互 | 已验证（离线） | `knowledgeCardDeriveInterlock.browser.test.ts` 5例：锁定、成功换稿/报价、失败保留完整版 |
| 数据生产 | 已验证（离线） | 真实适配器拦截 fetch，断言实际网关、模型、非空正文及外呼次数，未用空 handler 代替生产服务 |
| 契约与转换 | 已验证（离线） | SSE/普通JSON两种格式、content_filter/sensitive、断流及历史默认读取器回归 |
| 服务与副作用 | 部分完成 | 服务内安全拒绝一次外呼；报表 trace 保留；worker 原有整单 requeue/退款时机未改，不能说所有任务层都绝不重跑 |
| 存储与恢复 | 部分完成 | worker 派生仅成功后写 receipt；扩写 onItem 不写拒绝正文；离线页面失败恢复通过，未实跑生产数据库恢复 |
| 消费与展示 | 已验证（离线） | 正文生产→解析→下游输出，同一 typed 错误反向追回真实 finish_reason；不返回半稿、不吞统稿拒绝 |
| 静态与回归 | 已验证（已执行项） | 下列27文件339项、类型/非增量类型与构建通过；完整 diff 与遗留调用点检查通过 |
| 真实链路 | 部分完成 | 发布门禁为真实只读查询；未新增模型/图片付费调用、生产PDF峰值内存或真实扣退验收 |

正向：PlatformPage/服务入口 → worker/adapter → fetch → SSE 或 JSON → 正文/typed error → receipt、onItem 或失败路径。反向：最终正文/错误回执 → 同一 adapter 返回值/错误类型 → finish_reason 与实际调用记录。主提炼分片/统稿、挑页组装 catch、经济扩写外层与报表外层均检查；另按钮、派生失败恢复、旧档位解析保留回归。

退款检查未改业务：`server/jobs/runner.ts` 扩写失败清单按条处理，全灭走原有重排与终态退款；`server/routers.ts` 趋势报表 catch 使用既有扣费凭据退款并记录失败遥测。本轮只证明错误仍到达这些入口，不宣称真实退款成功。

## 执行验证与原始结果

```sh
pnpm exec vitest run server/_core/llm.evolinkPrimary.test.ts server/growth/weixinChannelsMiner.test.ts server/growth/weixinChannelsMinerStore.test.ts server/services/manhuaViralTemplateOptimize.test.ts server/routers/manhuaViralTemplate.test.ts shared/manhuaViralTemplateBank.test.ts server/services/platformTopicShortlist.test.ts server/services/visualReportLlm.test.ts server/services/visualReportDeepSeek.test.ts shared/platformTopicExpandEngine.test.ts server/services/knowledgeCardDistill.test.ts server/services/knowledgeCardDistillGateway.test.ts server/services/knowledgeCardGatewayOrder.test.ts server/services/knowledgeCardLevelDerive.test.ts server/services/knowledgeCardPageTriage.test.ts server/services/knowledgeCardDistillAllFailed.test.ts shared/knowledgeCardDistillTradeoff.test.ts server/services/knowledgeCardDeriveParams.test.ts server/services/knowledgeCardPdfExport.test.ts server/services/knowledgeCardPdfExportFailure.test.ts server/services/bailianChat.test.ts shared/knowledgeCardPagination.test.ts client/src/lib/knowledgeCardDeriveInterlock.browser.test.ts server/services/knowledgeCardStreamIntegrity.test.ts server/services/knowledgeCardModelRouting.test.ts server/services/economyContentSafety.test.ts server/services/manhuaViralTemplateRevisionStore.test.ts
# Test Files 27 passed (27)
# Tests 339 passed (339)
# Duration 33.74s; exit_code=0

pnpm check
# tsc --noEmit; exit_code=0

pnpm exec tsc --noEmit --incremental false
# exit_code=0；不依赖共享增量缓存

NODE_OPTIONS=--max-old-space-size=4096 pnpm build
# tsc; exit_code=0（当前项目该命令为类型构建，不产出后端JS）

pnpm exec vite build
# 3577 modules transformed; built in 19.40s; exit_code=0

git diff --check
git diff --check origin/main...HEAD
# exit_code=0
```

最初新增扩写测试误把“单条全失败”期待为返回失败清单，实际旧契约抛整单错误；纠正测试后总回归339项全过，未修改该业务合同。交叉复审经济档/报表另26项通过，无新增阻断。构建仍有既有大 chunk 和动态/静态混合导入警告。

未执行：全仓全量测试、干净 Docker 重建、本轮真实模型质量/兼容性、生产PDF内存峰值、真实积分扣退。无新依赖；不读取或导出任何生产密钥。剩余决定仅在需新增付费验收时向用户确认，不阻止本次授权内小修及条件合并。

# 文本校对改前证据与验收范围

| 项目 | 当前证据及本批约束 |
|---|---|
| 用户结果 | 图文笔记文本框增加检查，发现扫描件错别字、语义不通与逻辑问题，避免错误进入提炼和图片。 |
| 入口 | PlatformPage普通原始文本、KnowledgeCardMaterialBatches各框原材料与提炼稿；上传PDF/DOCX/MD、EPUB导入和直接粘贴均可能产生待检查文本。 |
| 数据生产 | extractPlatformDocumentText/EPUB解析/手动输入是原文生产者；prepareKnowledgeCardCopy产生提炼稿。规则初筛不调用模型、不宣称能判断语义。 |
| 模型现状 | optimizeCustomCopy: protected、32000字符、同步预扣25积分、营销深改prompt，忽略指定模型hint；不得直接套用作校对。 |
| 转换 | 新检查建议必须绑定本次原文及精确位置。原文改变即建议失效；重叠或锚点不符的修改不得应用。数字、人名、术语不凭推测改写。 |
| 存储 | 原文与用户确认稿分离，先可靠保存再替换；旧提炼稿/图片与在途任务保留。刷新后只查原检查任务，不自动重发。 |
| 副作用 | 模型只走现有Fly服务端凭证/已鉴权入口；新增检查计费与自动触发方式等待用户明确，独立函数与契约可先实现。 |
| 消费 | 展示原句、问题、建议；用户选择后才将确认稿写回相应文本框。下游提炼/分页/出图读取用户确认后的同一份文本。 |
| 失败 | 不把空结果、截断、错误JSON或未检查冒充无问题；不静默覆盖原文、不自动付费重试、不降级成营销改写。 |
| 验证 | 规则定位与边界、严格建议校验、选中应用/冲突/陈旧检查、任务owner/恢复/超时、离线DOM，最终类型/构建与完整diff。线上付费实跑尚未授权。 |


## 当前交付状态：部分完成

函数初筛已接入普通文本框及每份原材料/提炼稿文本框。独立模型服务与确认建议面板已实现并做离线测试，但尚未连接生产API/队列；用户尚未确认新检查的费用是否包含在既有页费，以及导入自动检查还是手动触发。当前只显示规则初筛，不把规则结果说成模型已校对，也未调用旧25积分营销优化接口。

### 文件与跨层影响

- `shared/knowledgeCardTextReview.ts`：规则疑点、严格UTF-16原文位置校验、同源/勾选/不重叠替换。
- `server/services/knowledgeCardTextReview.ts`：独立轻量模型校对，单请求、180秒、无自动重试；先保存原始回执再解析；恢复只解析已有原文回执。尚无生产路由调用方。
- `client/src/components/platform/KnowledgeCardTextReviewPanel.tsx`：检查记录、原ID查询契约、建议默认不选、过期禁止应用、确认后替换及撤回。
- `client/src/pages/PlatformPage.tsx`、`client/src/components/platform/KnowledgeCardMaterialBatches.tsx`：普通原文框、各份原材料及提炼稿接入；模型回调尚未提供，当前实际只运行规则初筛。
- 对应三个新增测试文件：shared规则、server模型mock、client离线Chromium DOM。

### 实际验证

`pnpm exec vitest run shared/knowledgeCardTextReview.test.ts server/services/knowledgeCardTextReview.test.ts client/src/lib/knowledgeCardTextReviewPanel.browser.test.ts client/src/lib/knowledgeCardMaterialBatches.browser.test.ts`：`Test Files 4 passed (4); Tests 45 passed (45)`。日志 `/tmp/knowledge-card-text-review-tests.log`。其中7项纯函数、24项模型mock、9项面板真实离线DOM、5项旧分框DOM回归。仅使用虚构test-key与fetch stub，不连接生产上游。

全量`pnpm check --incremental false`与`pnpm exec vite build`均退出0，日志分别为`/tmp/knowledge-card-text-review-typecheck.log`和`/tmp/knowledge-card-text-review-build.log`。随后补充共享busy状态/撤回记录保护，重跑45项全过并完成面板esbuild语法检查。`git diff --check`退出0。

### 未验证与待决定

- 费用归属待用户决定，未制定新价、未擅自套用旧收费、未发起真实模型任务。
- 生产API鉴权、幂等队列、任务持久化和恢复到正式面板尚未接通；不能称错字/语义/逻辑检查已完成。
- 当前规则只提示乱码、异常控制字符、可疑断行和重复标点。自然语言问题需要模型及人工确认；不确定数字、术语和人名不自动改。
- 没有线上实跑、扣费/退款测试或部署；所有已生成稿件及图片保留。

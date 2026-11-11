# billing · 积分/定价/扣退款事实

## 换算锚点
- 1 积分 ≈ $0.0147（EvoLink 换算）≈ ¥0.65（人物背景优化毛利注释反推）。毛利底线 **65%**。
- 美元换人民币记账一律 **1 USD = 7 CNY**（用户 2026-08-13 拍板）。
- 模板学习成本统计（读片成本表 / GLM 整形 / 系列聚合回执）汇率单一真源 `NATIVE_DEEP_READ_PRICE_USD_TO_CNY = 7`（`shared/manhuaNativeDeepReadJob.ts`，1110 起）；只影响成本展示，不参与扣费。代码动画改片、Seedance 报价、混元 3D、画布定价注释仍是 7.2，未动。
- 价格永远用户拍板，agent 不得自创（work-rules 5）。

## 双源陷阱（最高频雷）
- `CREDIT_COSTS` 同时存在于 `shared/plans.ts` 与 `server/plans.ts`，**改价必须两处同步**——只改一处的实锤后果：用户端按 20 展示、服务端按 48 扣（2.4×）。
- 双源合并为单真源已获用户批准、待执行（见 line-platform.md 待办）。

## 扣费/退款模式（抄这些，别自创）
- 扣费：`deductCreditsAmount(userId, amount, action, desc, { chargeKey })`，chargeKey 形如 `platformTopicExpand/${userId}/${jobId}`，**jobId 先生成再入队**，保证幂等。
- 退款：`addCredits(userId, amount, "refund")`；部分退款要先读 `prevOutput.refundedCredits` 防重复退（server/jobs/runner.ts expand 分支是样板）。
- 全额退款时机：attempts ≥ 2 全失败（html_ppt 模式）。
- 反空壳判定：上游返回非 JSON 或 <20 字符 = 失败条（failedPicks），进退款，不进交付。
- 管理员/监督账号扣 0 积分，但**上游 API 成本照样真实发生**——测试跑量前先算上游账。

## 已拍板价格（2026-08 时点，全量见 shared/plans.ts）
- 扩写按条 20 点/条（旧整批 48 一价勾满 20 条净亏，已废）。
- 单页知识卡四档：超凡 36/精细 30/均衡 27/轻量 24（前 8 满价，其后折扣）。
- 4K 成片限时 688、2K 388；超分 2K 2 积分/s、4K 4 积分/s，不足 5s 按 5s、600s 封顶，自由画布 ×1.1 进位；漫剧整集 688（172/段×4）。
- 成片调色建议（MV「AI 调色建议」）20 积分/次（用户 2026-11-09 定价）：常量 `CREDIT_COSTS.montageGradeAdvice` 两处同步（shared/plans.ts + server/plans.ts），前端按钮读 `@shared/plans` 同一常量；扣费 action=`montageGradeAdvice`、说明「成片调色建议」、chargeKey `canvas-montage-grade:${userId}:${requestId}`；管理员/supervisor 0 扣；模型失败不扣。同 requestId 已有结果直接返回已存结果并按同 chargeKey 幂等补扣、不再调模型；已登记无结果（处理中/失败）拒绝并提示重新发起。
- 线路三（1111，Carbon）连载扩写 / 小说改编：占位 25 积分/集（`MANHUA_WRITER_CARBON_EPISODE_CREDITS`，shared/manhuaWriterModels.ts 单处，服务端与前台同读），**待站长定价**；线路一 / 二仍 6 积分/集。MV 深度编排暂按原顾问计费不变（待定价）。
- 待批新价：长文提炼 25 点/次（提案见 `~/Downloads/2026Aug12/功能提案-长文转知识卡.md`）。

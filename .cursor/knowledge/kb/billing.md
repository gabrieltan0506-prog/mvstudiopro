# billing · 积分/定价/扣退款事实

## 换算锚点
- 1 积分 ≈ $0.0147（EvoLink 换算）≈ ¥0.65（人物背景优化毛利注释反推）。毛利底线 **65%**。
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
- 待批新价：长文提炼 25 点/次（提案见 `~/Downloads/2026Aug12/功能提案-长文转知识卡.md`）。

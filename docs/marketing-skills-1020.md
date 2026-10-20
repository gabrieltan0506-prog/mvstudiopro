# 营销方法 P0–P1 接入说明

本轮依据：2026-10-20 用户确认的 P0–P1 接入范围。目标是将商业背景、候选商品梯度、选题和文案串入现有审核；不修改 schema、计费、模型参数或发布链。

## 版本与来源

共享实现为 `shared/marketingSkills.ts`，本地方法版本 `2026-10-20.1`。上游固定为 [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills/tree/e85f3cbc2e4a79bf33b2a12e9bdd9087d414735b)，提交 `e85f3cbc2e4a79bf33b2a12e9bdd9087d414735b`。只读其方法正文，未执行安装、外部发布、跟踪代码或任何上游指令。

| 本地方法 ID | 上游 skills 目录 | 本次采用 |
|---|---|---|
| marketing-positioning | product-marketing | 产品、人群、购买角色、替代方案、证据分开 |
| marketing-offer-ladder | product-marketing / pricing | 引流品、利润品、高价交付候选；不同交付边界 |
| marketing-pricing-economics | pricing / analytics | 定价依据、单位经济、口径与分母检查 |
| marketing-content-strategy | content-strategy | 真实需求、内容新增价值、合适承接 |
| marketing-copy-proof | copywriting | 空白稿/原声润色/局部修改区分；可支持的承诺 |
| marketing-social | social | 同一事实按平台形式改编；真实素材与产能 |
| marketing-ethical-psychology | marketing-psychology | 清晰选择、真实证据、真实稀缺与伦理限制 |
| marketing-analytics | analytics | 指标为决策服务；同一闭合观察窗；缺分母不算率 |
| marketing-ai-seo | ai-seo | 可独立理解的答案、来源日期、引用与成交分开 |

每项固定版本链接可由导出的 `MARKETING_SOURCES` 查询；方法的 `sourceIds` 对应其中的 ID。商品梯度是本轮需求的本地适配，不声称是上游逐字规则；成本/售价未知不填默认金额。未采用上游的固定美元价位、固定倍数、海外平台发布频率、流量百分比或效果预测。

## 接口与现有合同

- `MARKETING_METHODS` 保持 `{ id, name, sourceIds, apply }`，并加入 `VIRAL_CREATION_METHODS`，现有 `auditXhsCreationPackage` 从该库验证方法 ID 和实际正文引用，无需新增审核 schema。
- `isMarketingContext(context)` 为保守的显式词项门禁。单独“亲子关系儿童绘本、动画”不等于已售产品或商业目标；用户明确排除营销时不启用。它不冒充完整语义分类，提示词仍要求遵守完整用户要求。
- `buildMarketingPrompt({stage,context})` 支持 `shortlist / expand / optimize / research`；非商业语境返回空字符串。搜索方法仅在提及搜索、网站、问答等内容时进入编译提示词。
- `buildViralMethodPlan` 在内部提示词计划附上 `marketing.enabled/methods/sources/boundary`，不是数据库、API 或生成输出 schema。
- `compileViralCreatorInput` 合并实际 profile/requirements 触发同源提示词；服务端各入口由调用方在原模型请求构建点接入，不改生成参数。

## 风险与验收断点

成本、售价、工时、获客分母未给时只能列待补；候选不是已售事实，定价不是保证成交。获客成本、毛利和净利分别说明口径并避免重复扣费。儿童心理、绘本和动画不得给诊断、治疗或确定改善承诺，不制造育儿焦虑。

## 实际接线与保存

- 爆款创作的商品辅助只追加原 `focusPrompt`，仍用原账号隔离草稿/预设；超8000字拒绝追加，原文不动。试算输入在点击加入前不保存，加入后为可编辑的普通背景文本。
- 选题初选和扩写在实际服务请求加入同源方法；不放开原专用Skill池。`selectViralCreationMethods`按用户明确商业意图过滤，生成出的题目不替用户开启营销；关闭营销后共享库仍能识别旧结果ID，但新请求不含营销方法。
- 初选通过已有说明字段安排系列与内容目的。扩写三档经营候选写`publishingAdvice`；`conversion`仅描述已确认的单一承接；营销方法引用继续经过原正文引用审核。
- 普通优化通过`platformNotes.angle`承载建议，两个前端调用入口均转入既有summary说明区，PDF导出单独成段。`optimizedMarkdown`继续只作发布正文和后续生图输入。
- 研究使用原CommanderProfile与场景输入；没有新增品牌管理、数据库、API或生成结果schema。
- 根据本轮补充参考收窄边界：工厂分镜专路未挂营销方法，只新增防误注入测试；知识卡/数字人生产链不新增营销决策。未实现B站新的专用生成合同、归因仓库、自动营销或新增SEO发布链。

## 本地验证与剩余边界

83项独立用例通过（分批执行，不重复累计）：共享方法/成本测算/原创作与课程规则/真实服务函数的离线请求及备用通道/工厂隔离/普通优化/研究/浏览器交互与草稿往返/PDF建议分段。生产函数测试隔离模型和数据源，**不证明真实模型内容质量**。

`pnpm exec vite build`通过，存在原有体积告警。无新依赖或锁文件改动。`pnpm exec tsc --noEmit --incremental false`通过（退出0）；最终提交见PR说明。

未做：真实模型调用、用户原页面验收、线上扣退/任务恢复、Fly隔离机探针、合并部署。输入配置沿原草稿可恢复；文案优化完整结果原本不属于配置草稿，本批不新增其持久化能力。最终商品、成本、售价、工时、案例、使用权与付款意愿仍需实际资料确认。

# 趋势报告日期与证据口径修正

状态：部分验证。仅交付独立 PR，未合并、部署或新增付费报告。

## 需求与改前证据

| 检查层 | 事实与边界 |
| --- | --- |
| 最终结果 | 3/7/15/30 日报告日期一致，增长有真实对照，选题建议不冒充搜索量或算法证据。 |
| 允许与禁止 | 用户明确要求单独 PR；只改趋势报告，保留模型路由、业务定价、扣费、退款与已有任务。 |
| 入口 | PlatformPage 趋势分析、后台轮询完成、最新任务恢复均经 visualReportMapper；长图和下载共用 VisualReportTemplate。 |
| 数据生产 | generateVisualReport 读取趋势库；visualReportTrackGrowth 按逐条时间、分类和所选平台计数。旧版在前窗为零时按排名生成 +12%～+98%。 |
| 转换与存储 | 服务端已有上海窗口，但未返回日期；mapper 每次用今天减 N，造成多一天和旧报告日期漂移。runner 原样保存 result 到 job.output，最新任务接口返回 output。 |
| 消费 | 长图页眉、页脚及右栏消费 dateRange；旧平台卡片以数组位置生成条形长度及高热等标签。 |
| 副作用与恢复 | worker 的 prepaidPlatformTrendJobId 复用唯一报告接口；本批不改入队、幂等扣费、失败退款、轮询状态与旧产物。 |
| 已知断点 | 未授权新增付费调用，无法将本地验证称为线上实跑。旧报告没有原生成窗口，只能标注按创建日期近似恢复。 |

## 改后正反追链

正向：PlatformPage → enqueue/worker → generateVisualReport → 上海日历边界与样本计数 → 服务端固定日期、逐赛道 evidence → job.output JSON → mapper → 长图/右栏 → 原 DOM PNG 导出。

反向：长图百分比由 evidence 的 currentCount/priorCount 重新计算；evidence 仅由统计生产者按完整分类键填写，不能复用模型或旧缓存的证据。窗口来自同一次服务端 anchor，序列化保持平台、前后窗口及样本计数。无前窗显示缺少对照；旧记录无证据显示口径未记录。关键词旧字段名保留，消费语义改为选题建议。

旁路核查：历史恢复、轮询、两种长图主题、单平台与多平台卡、PNG、右栏均覆盖。负向话题仍使用原模糊判负规则，统计赋值仅允许精确分类。重复平台参数去重；多标签样本可计入多个分类，不能将各赛道数量相加理解为独立内容总数。

## 修改文件

- server/routers.ts：提示词口径、固定日期与平台标题。
- server/services/visualReportTrackGrowth.ts、shared/visualReportEvidence.ts：真实计数与证据契约、无前窗处理。
- client/src/lib/visualReportMapper.ts、client/src/pages/PlatformPage.tsx：恢复日期与趋势提示。
- client/src/components/VisualReportTemplate.tsx、client/src/components/platform/PlatformTrendReportRail.tsx：统计证据展示，去除无依据排名柱及热度标签。
- 对应统计、mapper、渲染测试；本说明及平台知识库记录。

## 验收与限制

本地样本集成回归：本期3条、前期1条经过统计修复、JSON序列化、mapper及真实React模板渲染为+200%，本期1条前期0条为缺少对照；旧+98%不再展示。测试数据为明确的离线测试样本，不是线上采集实测。

需求、入口、生产、契约、存储传递、消费：已验证代码链与离线回归；服务端计费/退款逻辑未改。真实用户动作、付费上游返回、线上PNG下载和账本闭环：未做线上实跑，整体不能标为线上完成。

残余限制：样本数变化受采集覆盖、样本发布时间/观测时间差异及今日未结束影响，不代表平台全量流量或市场规模。历史正文未重新生成，其中既有文字判断仍需按旧报告审阅；本批不会自动花费积分重跑旧报告。旧报告按创建日期恢复时有显式标注，跨午夜排队可能有差异。

## 验证记录

- `pnpm install --frozen-lockfile`：退出0，锁文件无变更；安装1317个包，按现有策略跳过部分安装脚本。
- `pnpm check`：最终退出0。初次检查发现新增测试的Set/Map迭代与仓库编译目标不兼容，已改Array.from并重跑通过。
- `pnpm exec vitest run client/src/lib/visualReportEvidenceRender.test.ts client/src/lib/visualReportMapper.test.ts client/src/lib/platformVisualReportPersist.test.ts server/services/visualReportTrackGrowth.test.ts server/services/visualReportLlm.test.ts server/services/visualReportDeepSeek.test.ts server/services/economyContentSafety.test.ts server/growth/trendWindow.test.ts shared/platformTrendPricing.test.ts`：`Test Files 9 passed (9)`，`Tests 86 passed (86)`。
- 渲染回归最初发现旧平台卡循环高热标签，已移除后重跑通过。
- `pnpm build`：最终退出0；`pnpm exec vite build`：退出0，`3578 modules transformed`、`built in 37.00s`。前端仍有既有大包及动态/静态混合导入警告。
- `git diff --check`：退出0；完整diff及相关调用点已复查。未运行全仓所有测试，没有单独配置的lint命令；未做生产付费调用、线上PNG下载、退款账本实跑。

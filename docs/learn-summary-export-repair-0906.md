# 学习报告与重新入库修复证据

| 检查项 | 改前证据与边界 |
| --- | --- |
| 最终结果 | 两栏有真实完整正文；完整重新学习可由用户批准入库；HTML 本机下载 |
| 范围 | 修整形两栏约束、同源原稿恢复及入库判断；不改读片冻结契约、不调用模型、不自动批准 |
| 入口 | PlatformPage 导出和批准；manhuaViralTemplate 路由 |
| 生产者 | 本次四份分片原稿两栏都有正文，整形 parsed 两栏各一字 |
| 转换与存储 | 整形 schema 的 pattern 为单个非空字符；共享校验仅 min(1)；proposal 和 HTML 都保留单字 |
| 消费者 | 报告章节正文为“第”和“国”；正式卡旧 4/4、提案新 4/4，被严格进度升级规则拒绝 |
| 权限与恢复 | 批准沿用 owner 入口、生命周期锁、旧版归档及 proposal generation 条件写；不增加计费 |
| 验证 | 共享两栏校验、runner schema、报告完整正文、store lifecycle 正反向案例；类型及构建 |

## 改后追链与验收

- 正向：原生学习 runner 的实时整形、缓存命中及本地回退均经过共享两栏校验和同源恢复；入库前再恢复历史坏提案；报告渲染也经过同一恢复逻辑。
- 反向：用户下载的 `tpl_native_109554f0f515-g38f_ep001.html` 两栏分别为“第”“国”，与同卡 proposal、对应整形 parsed 一致。其 provenance 指向的四份原稿两栏长度为 64/69、48/46、67/72、76/79，全部有内容。
- 已验证：取消整形 schema 单字符 pattern，单字校验不通过；原生读片冻结 schema、模型和预算未改。不能据此断言供应商内部实现，未做付费 A/B 探针。
- 已验证：历史提案恢复按精确对象名、系列、集号、来源摘要与连续分片核对；任一缺失或错配拒绝，原稿不改写。恢复发生在既有批准入口的生命周期锁内。
- 已验证：同源完整新批次、新快照且时间更新可替换同为4/4的正式卡；重复批次、旧提案、不同来源、缺证据及未完成均拒绝。新版本保留公开码，旧版先归档；不拼接两次学习的镜头和费用。增量补全原路径继续回归。
- 已验证：本地实际文件使用相同恢复/分组函数生成验收副本，6577434 字节、30 张内嵌图，两栏含分段标记分别278/289字符，四份原稿正文逐一全文匹配。未覆盖用户原文件。
- 命令：`pnpm exec vitest run shared/manhuaNativeRequiredSummary.test.ts server/services/manhuaNativeDeepReadRunner.test.ts server/services/manhuaNativeDeepReadExecution.test.ts server/services/manhuaNativeDeepReadIngest.test.ts server/services/manhuaNativeReportRender.test.ts server/services/manhuaViralTemplateStore.lifecycle.test.ts server/services/manhuaViralTemplateStore.archive.test.ts`：7文件474项通过。
- 命令：`pnpm check`、`pnpm build` 均退出0；另执行关闭增量缓存的类型检查。仓库未提供独立 lint 脚本；`git diff --check` 通过。
- 部分完成：未合并、未部署，修复版本尚未在线点击导出/批准验收；未重新调用付费模型。浏览器下载交接问题不在本补丁中冒充已验证。
- 限制：至少两字符是拦截本次单字缺陷的结构下限，不代表通用语义质量评分。旧提案只有在原稿身份与全部分片内容核对通过时自动恢复；不能恢复时明确失败，不伪造正文。

# PR1662 与已合并1663的交会验证

2026-10-05，北京时间00:43。

用户已自行合并1663，main更新至20592a73。PR1662新语音提交b651320d推送后显示CONFLICTING；唯一文本冲突是manhuaViralTemplateStore.ts顶部import。

解决方式：保留1662的publishTemplateCatalogChanged，以及1663的isCompleteNativeEpisodeRelearn/isSameBatchedNativeEpisodeOutput。将当前main整合进原PR分支，不关闭或合并GitHub PR，不触发正式部署。

新增交会断言：9→8分片完整镜站重学批准后，正式卡保持公开编号、归档旧内容、更新完整新证据，同时目录更新事件恰好一次。

仅执行这一项：`pnpm exec vitest run server/services/manhuaViralTemplateStore.lifecycle.test.ts -t '9→8分片分批整形批准：完整镜站重学'`，1通过、82跳过。日志backend-work/1005-pr1662-1663-integration.log。没有重跑1663的28项或此前语音25项，没有重建未变化的前台，没有付费调用。

语音应用源码仍为b651320d，复用该提交的类型、Vite和离线证据。新增一个测试断言及导入冲突解决，不改两边的业务算法。尚未正式线上验收。

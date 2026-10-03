# 知识卡刷新终止（PR #1656）

用户 2026-10-03 要求刷新页面终止知识卡任务。本批读档、提炼与精华派生由页面预分配 UUID；sessionStorage 只保存当前标签/账号的请求身份。离开文档发送停止 Beacon，刷新后的页面补查停止回执，失败保留身份并明确报错；普通标签隐藏和 React effect 重挂不取消。

服务端根据账号、action、UUID 派生同一任务主键。取消早于入队时写 failed 占位；迟到入队只做 `onConflictDoNothing`，不复活、不重排。入队早于取消时复用既有 `requestPlatformJobCancel` 与独立轮询的 `makeKnowledgeCardCancelWatcher`。完成或已进入结算检查点的任务保留原结果，取消不能覆盖结算。无 pageRequestId 的旧调用维持原队列行为；新页面短文本也走可取消任务。

调用链：`PlatformPage.runKnowledgeCardDistill / deriveCompactFromFull` → `KnowledgeCardPageTasks.begin` → 两个 tRPC mutation（三个入队分支）→ `createKnowledgeCardPageJob` → 原 runner。刷新 → `/api/jobs/knowledge-card/request/:requestId/cancel` → `cancelKnowledgeCardPageRequest` → 原取消监视器。不调整原稿、已出图、页费、退款或结算规则。

## 验证与范围

- 服务端：预先取消/迟到提交、已排队取消、正在执行取消、结算/成功保护、账号与action隔离、同请求不同原稿拒绝；连同既有真实取消监视器、统稿取消和结算 CAS 回归。
- 浏览器：真正 reload、卸载请求丢失后补送、隐藏/重挂不误停、完成后无多余取消、多标签隔离、停止接口失败保留记录与恢复网络重试。另跑现有真实 PlatformPage 派生/出图互锁10项。
- 首轮浏览器沙箱挂载未完成，已中止；改为获准的本地 HTTP/隔离浏览器后15项通过。首次类型检查发现 MapIterator 与项目 ES5 target 不兼容，已改 Array.from；缓存写入共享 node_modules 受限，改将 tsbuildinfo 指向 /tmp 后检查通过。
- 尚未上线验收，不提交真实付费任务。Beacon 不能保证离线/浏览器崩溃时送达；刷新后可联网时补送，失败不虚报已停。
- 出图是另一条 fire-and-forget + paidJobLedger 路径；本批当前阻止离页后的新页发送，已提交供应商页的实际中止范围待用户确认，不能声称全部取消或撤回外部费用。

## 当日线上诊断（独立于本地修改）

按用户指令已停止《中华民族神话与传说》两笔任务：`og98MWYX9n8y8VS-`于19:33:06按正常取消终态；`qSBvHFHUP3B9XkAe`原进程19:24重启后失活，以指定账号/任务/原updatedAt/取消戳/无结算检查点的CAS收为failed，保留原输入与PDF。最新《我心归处是敦煌》`_h-ayQGGPEWzASHQ`在19:33:38已运行、PDF已转、读页阶段0/323、5%。没有重送或重启服务。

- 最终定向回归：刷新服务端6项 + 既有取消监视14项 + 结算6项 + 浏览器15项 + 小说13项 + 共享流式38项，共92项不同测试通过。类型检查通过。子代理报告及F1开放状态见 `pr1656-review-ledger.md`。

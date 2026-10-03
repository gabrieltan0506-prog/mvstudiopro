# 知识卡刷新终止（PR #1656）

用户 2026-10-03 要求刷新页面终止知识卡任务。本批读档、提炼与精华派生由页面预分配 UUID；sessionStorage 只保存当前标签/账号的请求身份。离开文档发送停止 Beacon，刷新后的页面补查停止回执，失败保留身份并明确报错；普通标签隐藏和 React effect 重挂不取消。

服务端根据账号、action、UUID 派生同一任务主键。取消早于入队时写 failed 占位；迟到入队只做 `onConflictDoNothing`，不复活、不重排。入队早于取消时复用既有 `requestPlatformJobCancel` 与独立轮询的 `makeKnowledgeCardCancelWatcher`。完成或已进入结算检查点的任务保留原结果，取消不能覆盖结算。无 pageRequestId 的旧调用维持原队列行为；新页面短文本也走可取消任务。

调用链：`PlatformPage.runKnowledgeCardDistill / deriveCompactFromFull` → `KnowledgeCardPageTasks.begin` → 两个 tRPC mutation（三个入队分支）→ `createKnowledgeCardPageJob` → 原 runner。刷新 → `/api/jobs/knowledge-card/request/:requestId/cancel` → `cancelKnowledgeCardPageRequest` → 原取消监视器。不调整原稿、已出图、页费、退款或结算规则。

## 验证与范围

- 服务端：预先取消/迟到提交、已排队取消、正在执行取消、结算/成功保护、账号与action隔离、同请求不同原稿拒绝；连同既有真实取消监视器、统稿取消和结算 CAS 回归。
- 浏览器：真正 reload、卸载请求丢失后补送、隐藏/重挂不误停、完成后无多余取消、多标签隔离、停止接口失败保留记录与恢复网络重试。另跑现有真实 PlatformPage 派生/出图互锁10项。
- 首轮浏览器沙箱挂载未完成，已中止；改为获准的本地 HTTP/隔离浏览器后15项通过。首次类型检查发现 MapIterator 与项目 ES5 target 不兼容，已改 Array.from；缓存写入共享 node_modules 受限，改将 tsbuildinfo 指向 /tmp 后检查通过。
- 尚未上线验收，不提交真实付费任务。Beacon 不能保证离线/浏览器崩溃时送达；刷新后可联网时补送，失败不虚报已停。
- 用户确认出图一并停止，并接受已提交供应商的单继续完成。出图在扣费前以UUID唯一创建running占位（不入队）；先取消及重复提交不取得执行权。后续每次供应商调用、OpenAI换钥与下载参考图后的POST、整链重试前都检查取消。已提交的图片继续接回并结算；unknown保持既有对账，未改退款规则。
- 原有posterResume只记录一张在途图片，不能声称刷新后恢复全部并发页。本批保证取消不覆盖服务器已完成output，不新增整套结果恢复功能。

## 当日线上诊断（独立于本地修改）

按用户指令已停止《中华民族神话与传说》两笔任务：`og98MWYX9n8y8VS-`于19:33:06按正常取消终态；`qSBvHFHUP3B9XkAe`原进程19:24重启后失活，以指定账号/任务/原updatedAt/取消戳/无结算检查点的CAS收为failed，保留原输入与PDF。19:52:44再次只读确认《我心归处是敦煌》`_h-ayQGGPEWzASHQ`于19:51:05成功，精简派生`leM2FDOVENRN4kS1`19:51:07创建，19:52:08心跳、派生5%、无错误；用户随后报告已生成图片，本轮未取消该任务。没有重送或重启服务。

- 最终定向回归：刷新服务端6项 + 既有取消监视14项 + 结算6项 + 浏览器15项 + 小说13项 + 共享流式38项，共92项不同测试通过。类型检查通过。上述为3916dc64批次；子代理报告见 `pr1656-review-ledger.md`。

## 出图增量验证

35项服务端定向测试：任务身份/并发/取消10项、真实provider调用边界mock6项、OpenAI请求边界4项、原OpenAI请求7项、供应商接线8项。真实浏览器刷新6项通过。测试覆盖取消先到、无后台id先刷新、重复提交只获一次执行权、不fallback/不换钥、下载参考中刷新、在途成功仍保存、unknown不覆盖。无真实付费生成。独审状态F1 CLOSED_LOCAL。

最終 TypeScript 檢查 exit 0（/tmp/card-image-types-verified.log、.exit）；第一次最終檢查遭exec-server transport斷線未取得退出碼，已以持久退出碼重驗。

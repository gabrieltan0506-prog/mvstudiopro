# PR1442 取消与结算补修

用户最新授权：修正后仅推送原 PR，由用户合并；不部署、不付费实跑、不使用子代理。

## 改前证据与边界

读档/派生终止入口经 jobs.input.cancelRequestedAt 到 worker signal；原 force 检查会因查询在途或异常放行。抽文档下载缺少 signal。取消与 receipt/扣费之间没有原子门，查库故障还会返回假404。限定修这些缺口和必要恢复，不改模型、价格、权限、旧生产凭证或用户已有素材。

## 本次补丁

- runner 的强制检查等待在途查询、查询错误不放行；启动检查和取消分类保留。
- repository 用同一任务行 CAS 互斥取消与进入结算。进入结算前保存完整原稿、页计划、费用、档位，迟到进度不能覆盖。
- settlement runner 只消费保存的检查点，沿用旧 chargeKey 和 receipt 契约，已有扣费读取原账；恢复不调用模型。
- 终态严格写入；写入或结算失败保留原稿，失活回收只重排结算而非重新生成。旧无检查点任务保留原失活处理。
- 下载、PDF子进程、EPUB解析/渲染/合并、页图上传传取消信号；取消不进入格式失败/剥图重试，内部子进程关闭后再清临时目录。
- 取消API区分已完成、结算中、已请求停止和普通失败，数据库未知不说“肯定未生效”。

实际文件：server/jobs/{runner,repository,staleJobsReaper,knowledgeCardSettlementRunner}.ts；server/_core/index.ts；server/growth/documentExtract.ts；server/services/{knowledgeCardDistill,knowledgeCardDocumentPages,knowledgeCardEpubToPdf,knowledgeCardCancellation,gcs}.ts；三个知识卡取消/结算测试。

## 双向追链与状态

正向：终止按钮→取消API→任务行CAS→watcher→下载/转换/模型→检查点→receipt/幂等账→严格终态→原轮询。

反向：终态正文来自相同任务检查点；检查点markdown与output.distilledMarkdown强一致；receipt使用同档同稿；账本键绑定原jobId；取消赢CAS时不写检查点、不进结算。恢复分支先读检查点，不进入模型生成分支。另派生入口走同一结算门，费用为0。

| 层 | 状态和证据 |
|---|---|
| 需求/边界 | 已验证：仅原PR补修，不代合并 |
| UI入口 | 沿用805b9fef已验入口，本次不改前端 |
| 生产者/转换 | 部分验证：watcher、原稿读取、真实PDF/EPUB转换回归 |
| 服务/计费 | 部分验证：CAS条件、已有账不重复扣、查账失败不盲扣；未真实DB并发扣费 |
| 存储/恢复 | 部分验证：原稿检查点、严格终态、失活重排；未线上崩溃实测 |
| 消费/展示 | 部分验证：原稿强一致与API状态已实现；未上线页面实跑 |
| 静态/回归 | 命令和回执如下，不用旧基线测试替代 |
| 真实链路 | 未做线上实跑，不宣称生产质量完成 |

## 验证回执

- `pnpm check --incremental false`：修正EPUB deps类型后退出0；首次类型检查曾因该参数未接完失败，已修。
- `pnpm exec vitest run server/jobs/knowledgeCardCancel.test.ts server/jobs/knowledgeCardSettlementRunner.test.ts server/services/knowledgeCardDocumentPages.test.ts server/services/knowledgeCardEpubToPdf.crash.test.ts server/services/knowledgeCardDistill.test.ts --maxWorkers=2 --minWorkers=1`：5文件51通过，23.95秒；包括真实Chromium+pdfunite与逐页备料。
- `pnpm exec vitest run server/jobs/knowledgeCardSettlement.test.ts --maxWorkers=1 --minWorkers=1`：6通过，2.06秒；CAS条件、取消先赢/结算先赢、首读故障、终态失败。
- `git diff --check`：通过。
- 共享回归首跑19通过、3失败：旧reaper测试以String(error)识别知识卡更新，改为SQL CASE后无法识别；已改为读取实际SQL表达式，并增加检查点重排/不覆盖output/queued保留断言。没有为通过测试回退生产保护。
- 共享回归重跑 `staleJobsReaper.test.ts documentExtract.pptx.test.ts gcs.versioned.test.ts gcs.bounded.test.ts`：4文件22通过，2.19秒。三批合计10文件79通过。

未执行：生产扣费/退款、真实数据库竞争/重启恢复、部署后按钮验收、干净Docker全构建、全仓测试。失活结算恢复遵循已有reaper时间阈值，不承诺即时恢复；永久计费错误保留原稿待对账，不自动改价/免费交付。纯计算/签名等待若底层无取消能力，结束后不再消费；不能承诺所有CPU工作立刻消失。

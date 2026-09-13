# 每日 Preview 清理独立复审（2026-09-13）

- 被审提交：`01b5ccd05db6d2bd61bcb345a72260974d5bbeff`，分支 `fix/vercel-preview-daily-0913`；本次读取该精确提交完整变更及实际调用链。PR 编号本次未查询，不推定远端状态。
- 结论：代码与本地回归层未发现尚未闭合的阻断项；线上每日执行仍待发布后验收。审查者未编写运行器或调度核心，仅独立新增了锁的测试文件。

## 发现项与复验

初版存在 P1：两个陈旧锁恢复者可能先后搬走对方新锁，且释放时可能删除他人锁。最终提交改为所有创建、恢复和释放先取得 `recovery.lock`，取得后才读取现有 owner，释放再核对机器、boot、PID 和 receipt。独立的重入竞争测试、活进程拒绝、旧 boot/死进程恢复、未知 owner 拒绝及禁止释放他人锁共 9 项通过，原发现项已闭合。

## 跨层检查

- 入口：`server/_core/index.ts` 在服务启动回调调用 `startVercelPreviewScheduler`，退出处理首先调用 stop；Fly app/process group/machine 条件隔离启动，Docker 使用源文件 tsx 入口。
- 生产与消费：每天北京时间 10:40 后 tick 调用真实 `executePrune({apply:true})`，固定团队与项目，查询三种在途状态，分页枚举并复核每个候选的项目归属、生产目标、别名和年龄，然后发固定 ID 的 DELETE。
- 存储与恢复：JSONL 保留计划、删除意图和结果，每日状态通过临时文件加 rename 写入；只有零 DELETE 的在途延期每 15 分钟重查，已发送 DELETE 的失败或未决批次当天不重放。停止信号进入 fetch，中止后有失败回执。
- 凭证与邻接：令牌仅取服务端环境并进 Authorization，未写入日志或审计；新增 runtime 测试使用 `test-key` 和内存 fetch 替身，没有真实上游调用。业务 API、计费/退款、媒体对象未改。
- CI：工作流先运行 Node 锁/清理测试，再启用 Corepack、按仓库固定 packageManager 安装锁文件，最后运行调度、runtime 和选择器测试；所有测试路径在提交内存在。未发现确定的安装配置阻断，GitHub runner 的实际安装、网络及五分钟预算仍须以本次 CI 结果为准，不能用本机缓存结果代替。

## 本次独立执行的原始结果

- `node --test scripts/vercel-prune-preview-deployments.test.mjs scripts/vercelPruneLock.test.mjs`：27 tests，27 pass，0 fail，175.299ms。
- `pnpm exec vitest run server/ops/vercelPreviewScheduler.test.ts server/ops/vercelPreviewRuntime.test.ts server/growth/vercelPruneSelect.test.ts`：3 files passed，27 tests passed，856ms；runtime 5 项分别验证空跑、完整替身删除、在途零删延期、缺令牌零网络及预先中止信号。
- `git diff HEAD^ HEAD --check`：退出 0，无输出。
- 类型检查、非增量 tsc、Vite 构建及 Fly v6 三状态 HTTP 200/count 0 本次由主代理报告并记录于 `docs/vercel-preview-daily-0913.md`，本审查者未重复执行或冒称独立实测。

## 未验边界与保留限制

未执行真实 DELETE、线上每日调度、正式进程重启及部署后持久回执核对。runtime 停机用例验证预先中止信号，scheduler 用例验证运行时 stop 发送信号，不等同真实网络请求途中中止实测。公开 DELETE 不具备原子 target/alias 条件，外部 promote 竞态仍存在；持有恢复 guard 的短同步区间异常退出可能留下 guard，后续会保守拒绝并需人工核实。上述限制已在交付文档明确。

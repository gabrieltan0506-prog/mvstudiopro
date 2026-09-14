# 每日 Preview 清理

## 改前证据与边界

| 层 | 当前证据与本轮范围 |
| --- | --- |
| 最终结果 | 每日真正调用清理器，并可读取执行结果；不以离线测试代替执行 |
| 入口 | 原 workflow 只有 node --test；Fly 启动入口尚无清理调度 |
| 生产者 | Fly 内 VERCEL_TOKEN 已加载，项目查询 HTTP 200 |
| 项目 | mvstudiopro / prj_7y3mwOmGqVDHRkQYWZLmmBinkSvI / team_Ufhs4eiVYHpuryokmvrlzHIf |
| 转换 | runPrune 分页枚举、selectPrunableDeployments 按年龄筛选 |
| 消费者 | Vercel DELETE；每项意图与回执写入 /data/vercel-prune-audit |
| 保护 | 保留 Production、当前目标、别名、未知状态；在途构建则延期；每次复核身份 |
| 禁止 | 不改业务、扣费、媒体对象、Production 保留期；凭证不离开 Fly |
| 恢复 | 持久化当天执行状态、互斥锁、截止时间；重启不重复已完成批次；失败明确记录 |
| 测试 | 清理器离线测试、调度重启与失败测试、类型检查、构建、Fly 真实空跑和执行回执 |
| 已知限制 | GET 与 DELETE 不是原子条件删除；外部手动 promote 仍有极短竞态，不能声称完全消除 |

正常 Preview 保留 7 天，失败部署保留 1 天；每日北京时间 10:40，错过时启动补跑。完成状态以最终验收记录为准。

## 本地验证与双向追链

- 正向：`server/_core/index.ts` 启动 → `startVercelPreviewScheduler` 每分钟判时 → 当日持久状态 → `executePrune` → 固定团队/项目 → 在途部署检查 → 生产/别名/年龄保护 → DELETE → JSONL 回执与每日结果。
- 反向：每日结果记录原运行回执路径，JSONL 记录候选 ID、删除意图、HTTP 状态；ID 来自固定项目分页清单，删除前再次读取同 ID 详情与当前保护集。
- 手动入口仍要求 `--apply --maintenance-window-confirmed`；自动入口使用相同运行器并执行在途检查。缺 Token 也保留失败原因。空 Preview 项目允许没有 preview target，但生产 target 必须非空。
- 零 DELETE 的在途部署延期 15 分钟；已经发送过 DELETE 的失败不在当天重放，下一天重新查询。单轮最多 190 次 DELETE，剩余数标记 partial；请求上限 30 秒，整轮 20 分钟。
- `pnpm install --frozen-lockfile --ignore-scripts`：退出 0，无新增依赖或锁文件变化。
- `node --test scripts/vercel-prune-preview-deployments.test.mjs scripts/vercelPruneLock.test.mjs`：27/27 通过，533.66ms。
- `pnpm exec vitest run server/ops/vercelPreviewScheduler.test.ts server/ops/vercelPreviewRuntime.test.ts server/growth/vercelPruneSelect.test.ts`：3 文件 27/27 通过，957ms。
- `pnpm check`、`pnpm exec tsc --noEmit --incremental false`：退出 0。
- `pnpm exec vite build`：退出 0，17.76s；现有动态/静态导入与大 chunk 警告保留。
- Fly 内实际 v6 部署状态查询：BUILDING、QUEUED、INITIALIZING 均 HTTP 200，当前 count=0；没有导出令牌。
- 独立审查发现并修复旧锁恢复竞态。所有锁创建/恢复/释放先取独占 guard，释放再核对 owner；9 项锁用例包含重入竞争与禁止释放他人锁。

## 验证边界

需求、入口、契约、离线运行器、持久化/恢复及静态回归已验证。真实生产每日任务和发布后的回执尚待发布后核对；不能将当前本地通过写成线上完成。

服务关停会立即停止新 tick 并发送中止信号；被强制终止时当天 running 状态不重放。恢复 guard 的极短同步区间若遭异常终止，可能遗留 guard，需要人工核实释放。Vercel 未提供公开原子条件删除接口，外部手动 promote 的 GET→DELETE 竞态仍存在。没有修改 Production 保留策略、媒体数据、业务 API、计费或退款；本轮不调用付费模型。

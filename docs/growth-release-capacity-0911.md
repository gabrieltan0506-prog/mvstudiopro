# Growth 冷备容量修复（2026-09-11）

状态：本地验证通过，线上新一轮备份尚未验收。用户授权本批提交、推送、开 PR 并合并；未授权删除旧备份或手动重跑备份。

## 原因与边界证据

| 检查项 | 实际证据 |
| --- | --- |
| 最终结果 | 恢复冷备上传，旧数据可读；不改采集、计费、模型、权限和调度频率 |
| 最近失败 | Actions 34555615859、34539685506、34481668497：HTTP 422，file_count limited to 1000 assets per release |
| 容量 | Release 301676726 分页实查 1000 附件：942 archive、27 batch、31 稳定名附件 |
| 另一类失败 | 34511712160 前台任务让行 60 次后退出；保留此保护，不将“未备份”伪装成功 |
| 入口/生产者 | growth-backup 与 growth-archive-offload；Fly 硬链接快照、真实 gzip/tar 与 SHA |
| 转换/存储 | finalize 批次清单、上传回读、Release；旧固定清单入口保留 |
| 消费者 | trendStore 批次拼接/归档恢复；growth-archive-plan 增量凭证 |
| 失败恢复 | 全部分片验真后才更新批次清单；旧附件保留；新仓明确 404 才回旧仓 |
| 权限与费用 | 使用既有 Actions/Fly 权限，无模型调用、无新增凭证、无扣费改动 |

## 实际修改

- `.github/workflows/growth-backup.yml`、`growth-archive-offload.yml`：新分片按批次、新归档按日分仓；移除旧批次自动删除步骤；上传和回读同仓；发布前确认服务器具备新读取器。
- `shared/growthColdStoreRelease.mjs` 与 `.d.mts`：三端共用命名路由，旧仓兼容，自定义镜像保持原路径，非 404 不隐瞒故障。
- `scripts/growth-release-tag.mjs`、`growth-cold-store-routing-check.mjs`：无依赖的 Actions 路由和 Fly 只读版本检查。
- `scripts/growth-archive-plan.mjs` 与 `.d.mts`：分页盘点旧仓和相关日仓，消费同仓真实 SHA/源指纹，避免重复上传。
- `scripts/finalize-growth-platform-current-batch.mjs`：清单注明本批分片实际 baseUrl；归档批次也写每个目录实际 baseUrl。
- `server/growth/trendStore.ts`：恢复端同路由、原 SHA/字节校验保留；新仓缺清单不允许免校验恢复 tar。
- `server/growth/growthColdStoreRelease.test.ts`：新旧仓真实 HTTP、gzip/tar 恢复、部分上传、503/取消、增量盘点、两工作流实际 shell 上传函数离线回读。

正向：工作流快照 → 分片命名 → 同路由上传/回读 → 固定清单发布 → 恢复端同名路由 → SHA 验证 → 非空 JSON。反向：恢复 JSON → 已校验包/分片 → 原清单 SHA/同 batchId → 原上传函数 → 快照。两工作流、旧仓、失败中断、另一恢复路径均纳入回归。

## 分层完成状态

需求边界、入口、生产、契约转换、服务失败处理、存储兼容、离线真实消费者、静态回归：已验证。
真实生产链：部分完成，尚未运行新版本线上备份，不以合并/部署代替备份成功。

## 命令与原始结果

- 目标 8 文件 vitest：`Test Files 8 passed (8); Tests 58 passed (58)`。
- trendStore mergePrune、schedulerState、HotWindow、splitGzip、verifyGrowthMonotonicScript：`Test Files 5 passed (5); Tests 27 passed (27)`。合计 85 项。
- `pnpm check` 初始通过；新增测试首轮遇 ES5 迭代类型错误，已改 Array.from，最终 `pnpm exec tsc --noEmit --incremental false` exit 0。
- `pnpm build` 最终 exit 0；`pnpm exec vite build`：3578 modules，built in 40.00s，exit 0。保留既有 chunk 提示。
- 两个 YAML 解析与所有 run 的 `bash -n` 均通过；新 mjs 的 `node --check`、Prettier 检查及 `git diff --check` 通过。

## 未验证与限制

- 未手动触发线上备份、未恢复覆盖生产数据、未做付费模型调用；下一次定时备份仍须核对新仓附件及回读成功。
- 前台持续繁忙仍会让行/退出；机器重启可能中断当班任务，但无法解释已确认的 Release 1000 附件错误。
- 旧仓满额但现有固定名附件可原位更新；以后新增固定名种类须另审容量。新批次若单批超过 1000 分片仍受 GitHub 硬上限，当前实际体量未到此规模。
- 新日仓/批次仓不设自动删除，旧历史资产不搬迁、不删除。生产版本检查失败则本轮明确退出，等待部署完成后的下一班。

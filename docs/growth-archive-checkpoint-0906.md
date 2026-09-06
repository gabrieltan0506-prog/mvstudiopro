# Growth 归档重复超时修复（部分验证，未线上运行）

## 事实

- PR1395 已合并；本次不是未部署旧修复。Run 33996402402 的主快照、GitHub artifact、冷备 Release 发布回读成功，归档下载从 8 月 29 日跑到 9 月 5 日，最终被 30 分钟整步上限终止。33990323845 同样重复下载历史目录后超时。33997564567 因真实前台忙标记重试 20 次后失败；33988322210 在前台优先评估阶段持续未就绪。
- Fly 机器 d892541f602228 当前 started、健康 passing；1397 对应部署 34004778229 success。01:52:17Z 换版健康失败至 01:52:36Z 恢复，不能把这段部署切换当成此前备份失败根因。
- 新磁盘探针只读实查：TOTAL_BYTES=11527036928、AVAILABLE_BYTES=4790038528、ARCHIVE_BYTES=4072221546。未满盘；没有重启或扩容。

## 修改与跨层证据

|层|状态|证据|
|---|---|---|
|需求与边界|已验证|限备份/归档两条workflow，源删除仍 false，不改采集、模型、积分和服务权限|
|入口|已验证|两条定时/手动入口均调用 growth-archive-plan.mjs，共用原串行组|
|生产|已验证|原 prepare 在采集锁内创建硬链接快照和源指纹；两入口实际下载脚本离线生成非空 gzip/tar|
|契约转换|已验证|单目录 schemaVersion 1 新增 sourceFingerprint；生产 parseGrowthArchiveColdManifest 消费；旧无指纹清单重备，损坏或摘要不符不能跳过|
|服务副作用|部分完成|保留前台让行、单次15分钟/无进度2分钟保护，下载预算20分钟；本地故障与取消回归，未运行生产写入|
|存储恢复|部分完成|逐目录 manifest 与 tar GitHub资产摘要共同作续传凭证；真实脚本本地上传/回读后下一轮跳过，GitHub API和清单下载只读实测；未生产上传实跑|
|消费展示|部分完成|摘要区分已验证复用、本批计划、未处理积压、繁忙延期和实际发布数；生产恢复解析器接受新清单；未线上批次最终展示|
|静态回归|已验证|目标测试、类型、服务端构建、两YAML共21段bash语法、完整diff检查，见执行记录|
|真实链路|部分完成|Fly健康/磁盘、GitHub状态/摘要/清单读取已实测；没有重跑workflow，没有线上归档发布/恢复实跑|

正向：两入口 → 全量 snapshot.tsv → GitHub现存资产/旧manifest → selected.tsv → tar/gzip/SHA → 上传并回读 → 每目录manifest携带源指纹 → 实际发布摘要。
反向：下轮复用 → 验证manifest自身GitHub摘要及稳定tar的bytes/SHA → 比较源指纹 → 追到同目录snapshot.tsv；凭证缺失、老版本或资产被覆盖均重新备份。原 offload-manifest 保持本批语义，恢复端读稳定的每目录 manifest。源数据不删，失败重试不涉及扣费。

每批最多12目录且按未压缩估算约512MiB预算；单个超大目录独立处理，不静默丢弃。下载期间繁忙则发布已完成子集，其余明示延期。网络错误与gzip损坏仍报失败。已发布旧目录下轮跳过，不再因保留源数据每次重传全部历史。

## 执行记录与限制

- `pnpm check`、`pnpm build`：补齐 mjs 类型声明后均退出0；初次缺声明的失败已修复，不隐去。
- `pnpm exec vitest run`：growthArchivePlan、growthArchiveTransfer、growthArchiveWorkflowSafety、growthArchiveColdStore、growthWorkloadPriority 5 个文件 45 项通过，17.71 秒。
- 两workflow `yaml.safe_load`、全部 `bash -n` 21段、`node --check`、远端脚本 `sh -n`、`git diff --check` 通过。
- `fly ssh ... -C 'sh -s' < scripts/growth-storage-pressure-remote.sh` 只读实查通过（原值见上）。旧 workflow 的双引号使 `$()` 在 GitHub runner 展开，新版通过 stdin 发送脚本，只在 Fly 读取 /data。
- 规划CLI使用真实GitHub API、分页资产摘要、旧manifest下载成功；仅输入空测试清单验证读链，不代表生产归档已全部备完。
- 未运行生产备份/归档发布、完整数据恢复、全仓测试、Docker或前端构建；本次不改依赖与前端。
- 已有旧清单没有源指纹，需逐批补一次；持续前台负载仍可能延期，摘要不会冒称积压清空。空间保持源数据保留策略，不自动释放。

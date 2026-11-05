# 空归档覆盖修复与验证

## 故障与修复

逐文件清理保留空日期目录；旧 prepare 把目录存在和 du 块大小当作有效候选，旧下载检查只证明 gzip/tar 能读取。两条 workflow 在生产恢复检查前用 `gh release upload --clobber` 覆盖稳定同名 tar 与 manifest，因而恢复失败虽然阻止删源，旧冷备已经被替换。

- prepare 排除空树，仅选择日期桶中的非零普通 `.json.gz`，快照字节改为文件逻辑字节；bundle 再次检查。旧空树指纹或零字节清单不进入规划。
- 两入口统一使用只读 Python 验证器：完整外层/内层 gzip、tar 路径、类型、重复成员、JSON 与 `items` 数组。允许符合现有恢复契约的空 `items` 数组，但整个包必须包含数据文件。链接、特殊文件及非合同文件拒绝。
- 全批内容、源逻辑字节、完整包和每个分片摘要先通过，再进行远端写入。现有旧仓和日仓同名内容冲突时整批拒绝。只新增上传，不使用覆盖或删除；完全相同的附件回读验证后复用。上传回执丢失时失败退出，下轮重新枚举。
- 每桶 manifest 保持 schemaVersion 1 和稳定命名；批次 manifest 改为唯一名称，置于独立 `growth-archive-batch-<run>-<attempt>` 仓，保留原本地 offload-manifest.json 给 artifact 和删源凭证使用，不累积占用旧仓1000附件限额。
- 生产恢复CLI、分片禁删、最新两桶、collection lease、源指纹保护不削弱。恢复与最新桶SSH读取显式绑定 `/dev/null`，防止吞掉循环中的下一目录。

## 可复现隔离测试

```sh
node --test scripts/growth-archive-publication.test.mjs
python3 scripts/validate-growth-archive.test.py
pnpm exec vitest run server/growth/growthArchivePlan.test.ts server/growth/growthArchiveWorkflowSafety.test.ts server/growth/growthArchiveColdStore.test.ts server/growth/growthArchiveTransfer.test.ts server/growth/growthColdStoreRelease.test.ts
```

新增PR检查在Ubuntu/Node24/Python3.12运行无凭证测试。外部GitHub/Fly调用替换为隔离边界；实际候选、打包、验证、发布器、YAML恢复/删除步骤使用生产代码。覆盖空树、正常资料、损坏gzip/JSON/schema、穿越/链接/重复成员、源改变、同名冲突/竞态、上传中断、回读损坏、旧仓满容量及恢复失败零删源。

## 边界与恢复顺序

- 未对历史手工大备份进行下载、解包还原；远端附件大小和摘要不等于可恢复。既有备份与清理回执保留。
- 新发布器遇到历史冲突不会自动修复、删除或覆盖，需要另行明确恢复源与目标，再做隔离还原验证。
- 当前快照仍是hardlink加metadata fingerprint，不承诺抵抗绕过collection lease且同时保持元数据不变的写入。大于2GB分片仍保留来源。
- 主体 current 快照是可变的“最新”指针，沿用既有发布协议；本次不可覆盖规则覆盖 archive 及其manifest，不把 current 历史版本化冒充已完成。
- 暂停的两条备份排程在本批审查/测试及合并确认后恢复并回读状态；数据API采集与备份排程单独核验，不能混为同一开关。

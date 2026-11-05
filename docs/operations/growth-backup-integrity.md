# Growth 冷备完整性与受控清理

本次代码修复覆盖五平台的已列明数据：抖音、小红书、Bilibili、视频号（旧 native 与 Guaikei wechat）、TikTok（Guaikei）。快手、头条退出新备份范围；历史来源按单独批准的精确清理清单处理，已有远端备份保留。共享 API 原始账本保留原样，可能包含退出平台记录。`fullStoreComplete:false` 表示还有其他业务目录未覆盖，不能据此清理。

## 发布与恢复

- 两条备份 workflow 共用锁、逐文件内容清单与哈希。空目录不参与发布；gzip/JSON/items 异常保留整个桶并报告，健康桶继续。
- 普通备份写不可变 generation；归档同名冲突写内容版本，最后切指针。上传前完整解析与校验，上传后核对 GitHub 已上传状态、大小、SHA-256，不再次下载整包。`remoteRestoreVerified:false` 必须保留，不把 metadata 核对当成还原证明。
- 恢复器验证所有分片、拼接后的摘要、tar 路径与类型、JSON/items 和完整成员清单；已有缓存也重验。损坏缓存移旁保留，失败不会被当成空数据。
- 普通还原包的 `paid-research/guaikei/.growth-offline-restore` 标记使 Guaikei 提交、轮询及自动调度拒绝运行。原始账本、配置、回执不改写；无标记的现有正式采集行为不变。不要直接把还原包覆盖到活动数据目录，也不要删除标记后启动采集。写回活动数据须另行执行知识库中的冻结、快照、同锁和验收流程。

## 上线前置条件（本 PR 不配置或部署）

1. Actions 使用 `GROWTH_BACKUP_REPOSITORY` 与 `GROWTH_BACKUP_TRANSPORT=fly`，通过既有 Fly SSH 身份转发备份操作；专用 `GROWTH_BACKUP_GITHUB_TOKEN` 只存 Fly，默认仓库为 `gabrieltan0506-prog/mvstudiopro-growth-data`，必须核实私有且可写。没有凭证时明确失败，不退回公开仓库。
2. Fly 服务端需有同名仓库与 token 配置，以及 `GROWTH_GITHUB_PRIVATE_COLD_STORE_BASE_URL`。原公开 URL 仅作明确 404 后的历史读取回退；403/不明状态不回退。
3. 先让正式读取器具备新格式能力，再放行备份。workflow 的服务端门禁核代码与配置、私有仓库 metadata 读取，不宣称真实还原成功。
4. 合并前核实在途任务与部署；上线后另行做最小真实备份、还原与用户验收。既有手工分片只有大小/哈希记录，尚无实际还原证明。

## B 站历史来源清理

旧整目录删除入口关闭。两条备份 workflow 在本批发布成功、释放临时硬链接后，调用 Fly 内受控清理入口：本批待清理归档实际还原成功、远端 metadata 再核对通过，才能按该次回执哈希逐文件清理 B 站来源。已确认存在的旧备份也生成有界复用清理输入，不能因为“不需要重新上传”就永远不回收历史来源。最新两桶、其他平台、未知文件、原始备份均保护。

用户已允许仅在 Fly 内读取本次待清理归档进行还原核验；不下载到用户电脑，不读取整份历史备份。工作流只传送本批清单与原始 manifest 字节。清理输入、还原回执和逐文件日志永久保留在源目录外；本次新建的临时还原副本在记录后清理，避免失败验证反复占盘。失败不冒充清理成功，返回部分结果供继续核查。

以下手动命令供核查和处理失败批次，正常自动链路使用 `growth-archive-retire.mjs`。命令仅说明经批准后在 Fly 服务端执行的接口，本次修复/测试没有运行它们处理正式数据。凭证仅从 Fly 环境读取，不复制到本机。`BATCH_ROOT` 是保留了本批 `offload-manifest.json`、`publication-result.json` 和 `assets/*.manifest.json` 的目录，不是源数据目录。

1. 在得到远端还原下载授权后，执行 `node scripts/growth-archive-cleanup.mjs BATCH_ROOT CACHE_PARENT --allow-remote-download`。只读指定不可变版本、实际还原并生成 `cleanup-receipt.json`；不删除来源，不替操作者批准。
2. 执行 `node scripts/growth-archive-delete-verified.mjs --root /data/growth --receipt RECEIPT` 查看候选与大小。默认 dry-run 不创建锁、不删来源；无远端核对时明确标记 `evidenceVerified:false`。
3. 人工审阅文件范围和回执 SHA 后，另获本次删除批准，再加 `--apply --approve-sha256 HASH --journal NEW_JOURNAL_OUTSIDE_STORE`。执行时重新查询远端 metadata，取得采集与变更双锁，预验全部文件，每次 unlink 前再核身份/内容和取消状态，并逐笔持久化日志。
4. 删除前持久化 `.growth-archive-retired` 桶标记，后续快照不发布该桶的残余子集，保护包含已删来源的完整冷备。损坏标记也隔离处理。中断日志区分已删与未删；必须核对原回执和标记，不得用不同回执哈希绕过保护。原始还原和删除回执保留。

目录不递归删除。硬链接仍被快照引用时，unlink 的逻辑字节数不等于实际释放空间；只有正式执行前后的文件系统用量能证明释放量。本 PR 的 B 站自动退役尚无正式执行或空间释放结果。

## 本地验证边界

测试使用隔离临时目录和合成 Fly/GitHub 传输边界，执行实际 YAML、打包、发布、还原与清理函数。不会把模拟 metadata、合成还原或测试通过写成生产验收。CI 不含真实 API token、不调用付费模型、不启停机器、不删除正式数据。

## 已退出平台的历史数据

快手、头条已获单独的本地历史删除授权，远端备份保留。`growth-excluded-platform-cleanup.mjs` 默认只生成清单；执行必须指定清单哈希及源目录外的新日志。仅识别专属文件和已知历史目录层级，不删除共享账本、其他平台或目录。应用前双锁、全量预验，再逐文件核身份和哈希；来源改变时停止并留下部分结果。文件系统前后观测可能含其他任务并发写入，必须同时报告文件逻辑大小。

旧平台显式查询不会再触发其专属冷备读取；历史类型与远端原件仍保留。为活动平台校验旧混合归档时，完整性缓存仍可能包含退出平台成员，不代表这些成员恢复为活动数据。

## 服务端凭证转发

工作流解析明确的 app 机器后才做私有仓门禁。runner上的规划与发布通过窄范围网关请求Fly：只允许目标私有仓的release metadata、manifest读取、不可变附件上传及最后的指针替换。上传使用SSH文件流，服务端临时文件经长度/摘要核验后上传；临时文件只清理本调用创建的目录。GitHub token不传回runner、不写本机、不放入Actions secret。网关不安装程序、不改机器配置、不启停机器。

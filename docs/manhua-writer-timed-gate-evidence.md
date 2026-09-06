# 原稿导入与确认门禁衔接 · 2026-09-06

续工说明：本文件保留首轮回执；夜间继续修正了导入丢集、区块真源分歧和动作280字截尾，最新范围与验证以 `docs/manhua-0906-late-import-evidence.md` 为准。下文“280字符上限未改”是首轮历史状态，已被夜间增量覆盖。

结论：部分完成。六列秒位原稿的格式误判已在本地修正；真实《墨菁传》仍缺人物、道具、场景表，未获准生产。没有提交、推送、PR、合并、部署或付费调用，也没有改写用户原稿和线上草稿。

## 改前证据与边界

当前工作分支 `feat/manhua-director-dialogue-engine-0905`，基点 `3deb480`，开工时工作树干净。用户授权修复原稿解析与确认门禁，不授权降低资产/密度门槛或自动补写设定。

| 项 | 证据与边界 |
| --- | --- |
| 最终结果 | 已有秒位原稿可被正确校验并交给实际分镜生产者；不能误报缺段01，不丢原镜和尾句 |
| 真实入口 | `OmniCanvas.importWriterRoomFromText`（粘贴/文件）；`confirmWriterToDirector`（多个确认按钮、扩写后复核）；`confirmWriterSeriesSpawn`（批量） |
| 生产者 | `importManhuaWriterPackFromText` 产生 `episodes[].body`；《墨菁传》真实三集文件提供六列原文 |
| 原断点 | 门禁只调用 `parseManhuaEpisodeSegmentPlanFromMarkdown`，读不到六列表；下游 `parseWorkbenchShotsFromText` 已支持六列 |
| 转换/存储 | `composeWriterPackFactoryContext` → `spawnManhuaDramaStudio` → 节点正文；`manhuaWriterSession`、`manhuaCloudDraft` 保存恢复原包 |
| 消费者 | `resolveShotsForEpisodeKeyarts` → 工作台、静帧、自动分段、片段编译；共用表头与原始行，节选预览不套整集完整性门槛 |
| 权限/费用 | 确认失败在任何铺点/写状态前返回；本次只改纯读取与校验，无 API、队列、账本、路由改动。既有付费生成仍需另行确认 |
| 失败恢复 | 不迁移旧稿、不回写线上；失败保留原包/媒体。既有旧链归档、导入备份、参考图认领路径未改 |
| 已知断点 | 真实三集文件没有资产表；不能从六张未认领参考图猜角色，也不能把缺资产绕过去 |

## 实际修改文件

- `shared/manhuaTimedStoryboard.ts`：无副作用的共同读取器，保留每行，报告缺列、坏秒位、间隙/重叠、镜号问题及空字段。
- `shared/manhuaScriptWorkbench.ts`：消费共同读取器，移除第二份六列表头/列映射；保持局部节选、无对白、字幕与声音列的原口径。
- `shared/manhuaWriterAssetCanon.ts`：实际原稿模式按秒位表校验，不再要求伪造“段01”；新写作 layout 和旧段表、资产/密度检查不变。混有两份结构时明确拒绝，避免下游优先选旧段表。
- `client/src/lib/manhuaWriterTimedGate.test.ts`：导入、完整消费、两种真实按钮失败回调、坏行、空表、混合真源、本机和云恢复回归。
- 本证据文件、`.cursor/knowledge/PROGRESS.md`、`.cursor/knowledge/kb/line-canvas.md`：记录真实状态和未验项。

## 双向追链与原始结果

正向：原文 → 导入包 `episodes[].body` → 两个按钮共用 `evaluateWriterPackAssetAndDensity` → `readManhuaTimedStoryboard` → 保留整段原文的工厂上下文 → 铺点 → `resolveShotsForEpisodeKeyarts` → 同一读取器 → 按当前引擎分组。

反向：末镜动作及编号 → 分组内原镜 → 工作台分镜 → 铺点时的本集正文 → 原始导入包的同集 `body`。未新增 schema 或持久字段，不用空生产者、默认骨架或旧段表替代真实原稿。

只读真实文件探针（脚本在 `/private/tmp/mojing-word-0906.mfiewQ/import-gate-after.mts`，日志 `/private/tmp/manhua-import-gate-real-source.log`）输出：

```text
第1集 rows=29 errors=[] consumerShots=29 segments=11 seconds=130
末镜：水洼里曹三倒影，鹌鹑鹰隼扑腾（余味镜）
第2集 rows=29 errors=[] consumerShots=29 segments=11 seconds=135
末镜：檐下，黑奇望着远处山影，竖瞳微眯（余味镜）
第3集 rows=29 errors=[] consumerShots=29 segments=11 seconds=145
末镜：门上符钉留下的焦痕里，抽出一根新藤，开出小白花（余味镜）
quotesPreserved=65 gatePassed=false paidCalls=0
remainingBlockers=人物表至少2名、场景表至少1个、道具表至少1件
```

探针调用纯铺点函数只是验证消费者，未绕过线上按钮生成。自动分组使用当前 Mini 档；三集都11段，时长不同。测试中的145秒/10段是另一份合成输入，不能混称真实原稿结果。

## 验证回执

首轮测试发现局部节选被整集检查误挡（3镜退成18镜骨架），已修正为读取与整集校验分离，旧节选测试恢复通过。新增测试最初写错批量回调名称而失败，已改成实际 `confirmWriterSeriesSpawn`，不以复制回调替代生产入口。

命令均在本工作树执行，未加载生产凭证：

```text
./node_modules/.bin/vitest run client/src/lib/manhuaWriterTimedGate.test.ts shared/manhuaScriptWorkbench.test.ts shared/manhuaWriterAssetCanon.test.ts shared/manhuaOriginalSegmentQuality.test.ts shared/manhuaWriterRoom.test.ts shared/manhuaWriterSession.test.ts shared/manhuaCloudDraft.test.ts client/src/lib/manhuaWriterImportState.test.ts client/src/lib/canvasDramaStudio.test.ts shared/manhuaSeedanceLayout.test.ts client/src/lib/manhuaAutoSegmentFactory.test.ts client/src/lib/manhuaAutoSegmentUi.test.ts
Test Files 12 passed (12)
Tests 219 passed (219)
Duration 3.75s
退出0；日志 /private/tmp/manhua-import-gate-final-target.log

./node_modules/.bin/vitest run
Test Files 2 failed | 511 passed | 2 skipped (515)
Tests 2 failed | 4856 passed | 4 skipped (4862)
Duration 86.20s
退出1；日志 /private/tmp/manhua-import-gate-full.log

./node_modules/.bin/tsc --noEmit --incremental false
退出0，无输出；日志 /private/tmp/manhua-import-gate-types.log
末尾移除未使用局部变量后另跑同命令，退出0、无输出，日志 /private/tmp/manhua-import-gate-final-types.log

./node_modules/.bin/vite build
3547 modules transformed; built in 40.52s
退出0；日志 /private/tmp/manhua-import-gate-vite.log
保留既有大于500kB包警告

./node_modules/.bin/prettier --check shared/manhuaTimedStoryboard.ts client/src/lib/manhuaWriterTimedGate.test.ts
All matched files use Prettier code style! 退出0
git diff --check
无输出，退出0
```

全仓仅两条 `manhuaNativeDeepReadBatchCli.test.ts` / `manhuaNativeDeepReadProbeCli.test.ts` 的7201秒上限断言失败，实际返回退出0、测试要求非0。重新在既存主线源码快照 `/private/tmp/manhua-pr1384-base-review.gPUU8D` 执行这两个文件：61通过、2失败，16.55秒，退出1，日志 `/private/tmp/manhua-import-gate-baseline.log`。该目录不是Git工作树；用 `git hash-object` 对照 `f0edf9f:path` 核验两份测试及两条CLI脚本的blob均逐一一致，不把无法执行的 `git rev-parse HEAD` 当身份凭证。未修改冻结学习链或旧断言。

全仓与Vite运行后仅做了格式整理和移除旧解析留下的未使用局部变量，最终219项定向与最终类型检查另验；不声称最后文件版本重新跑过全仓/Vite。依赖版本实跑输出为Vite7.1.9、Vitest2.1.9；未新增依赖，未做独立lint（项目无lint脚本）或干净Docker/CI构建。

## 九层完成状态审计

| 层 | 状态 | 证据/限制 |
| --- | --- | --- |
| 需求与边界 | 已验证 | 只修格式契约，不改价格、权限、路由、学习冻结项或原文 |
| 入口交互 | 部分完成 | 执行两处真实 TSX 失败回调，缺资产不解锁；未做本增量在线 Chrome 点击 |
| 数据生产 | 已验证 | 真实三集87镜、65处对白，原文件无资产表 |
| 契约转换 | 已验证 | 共同读取器、坏末行与混合真源拒绝、旧段表/新写作兼容；原稿不改写 |
| 服务副作用 | 部分完成 | 纯读取，无新服务/收费动作；未做真实队列或扣退测试 |
| 存储恢复 | 部分完成 | 本机和云序列化函数回归保留包；未做线上刷新/跨设备操作，无迁移 |
| 消费展示 | 部分完成 | 实际纯工厂读取完整末镜及秒数；没有真实静帧、轨迹底图、成片画质证据 |
| 静态回归 | 部分完成 | 以最终命令回执为准，不把已知失败藏成全绿 |
| 真实链路 | 阻塞 | 缺资产表、未发布；未做线上实跑，未触发任何新付费 |

## 剩余风险与需要决定的事项

1. 缺资产是资料缺失，不是格式 bug。继续需要作者确认的资产表；从原稿新整理候选表属于下一步创作工作，不擅自确定外形、三态图或认领关系。
2. 字数、对白、场景命中等既有密度要求保持不变；补齐资产后仍须重验，不承诺任意原稿自动达标。
3. 旧已确认草稿不自动改写或清除确认；需用户重新确认后才应用本门禁。原有下游280字符动作上限等邻接合同未改，本真实原稿未命中此上限；不是任意长单元格无损承诺。
4. 本地依赖沿用已有安装，未新增依赖；未做干净 Docker/CI 安装。大包警告及全仓遗留失败照实记录。
5. 发布须用户明确授权相应 Git/远程动作；本轮不操作 Chrome 窗口、不重启、不部署。发布与资产确认后再继续真实轨迹验收，付费生成另行确认。

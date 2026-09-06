# 漫剧工厂夜间续工：原稿导入与生产契约

日期：2026-09-06。状态：部分完成，未发布、未做线上实跑。

用户要求暂停小说修改，继续漫剧工厂施工。本轮保留既有本地门禁修复，继续排除原稿被静默丢集、截尾或错列的断点；不替作者确定小说版本、资产表或图像认领，不提交、推送、建 PR、合并、部署或付费生成。

## 改前证据表

| 检查项 | 事实、边界与断点 |
| --- | --- |
| 最终结果 | 导入文件的真实分集与逐镜动作进入同源确认、静帧和成片编译；超限明确拒绝，不假装完整 |
| 当前工作树 | `/private/tmp/mvstudiopro-dialogue-director`，`feat/manhua-director-dialogue-engine-0905`，HEAD `3deb480`；开工时已有 7 个本任务未提交文件，全部保留 |
| 真实入口 | `OmniCanvas.importWriterRoomFromText` 被粘贴、文件、导入引用共用；确认分单集 `confirmWriterToDirector` 和批量 `confirmWriterSeriesSpawn` |
| 生产者 | `importManhuaWriterPackFromText` → `episodes[].body`；真实三集文件提供 87 个原镜 |
| 已证断点 | 逐镜动作截在 280 字；门禁读全文但工作台优先“分镜表”区块；转义竖线错列、缺行首末镜被跳过；扩写集数被用作导入截取数；空集/过量分集会被过滤或截取 |
| 转换及存储 | 编剧包 → 当前 canon/Bible → 工厂上下文/节点 → 本机及云序列化；不新增字段或迁移旧记录 |
| 最终消费者 | `resolveShotsForEpisodeKeyarts` → 静帧、自动段、动作/对白提示词、源修订身份；工作台使用同一分镜生产者 |
| 费用/权限/恢复 | 本轮都是读取、校验与编译。API、worker、供应商、价格及账本未改；取消/失败不写状态，成功重铺保留旧付费片为归档 |
| 验收边界 | 测试中的资产和网址为虚构数据；真实《墨菁传》仍缺已确认资产表。离线回调不是线上 Chrome，编译内容不是模型画质 |

## 实际修改文件

生产代码四个文件：

- `shared/manhuaTimedStoryboard.ts`：共用区块选择与秒位表读取；识别转义竖线、列数、缺行首；完整原镜落在所选分镜区块外时拒绝确认。
- `shared/manhuaScriptWorkbench.ts`：读取同源区块/表；去掉动作字段 280 字截尾。原有运镜中文化、无对白与字幕口播区分保持。
- `shared/manhuaWriterAssetCanon.ts`：保留上一轮秒位门禁修复；资产/密度要求及新写作 layout 合同不放宽。
- `shared/manhuaWriterRoom.ts`：导入遵循实际集数，不受扩写设置截尾；保留原六集上限，超限明确拒绝；空正文明确拒绝；分集标题不跨行吞正文，标题字段中的“第01集”不重复当新集。

测试三个文件：`client/src/lib/manhuaWriterTimedGate.test.ts`、`client/src/lib/manhuaWriterImportState.test.ts`、`shared/manhuaWriterRoom.test.ts`。

记录四个文件：本文件、`docs/manhua-writer-timed-gate-evidence.md`、`.cursor/knowledge/PROGRESS.md`、`.cursor/knowledge/kb/line-canvas.md`。

## 双向追链与邻接检查

正向：粘贴/文件 → 真实导入回调 → 实际解析器的完整 `episodes[].body` → 当前资产 canon/Bible → 单集/批量真实确认回调 → 实际纯铺点函数 → 同源原镜 → 静帧与成片编译。

反向：第一镜动作末尾与第29镜对白 → 编译后静帧/成片 prompt、源修订 → 原镜 action/dialogue → 本集正文 → 导入包。两个确认回调测试都验证当前资产姓名、旧付费片归档，以及实际云清洗和恢复后的29镜/145秒/末句。

长动作只改第280字之后的结尾，静帧与成片同时出现新结尾，自动段源修订随之变化；不是只断言字段存在。三集导入的真实回调在 `episodeCount=2` 时回填为3，恢复后第三集仍在。七集拒绝发生在换剧备份和任何 setter 之前；批量取消零铺点、零保存、零解锁。

另一按钮、扩写后复核共用 `evaluateWriterPackAssetAndDensity`；局部节选继续允许预览，不把整集完整性门槛用于节选。旧有段表、字幕非口播、繁简/标题别名及造型/轨迹/自动段恢复均纳入回归。

不会双扣：未改或新增任何 API/job/扣费调用，确认只铺节点。不会静默覆盖旧片：两个真实确认回调调用原归档函数，测试核对旧片 URL 和归档状态在云恢复后仍保留。空资产仍由原门禁明确拒绝，未添加假表或默认选图。

## 复现与真实原稿

先复现6项失败：区块外另一份秒位稿、区块外第30镜、长动作截尾、转义竖线错列、漏行首、额外单元格。修复后相关48项通过。

新增确认成功回归最初错误使用资产字段 `name`（实际为 `nameZh`），纠正测试后通过；没有因此改生产模型。新增导入计数用例最初文本短于既有120字就绪线，补足测试正文；未放宽产品门槛。导入加固首轮影响了外部格式的“标题字段”，已补排除规则并恢复原繁体/别名回归。空 `### 本集剧情` 的测试另先失败后通过。

真实来源：`/Users/tangenjie/Downloads/2026Sep03/驮兽开口-制作包/01-剧本-三集全-待改对白.md`。只读实跑输出：

```text
episode=1 rows=29 errors=[] consumerShots=29 segments=11 seconds=130
episode=2 rows=29 errors=[] consumerShots=29 segments=11 seconds=135
episode=3 rows=29 errors=[] consumerShots=29 segments=11 seconds=145
quotesPreserved=65 gatePassed=false paidCalls=0
remainingBlockers=人物表至少2名、场景表至少1个、道具表至少1件
```

日志：`/private/tmp/manhua-0906-late-real-source.log`。通过纯工厂函数仅核查消费，没有越过线上资产门禁。

实际原稿的两集设置前后比较：`/private/tmp/manhua-0906-import-count-real-comparison.log`。旧源码快照的 `shared/manhuaWriterRoom.ts` blob 与 `f0edf9f` 相同：`932d81fde32ff4936a4d64aea4f929b4279a9f5b`；快照不是 Git 工作树，不能把目录名当提交证据。同一文件、同一 `episodeCount=2` 参数，旧版只得到两集（正文2033、2123字），当前得到三集（2033、2123、2031字），第三集“认主”不再消失。

## 命令与原始结果

本轮最终代码的专项命令：

```text
./node_modules/.bin/vitest run client/src/lib/manhuaWriterTimedGate.test.ts shared/manhuaScriptWorkbench.test.ts shared/manhuaWriterAssetCanon.test.ts shared/manhuaOriginalSegmentQuality.test.ts shared/manhuaWriterRoom.test.ts shared/manhuaWriterSession.test.ts shared/manhuaCloudDraft.test.ts client/src/lib/manhuaWriterImportState.test.ts client/src/lib/canvasDramaStudio.test.ts shared/manhuaSeedanceLayout.test.ts client/src/lib/manhuaAutoSegmentFactory.test.ts client/src/lib/manhuaAutoSegmentUi.test.ts client/src/lib/manhuaWorkbenchShotSource.test.ts shared/manhuaCameraLanguageZh.test.ts shared/manhuaClipDialogueTimeline.test.ts
Test Files 15 passed (15)
Tests 267 passed (267)
Duration 7.40s
退出0；/private/tmp/manhua-0906-late-target.log

./node_modules/.bin/tsx /private/tmp/mojing-word-0906.mfiewQ/import-gate-after.mts
退出0；真实数据见上文

./node_modules/.bin/prettier --check shared/manhuaTimedStoryboard.ts client/src/lib/manhuaWriterTimedGate.test.ts client/src/lib/manhuaWriterImportState.test.ts
All matched files use Prettier code style! 退出0
git diff --check
无输出，退出0
```

最终类型、全仓与Vite均在生产代码最后一次修改之后运行：

```text
./node_modules/.bin/tsc --noEmit --incremental false
退出0，无输出；/private/tmp/manhua-0906-late-final-types.log

./node_modules/.bin/vitest run
Test Files 2 failed | 511 passed | 2 skipped (515)
Tests 2 failed | 4872 passed | 4 skipped (4878)
Duration 139.68s
退出1；/private/tmp/manhua-0906-late-full.log

./node_modules/.bin/vite build
✓ built in 19.52s
退出0；/private/tmp/manhua-0906-late-vite.log
仍有既有超过500kB的大包警告。
```

两个失败均为 `server/services/manhuaNativeDeepReadBatchCli.test.ts` 和 `server/services/manhuaNativeDeepReadProbeCli.test.ts` 中7201秒上限断言：当前实现允许，旧断言要求拒绝。与首轮同源基线已复现的两项完全相同，本轮这两份测试与CLI没有 diff，未修改冻结学习链或删除测试。基线重跑回执见首轮证据文件。本机Node为24.13.1，TypeScript5.9.3，Vitest2.1.9；未用供应商凭证或发出真实模型请求。

## 九层完成状态审计

| 层 | 状态 | 证据与限制 |
| --- | --- | --- |
| 需求边界 | 已验证 | 只修原稿完整消费；不改小说、不放宽资产/容量/计费、不碰学习链 |
| 入口交互 | 部分完成 | 执行导入、单集确认、批量确认生产回调，成功/失败/取消均验；未做线上点击 |
| 数据生产 | 已验证 | 真实三集87镜、65对白；无已确认资产表的事实保留 |
| 契约转换 | 已验证 | 错列/空集/超限/混稿拒绝；长动作末尾进入实际静帧和成片编译 |
| 服务副作用 | 部分完成 | 无新服务/账本改动或调用；真实队列/扣退未实跑 |
| 存储恢复 | 部分完成 | 生产序列化/云清洗保留第三集、当前资产及归档旧片；线上跨设备未验 |
| 消费展示 | 部分完成 | 工作台同源、末镜/末句/修订有具体断言；没有新图、视频或实际画质证据 |
| 静态回归 | 部分完成 | 专项已通过；其余以最终命令回执为准，不把既有失败藏成全绿 |
| 真实链路 | 阻塞 | 缺已确认资产、未发布、未做线上实跑；不等于整个工厂完成 |

## 残余风险与后续授权

1. 保持原有六集、八万字输入限制；本轮只令超限明确失败，没有扩容。旧无秒位表仍沿原解析/门槛，未改变已确认旧草稿的存储或自动迁移。
2. 超280字动作不再在逐镜解析处截尾，不等于任意长度都能通过供应商输入上限或保证生成质量；实际模型、超长片段质量需另行付费验收。
3. 新稿仍待作者明天选择/修改，不能据候选小说偷偷替换线上稿或认领图片。新资产必须确认后才能接真实静帧与轨迹验收。
4. 没有新增依赖；沿用本机安装，没有独立lint脚本，未做干净Docker/CI安装构建。
5. 本轮未提交、推送、开PR、合并或部署。远端main只读查为 `dc9e898`，相对当前HEAD的变化未触及本轮生产代码，只有进度文档交叠；并不代表已做主线整合或最新线上验收。
6. 同段三态有序引用、编辑前后与指令的三方质检、完整视频/SRT/音轨交付包及真实后期扣退，不在本轮已验范围；不能将本次导入修正缩窄成“整个工厂完成”。下一步需要发布动作的明确授权，以及作者确认原稿/资产后进行真实链路验收。

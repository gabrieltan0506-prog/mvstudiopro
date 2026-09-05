# 第二批发布收口证据

## 改前证据表

| 层 | 当前事实与本次边界 |
| --- | --- |
| 结果 | 合成后字幕依据实际剪辑时间轴，且只用于该成片版本；合成请求必须有登录身份和任务账本。 |
| 入口 | ManhuaClipDock → OmniCanvas.assembleManhuaFinal；剪辑台 → handleBurnSubtitle；另有同步调试入口。 |
| 生产者 | 分镜 outputText 产生对白；renderSourceAudioFinal 的 ffprobe/裁切/转场产生实际秒位；禁止拿节点待生成 prompt 冒充对白。 |
| 转换 | collectManhuaAssembleClipsFromDock → buildManhuaAssemblePlan → service → renderer；字幕来源随源片、原镜号和剪辑顺序传递。 |
| 存储 | jobs.input/output 保存请求快照及渲染回执；manhuaFinalVersions 按 URL/job 保存每版字幕；本机、云草稿和版本恢复共用规范化。 |
| 消费 | 烧字读取选中成片的字幕回执，不读取当前新稿计划字幕；旧片缺回执明确提示，不伪造对时。 |
| 副作用 | 不新发模型请求，不修改价格；移除合成隐式配乐，复用配乐间确认流程。鉴权/账本由并行子任务负责。 |
| 恢复 | 原片及旧版本保留；字幕迟到归档，不覆盖当前新版；失败不删除任何模型 JSON。 |
| 已知断点 | 计划4秒字幕可对应实际8秒成片；旧成片会误用新稿字幕；匿名合成及客户端先扣费缺任务绑定。 |
| 验证 | 新增真实 FFmpeg 时间轴断言、字幕版本/草稿往返测试、HTTP/worker拒绝前零副作用；类型、完整diff与构建。线上验收另记，不以本地替代。 |

本次不修改学习模型、提示词、冻结契约，不新增工作流阶段，不创建新的 PR。

## 2026-09-06 本地收口（尚未线上验收）

状态：**部分验证**。源声画、实际剪辑字幕、版本保护、队列鉴权与任务扣退已接线并本地验证；线上普通账号、管理员、扣费/退款及 Chrome 操作尚未验证，不称端到端完成。

### 正向、反向追链

- 正向：当前集分镜 `outputText`／已保存对白 → `manhuaAssembleSubtitleSource` → 成片坞 `collectManhuaAssembleClipsFromDock` → `buildManhuaAssembleJobInput` → 登录校验后的 `jobs.input` → worker 真实任务身份与账本 → service → `renderSourceAudioFinal` 实际探测、裁切、重排与转场 → `subtitleTimeline` → `jobs.output` → 当前版本或迟到恢复记录 → 剪辑台确认 → 版本绑定 SRT → 原烧字队列。
- 反向：烧字 SRT 必须等于当前源 URL 的 `manhuaFinalVersions.subtitleTimeline`；该回执来自 renderer 最终探测时长及每个已渲染镜片窗口，不从当前新稿重新累计。源版本和任务身份保存于版本记录，云草稿与本机规范化不丢失回执。
- 切换剧本、源片或相关剪辑后迟到的成片只进恢复记录；不覆盖当前项目。同页提交同步锁防双击；切换成片版本或字幕回执后必须重新确认烧字。
- 旧成片没有回执时只展示计划预览，不允许冒用新稿烧字；须重新合成并核对。旧同步合成口返回 409，匿名/伪造身份在任务创建和扣费前拒绝。
- 前端 GET 能力握手失败不提交任务、不扣分；新后端要求 `manhua-assemble-v1`。旧客户端普通用户预扣入口关闭，避免客户端预扣与 worker 双扣。滚动部署验收还须确认旧 Fly 实例退出，不能仅凭一次握手宣称混合版本已经安全结束。
- 不隐式生成配乐；只有明确传入的已有音频参与混音。最终合成沿用原价 5 积分，管理员/监管仍遵循既有服务端豁免。结果先持久化后结算，失败/超时走原账本退款；失活任务保留输入和输出，不删除、不重新排入渲染。

### 修改范围

- 入口/消费：`OmniCanvas.tsx`、`ManhuaScriptWorkbench.tsx`、`ManhuaEditMultitrackPanel.tsx`、`ManhuaClipDock.tsx`。
- 数据/恢复：`manhuaAssembleSubtitleSource.ts`、`manhuaAssembleResultGuard.ts`、`manhuaProjectExport.ts`、`manhuaCloudDraftSync.ts`；shared 的 `manhuaRenderedSubtitle.ts`、`manhuaFinalAssemble.ts`、`manhuaFinalPostProd.ts`、`manhuaCloudDraft.ts`、`manhuaAssembleJobInput.ts`。
- 服务/副作用：`api/jobs.ts`、`server/_core/index.ts`、`server/jobs/runner.ts`、`staleJobsReaper.ts`、`server/routers/workflow.ts`、`manhuaAssembleAccess.ts`、`manhuaAssembleBilling.ts`、`manhuaAssembleFinalService.ts`、`renderSourceAudio.ts`、`renderTypes.ts`。
- 对应回归测试与匿名探针 `scripts/smoke-manhua-assemble-enqueue.mts`；完整路径以同次提交文件表为准。

### 本地实测记录

日志目录：`/Users/tangenjie/Downloads/2026Sep04/PR1392-release-NClAts`。

| 验证 | 原始结果 | 状态 |
| --- | --- | --- |
| `pnpm check --incremental false --pretty false` | 退出 0，`types-final.log` | 已验证 |
| 13 文件专项 | 82 tests passed，退出 0，`release-targets.log`；之后新增 service 回执测试待最终批次复验 | 已验证当前批次 |
| `pnpm exec vitest run` | 479 files passed / 2 failed / 2 skipped；4483 tests passed / 2 failed / 4 skipped；`full-tests.log` | 部分验证 |
| `pnpm exec vite build` | 退出 0，44.60 秒；既有大包/混合导入警告，`vite.log` | 已验证当前批次 |
| `git diff --check` | 退出 0 | 已验证 |
| 干净 Docker 构建 | 本机无 Docker，命令退出 127 | 未执行 |
| 线上鉴权、真实合成/烧字/退款及 Chrome 截图 | 未部署、未发真实媒体任务 | 未执行 |

两项全仓失败分别是 NativeDeepReadBatchCli 和 NativeDeepReadProbeCli 仍把 7201 秒断言为超过上限；当前主线最大值为 14400 秒。这两个测试文件与 `origin/main` 一致，未修改学习冻结配置或删改测试。新增字幕测试曾发现浮点累计将 4 秒变为 3.999 秒，已修正毫秒取整；旧 UI 测试仍要求客户端预扣配乐，已改验握手/入队顺序并断言无旧预扣。

### 九层验收与剩余边界

需求与范围已核对；入口、生产、契约、存储和展示完成本地验证；服务/账本仅依赖隔离及路由执行测试通过，线上副作用未验证；静态回归存在上述两项基线失败；真实链路未验证。因此整体仍为部分验证。

1. 字幕文本是**合成时的剧本快照**，不是视频生成当时的完整回执，也不是 ASR。秒位按实际镜窗映射，不能保证字级口型。UI 必须让用户确认对白与成片一致，不宣传自动识别。
2. 本机恢复记录保存已经返回的成片；刷新发生在合成中途时，完整客户端自动接回仍待验证，不能把完成记录当作所有在途任务恢复。服务端任务输入/输出保留。
3. 跨设备完整媒体包导入/导出、所有签名过期组合、跨标签重复提交及真实供应商质量未在本轮关闭。
4. 账本登记和即时退款同时失败、执行超时后底层 FFmpeg 仍未取消等极端情形沿用现有基础设施限制；未以自动重新生成掩盖失败。
5. 合并前再次读取学习任务及部署流水线；有 queued/running 学习时不触发部署。合并授权与部署验收另记。

回退以新的修复提交或明确授权的 revert 进行，不删用户草稿、模型 JSON、旧成片或任务回执；不得回退为匿名付费入口或恢复隐式配乐。数据库没有迁移；旧回执缺失走明示兼容分支。

## 同步最新主线后的最终复验

本地功能提交 `f65bea4`，随后在 `9a180fc` 无冲突合入主线 `6171f0d`（PR #1396）。PR 相对主线没有学习冻结文件差异。

- `pnpm check --incremental false --pretty false`：退出 0，`types-synced.log`。
- `pnpm exec vitest run`：退出 1；**479 文件通过、2 失败、2 跳过；4497 项通过、2 失败、4 跳过**，114.82 秒，`full-tests-synced.log`。失败仍仅为前述两个主线已有 CLI 断言。
- `pnpm exec vite build`：退出 0，1 分 10 秒，`vite-synced.log`；未消除既有大包警告。
- 单独新增 service 回执传递测试所在文件：9 项通过，退出 0，`service-receipt.log`；最终全仓已包含此测试。
- `git diff origin/main...HEAD --check`：退出 0。
- 2026-09-06 02:49:29（上海）仅通过 Fly 服务端只读查询发现一条 `manhua_template_learn` 为 running 且心跳更新。因此此时**禁止合并触发部署**。主线 `6171f0d` 的 Fly Deploy 已成功；本 PR 尚未合并/部署，也没有新增生产调用。

该复验支持将本批提交推送供合并审查，不支持声称已做线上成片、退款或 Chrome 验收。学习任务终态和实际合并权限须在合并当刻重新确认。

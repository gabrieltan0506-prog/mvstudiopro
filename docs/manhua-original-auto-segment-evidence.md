# 原稿自动分段与自动轨迹：施工及验收记录

状态：部分验证，未合并、未部署、未做线上付费生成。以本次真实测试结果为准，不沿用历史全仓通过数。

后续终审发现与修复、同步最新主线后的验证及待合并结论见 [PR1384终审记录](./manhua-pr1384-final-review.md)。以下保留原增量测试快照。

## 改前证据与边界

| 检查项 | 实际链路与约束 |
| --- | --- |
| 用户结果 | 原稿自动分段，保留全部镜头；撤除旧手绘方式，以自动矢量轨迹、关键点调整、人工确认替代；仍先生成一次 10 秒试片 |
| 允许范围 | 原稿解析后的分段、工作台、任务映射、参考图身份、字幕及后期裁切；同类改动进入 PR 1384 |
| 禁止范围 | 不改模型/供应商/计费单价/权限；不触学习冻结契约；不自动付费调用、合并或部署；不删除媒体/原始 JSON |
| 真源与转换 | 工厂节点已生成正文 → resolveShotsForEpisodeKeyarts → groupShotsIntoSegments → manhuaAutoSegment 身份 → 当前队列 |
| 原断点 | 固定六段导致 29 镜压为 18 镜；三镜除法导致拆段后参考图/字幕/重跑错位；旧造型和旧图可能继承确认；后期 0.1 秒舍入丢尾 |
| 消费者 | 工作台段卡、静帧/成片按钮、工厂执行器、创作顾问选中镜、字幕源、合成服务与原声渲染器 |
| 存储恢复 | 节点本机/云草稿均保留分段身份和原镜生成回执；不匹配旧成片、进行中任务保留归档，不复制给新片 |
| 权限/费用/恢复 | 保留既有鉴权与账本；批量按当前实际段数确认，源稿变化拒绝旧确认；非法裁切进入既有失败退款链 |

## 实际实现

- 每段最多三张原镜参考，按已选引擎单次时长限制切段；尾部一、两镜照实保留。长镜拆为连续生成窗口，保留原镜号与全程内容，不再合并后镜的运镜/表演。
- 不把新写作的默认段数当作原稿上限。旧固定预算参数仅兼容，不触学习参数。
- 自动节点采用集内编号及完整源修订身份；跨集续拍读取上一集实际末段，不依赖固定六段换算。
- 重分段导致的造型绑定须重新确认；原镜变更使旧图失效，旧图仍保留。批跑和节点重跑均须记录本次真实图像回执。
- 当前分支已无手绘轨迹画板；轨迹层使用 SVG 矢量、端点调整和键盘微调。自动编译仅识别明确方向/运镜，不凭空假定角色坐标。旧存储不删除，来源/底图/窗口变化需要重新确认。
- 字幕与静帧共用原稿生产者，长镜后续窗口不重复首段对白。合成保留裁切浮点精度，显式非法剪点不得悄悄回到全片。

## 双向追链

正向：原稿正文 → 原镜 → 实际段表与源秒窗 → 静帧引用/轨迹确认 → 当前 clip → 字幕源/裁切 → API 入参 → 账本/worker → 原声合成输出。

反向：合成输入的 episodeIndex/segmentIndex/trim 追到当前 clip 的 manhuaAutoSegment；revision 对回原稿镜字段、引擎及源窗；图片回执对回原镜；轨迹 sourceRevision 对回同段内容、底图及时间窗口。另一按钮、批量、续拍和草稿恢复分别有目标回归，线上链路尚未验收。

## 已取得的验证证据

- 容量复现：130/135 秒、29 镜，真实解析 → 展开 → 成片编译生成 29 张静帧、12 段队列；29 条动作/对白/运镜/表演标记均保留。135 秒的请求因整数档合计 136 秒，裁切仍按 135 秒源窗，不把请求时长冒充原稿时长。
- 轨迹与工厂回归：`vitest run shared/manhuaDirectorBoardOverlayCompile.test.ts client/src/lib/manhuaDirectorBoardOverlayUi.test.ts client/src/lib/canvasDramaStudio.test.ts shared/manhuaAutoSegment.test.ts`：4 文件、112 项通过。
- 后期目标与邻接：8 文件、86 项通过；本地真实媒体另 10 项通过。FFprobe 视频/原声均为 31.000000 秒；最后蓝帧和 880Hz 尾音保留。非法裁切退款一次、渲染器零调用。
- 失败已定位：字幕旧正则漏掉六列表头，改与工厂同源；旧固定段数测试与新合同冲突，改为保留原镜和源窗断言；Set 展开与项目 TypeScript target 不兼容，改 Array.from；旧测试生成模型字段被推断为 string，使用真实枚举字面量。

## 交付状态与剩余边界

| 层 | 状态 |
| --- | --- |
| 需求与边界 | 已验证：用户明确自动分段及替换手绘，保留 10 秒试片限制 |
| 入口与交互 | 部分完成：真实 JSX/函数测试通过，待 Chrome 线上验收 |
| 数据生产 | 部分验证：结构化原稿与真实解析测试通过，未重新运行线上写稿 |
| 契约转换 | 部分验证：分段身份、静帧来源、字幕与裁切目标回归通过 |
| 服务及副作用 | 部分验证：真实服务/账本失败测试通过，未生产付费调用 |
| 存储恢复 | 部分验证：本机/云序列化回归，未线上刷新验收 |
| 消费与展示 | 部分验证：提示词编译与本地 FFmpeg 有真实结果，未证明视频模型遵循画面轨迹 |
| 静态与回归 | 部分验证：无增量类型检查通过；全仓存在失败，不宣称全绿，详见后续结果 |
| 真实链路 | 未验证：尚未合并部署，未用 Chrome 验收本增量 |

限制：没有逐镜/可拍表结构的散文原稿仍需既有拆解步骤，不伪造段表；未标秒数的镜头沿用既有估计，不能宣称测得时长。长镜对白暂保留在首窗口，过长对白仍须通过现有声音门禁并人工检查；轨迹是参考约束，不承诺模型逐像素跟随。少于 0.5 秒的独立源窗明确阻断；最终视频受帧率精度限制。旧写作密度规则仍需独立用真实原稿验证，不能仅凭本次取消段数上限称全链闭环。

回退：仅回退本 PR 代码增量；保留旧图、旧片、任务身份及全部生成 JSON。自动分段节点和新回执属于可选字段，旧代码忽略字段不等于可安全消费新队列，回退后应暂停新队列生成并重新验收。

## 整合回归记录（2026-09-06）

- `pnpm exec tsc --noEmit --incremental false`：退出码 0，输出为空；日志 `/private/tmp/manhua-auto-segment-types-final.log`。
- `pnpm exec vitest run --maxWorkers=4 --minWorkers=1`：510 文件，504 通过、4 失败、2 跳过；4766 项，4756 通过、6 失败、4 跳过；361.58 秒，退出码 1。日志 `/private/tmp/manhua-auto-segment-final-full-test.log`。不得将后续局部通过改写成全仓通过。
- 本次相关失败：旧 middleware 测试把 4 秒原镜拉伸到 12 秒；实际生产输出已保留 `0–4s` 并标明 `4–12` 秒尾部留白裁切。更新测试为源秒轴与尾部约束，保留原有对白、角色和景别断言，没有为通过测试修改生产时轴。
- 其余失败：读片 CLI 两条 7201 上限断言与当前主线契约不一致；一次缺值 fps 子进程无 stderr；照片镜像两条测试在整仓运行失败。上述生产链与测试不属本轮修改，不扩大到学习或照片服务；对失败文件单独复测，结果另附。
- 前一轮隔离复测：`vitest run --maxWorkers=2 --minWorkers=1` 配合 weixinChannelsCapture、homePhotoAnimateTask.mirror、manhuaPilotReview、renderSourceAudio 四文件，110 项通过，37.10 秒。只证明该次隔离通过，不证明并发失败已解决。
- 未执行：线上 Chrome 新版本操作、生产生成/扣退、线上刷新恢复、各视频模型轨迹遵循质量；未合并、未部署。
- 失败文件复测：`pnpm exec vitest run --maxWorkers=1 --minWorkers=1 server/services/jsonDirectorMiddleware.test.ts server/services/homePhotoAnimateTask.mirror.test.ts server/services/manhuaNativeDeepReadBatchCli.test.ts server/services/manhuaNativeDeepReadProbeCli.test.ts`：74 通过、2 失败，58.48 秒。middleware 9 项和镜像 4 项均通过；fps 缺值也通过；仅两条 7201 断言稳定失败。日志 `/private/tmp/manhua-auto-segment-final-failures-recheck.log`。并发失败根因尚未确认，不改无关测试掩盖。
- 最终构建：`pnpm exec vite build` 退出码 0，40.14 秒；保留已有大于 500kB chunk 警告。日志 `/private/tmp/manhua-auto-segment-vite-final.log`。未增加依赖；未进行干净 Docker 构建。
- `git diff --check` 退出码 0。冻结学习 CLI、模型单价和依赖清单未修改。PR 维持草稿，需明确处理现存测试失败后再决定合并。

## 本增量文件范围

- UI：`client/src/components/ManhuaScriptWorkbench.tsx`、`client/src/components/canvas/FreeformCanvas.tsx`、`client/src/pages/OmniCanvas.tsx`。
- 工厂与恢复：`client/src/lib/canvasDramaStudio.ts`、`canvasTypes.ts`、`manhuaCloudDraftSync.ts`、`manhuaAssembleSubtitleSource.ts`（后三者同目录）。
- 共享契约：`shared/manhuaAutoSegment.ts`、`manhuaScriptWorkbench.ts`、`manhuaCharacterLookSets.ts`、`manhuaClipContinuity.ts`、`manhuaCloudDraft.ts`、`manhuaDirectorBoardOverlayCompile.ts`、`manhuaClipDialogueTimeline.ts`、`manhuaClipPromptSanitize.ts`、`manhuaEpisodeSegmentPlan.ts`、`manhuaWriterAssetCanon.ts`、`manhuaWriterRoom.ts`、`manhuaNarrativeEnginePrompt.ts`、`manhuaEpisodeQualityPrompt.ts`、`manhuaFinalAssemble.ts`（均在 shared）。
- 服务：`server/services/manhuaAssembleFinalService.ts`；原声 renderer 生产代码未改。
- 回归：上述功能对应 `.test.ts`；新增 `manhuaAutoSegmentFactory.test.ts`、`manhuaAutoSegmentUi.test.ts`、`manhuaStoryboardCapacity.audit.test.ts`、`manhuaAutoSegment.test.ts`、`manhuaOriginalSegmentQuality.test.ts`；额外更新真实调用点回归 `canvasRunBlock.pilot.test.ts`、`manhuaKeyartLookRun.test.ts`、`manhuaLookControls.test.ts`、`jsonDirectorMiddleware.test.ts`、`manhuaAssembleFinalService.audio.test.ts`、`renderSourceAudio.test.ts`。
- 文档：本记录与 `docs/manhua-phase3-release-evidence.md` 后续状态指针。

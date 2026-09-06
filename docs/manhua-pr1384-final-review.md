# PR 1384：轨迹终审修复与待审交付

2026-09-06。范围仅收口现有 PR，不增加新功能。用户自行合并；本任务不代合并、不部署、不重跑部署，不调用付费模型。

## 改前证据表

| 项 | 证据与边界 |
| --- | --- |
| 用户结果 | 原稿自动生成人物/摄影机路线，微调后明确确认，真实生成读取新路线 |
| 入口 | 工作台 `activeDirectorBoardMotionOverlay`；SVG 拖点/键盘统一调用 `adjustManhuaBoardOverlayPoint` |
| 生产者断点 | 原稿没有旧段表时 `beat.castZh` 为空，黑奇明确向右行走仍产生空人物路线 |
| 转换断点 | 改点只设 `userAdjusted`，已确认的 `needsReview:false` 继续进入生成 |
| 消费/恢复 | 工厂同一段级编译器 → 空间调度短指令；本机/云保持 overlay 的确认标记 |
| 副作用边界 | 不改模型、外部 API、价格、账本和权限；不删除历史图/片；只确认后的坐标进入生成文案 |
| 完成条件 | 有登记人物且方向明确时路线非空；实际拖点后不再注入，重新确认才注入；未变/无效拖点不撤销确认 |

## 实际修改与双向追链

- `shared/manhuaDirectorBoardOverlayCompile.ts`：读取本段动作明确点名的 `assetCanon` 人物/道具，登记身份进入 revision。无登记对象或方向不明确不猜路线。旧编号稿“镜头…：人物动作”只剥明确机位前缀，保留原动作。
- `client/src/components/ManhuaScriptWorkbench.tsx` 与 `client/src/lib/canvasDramaStudio.ts`：同一 `assetCanon` 分别进入 UI 与工厂编译；memo 依赖包含该值，不让旧身份残留。
- `shared/manhuaDirectorBoardOverlay.ts`：比较归一化后的实际点位；变更置 `needsReview:true`。兼容轴线入口/出口原本可空；非整数索引、非有限点位、未命中或未变均不伪造调整。
- 测试：共享 overlay、段级编译器、真实 UI memo 到工厂，以及 SVG 更新回归共四个测试文件。

正向：本段正文及登记资产 → 段级 compile → UI overlay → 拖点失效 → 显式确认 → 工厂重编译同 revision → `formatManhuaBoardMotionOverlayPromptZh` → 成片提示词。

反向：成片中的“人物黑奇自画面左向右”追到已确认 overlay、同源资产 ID 和本段 action；改点后短指令为空，只有重新确认才出现“摄影机跟移自画面右向左”。底图、源窗或主体 ID 改变，原确认失效。共享 parser 的序列化往返保留待确认，不删除旧素材；单段、批量及节点重跑共用工厂编译器。

## 验证及失败原因

- P2 新增 7 个回归改前全部失败，复现“点位已改但确认仍有效”；修复后共享/UI 22 项通过，1.44 秒。
- P1 首轮真实 UI 链失败：旧编号稿机位前缀让整句动作误判为摄像机描述；针对前缀修复后 3 文件113项通过，6.07秒。
- 统一定向13文件197项通过，12.34秒，日志 `/private/tmp/manhua-pr1384-review-fixes-tests.log`。
- 第一轮类型检查发现 `axis.entrance/exit` 可空，已补兼容，不收紧原数据合同；最终整合检查另记。
- 干净主线 `f0edf9f` 单独运行两个 CLI 的 `7201` 用例，两项同样失败，2.27秒。实际生产上限由 `240*60` 提供，旧测试仍按7200断言；相关代码及测试不是本PR修改。未更改冻结契约来掩盖红灯。
- 新主线 `ee42931` 仅在 `.cursor/knowledge/PROGRESS.md` 与本分支产生冲突；已保留双方记录。学习改动完整来自主线，相对主线无新增学习变更。

## 完成状态与上线边界

需求、真实生产者、契约、入口到提示词的本地回归已验证；存储确认状态有共享/云恢复回归。没有改变扣退逻辑和付费入口，真实付费效果未验。最终类型/全仓/构建结果完成后追加。

代码审查与上线验收分开：解除草稿表示可交用户决定合并，不表示工厂已全部闭环。线上 Chrome 操作、真实视频模型是否遵循路线、付费扣退与跨设备恢复尚未本轮实跑；部署成功后仍须验收。两条基线学习测试单独保留，不因与本PR无关就称全仓全绿。

回退只回退代码，保留所有历史媒体、任务和 JSON。未确认路线仍可查看和调整，不进入付费生成文案。

## 最终整合结果

- 审查结论：本轮两项轨迹阻断均已修复，通过代码审查，可解除草稿交用户决定合并；不是线上端到端完成声明。
- `pnpm exec tsc --noEmit --incremental false`：退出0、空输出，日志 `/private/tmp/manhua-pr1384-ready-types.log`。
- `pnpm exec vitest run --maxWorkers=4 --minWorkers=1`：513文件，509通过/2失败/2跳过；4835项，4829通过/2失败/4跳过；256.77秒，退出1。仅两条7201基线失败，无本PR新增失败。日志 `/private/tmp/manhua-pr1384-ready-full-tests.log`。
- `pnpm exec vite build`：退出0，1分22秒；已有大包警告保留，日志 `/private/tmp/manhua-pr1384-ready-vite.log`。
- `git diff --check` 退出0；与 `origin/main=ee42931` 合并树无冲突。最终测试代码提交 `fffe06b`，后续仅追加本记录。
- 未做干净Docker构建、线上Chrome新版本验收、生产模型调用或真实扣退。用户保留合并权；本任务未执行合并、部署或重跑流水线。

## #1398 合并后的文档冲突修复

主线更新至 `f9eb7a5` 后，与本 PR 再次冲突的唯一文件是 `.cursor/knowledge/PROGRESS.md`。已保留原有全部记录并加入主线 Growth 归档记录，不修改双方业务实现。新增主线工作流/归档脚本及测试与 `origin/main` 逐文件 diff 为空。

同步后运行 `pnpm exec vitest run --maxWorkers=2 --minWorkers=1`，覆盖 growthArchivePlan、growthArchiveTransfer、growthArchiveWorkflowSafety、共享轨迹、轨迹UI 五文件，58项通过，17.12秒；日志 `/private/tmp/manhua-pr1384-doc-conflict-tests.log`。diff-check通过、无未解决文件。本次人工改动仅文档冲突与本记录，不重复声称已在新快照跑过全仓或类型检查；前述最终类型/全仓数字仍对应原代码快照。

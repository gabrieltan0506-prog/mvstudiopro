# 资产编辑类页面内费用确认（0908）

状态：部分验证。费用确认交互已实现；线上生成与实际扣退尚未实跑，不能据此宣布三段试片完成。

## 改前证据和范围

原页面最新墨屠候选图已经恢复显示，现有七张参考保留。点击单张编辑的「继续确认费用」后浏览器控制超时；弹窗读取没有返回有效对象。不能把超时当成已确认弹窗存在。服务端 2026-09-07T19:43:25Z 查询：非终态任务、学习进程和待结算账本均为空，读取错误为空；此查询不单独证明没有刚完成的新任务。

代码确认三入口在入队前使用同步 `window.confirm`。本补丁把编辑、去字、标准化三条同族路径改成页面内费用确认，保留明确确认与取消。不移除其他付费门禁，不改价格、权限、公共接口、数据模型、生成提示词、模型路由或既有超时重试。

| 检查项 | 真实链路及本轮处理 |
|---|---|
| 最终结果 | 创作者在页面中看见费用、参考名和编辑要求，明确确认后才提交一次 |
| 入口 | `ManhuaAssetEditInput` → 工作台 `onEditCustomAsset`；去字及标准/高质按钮 → 同一父页面三回调 |
| 生产者 | 编辑原输入由 `buildManhuaAssetImageEditPrompt` 编译；其余两条既有提示词不变 |
| 转换 | `prepareAssetImageEdit` 在确认之后续签并读尺寸；编辑/去字沿源画幅，标准化保留目标画幅 |
| 计费 | `createJobSameOrigin` → worker 单参考/归属检查 → `manhuaAssetStandardize/${jobId}` 幂等扣费；标准 3、高质 5 |
| 保存/消费 | 成功回写新资产 ID、GCS 身份；旧图不覆盖，不继承主参考绑定；当前草稿持久化路径不改 |
| 失败 | 取消/卸载/确认范围变化不生成；异常释放同步锁；后端失败退款由既有账本负责 |
| 已知断点 | 原生确认目前无法通过当前浏览器工具核验；本轮尚无线上图片生成或视频验收 |

## 双向追链

正向：三按钮 → 三回调同步共享锁 → 页面内确认 → 原图准备 → 原有任务请求 → worker 鉴权/扣费/上游 → job.output → 新资产追加 → 工作台展示及本机草稿。

反向：新增资产 `gcsUri/url` 来自同一 job.output；该 job 的 `assetRefId` 来自被确认的引用 ID，`params.prompt` 来自当前修改要求或既有两条固定操作文案；费用取共享函数。没有创建新的旁路请求或自动重试。

确认钩子以当前资产集合、剧本对象和用户身份为范围。等待期间任何范围变化使旧确认失效；迟到的旧按钮不能确认下一项。同步 ref 锁覆盖确认等待期至整个回调结束，防止两个新 job 绕开服务端单 job 幂等。确认框 z100 高于输入框 z90，不修改全局弹层组件。

## 九层状态

1. 需求与边界：已验证，限定三入口费用交互，原费用和业务契约不变。
2. 入口与交互：部分验证，真实回调及双层弹窗六项离线浏览器验收通过，线上页面待验。
3. 数据生产：已验证，真实回调断言当前中文 prompt 与生产编译函数一致，等待期零原图读取/零建单。
4. 契约与转换：已验证，既有单参考、画幅和 quality 字段保持，high 请求与 5 分预览对应。
5. 服务与副作用：部分验证，worker 原图续签→扣费→生成与失败退款回归通过；未线上实扣退。
6. 存储与恢复：部分验证，真实回调验证新图追加及原图不变；未新增刷新中任务恢复功能。
7. 消费与展示：部分验证，本轮新增产物未线上产生；已部署的图像显示修复属于前一批。
8. 静态与回归：部分验证，目标九文件 156 项通过；类型、无增量类型及服务端构建退出 0；Vite 3558 模块、59.48 秒退出 0。全仓存在下述两个既有失败。
9. 真实链路：阻塞于当前浏览器确认状态，未做线上实跑，不以离线测试替代。

## 残余限制

- 三入口既有 jobId 仅保留于当前回调；刷新中的任务不会自动回写资产栏。此补丁不冒充解决该恢复缺口。
- 轮询超时不等于服务端任务失败，不等于已退款；禁止不对账就重复付费提交。
- 既有管理员成功提示仍按标价显示积分，实际账本可能免扣；本补丁未改计费回执文案。
- 确认后的在途任务遇到工作区替换属于既有生命周期风险；本补丁仅撤销确认等待期的过期目标。
- 无新依赖，无生产凭证离开服务端，无资产删除或自动重提。

## 验证原始结果

```text
pnpm check
退出 0
pnpm exec tsc --noEmit --incremental false
退出 0
pnpm exec tsc --incremental false
退出 0
pnpm exec vite build
3558 modules transformed / built in 59.48s / 退出 0

pnpm exec vitest run client/src/lib/manhuaAssetEditSubmit.test.ts client/src/lib/manhuaAssetConfirmation.browser.test.ts client/src/lib/manhuaAssetEditInput.browser.test.ts client/src/lib/manhuaAssetUploadWiring.test.ts client/src/lib/manhuaAssetImageSource.test.ts client/src/lib/canvasDramaStudio.test.ts shared/manhuaSeedanceLayout.test.ts server/jobs/runner.canvasAssetEdit.test.ts server/jobs/runner.canvasImagePolicy.test.ts --silent
Test Files 9 passed (9)
Tests 156 passed (156)
Duration 7.78s / 退出 0

pnpm exec vitest run --silent
Test Files 2 failed | 541 passed | 2 skipped (545)
Tests 2 failed | 5226 passed | 4 skipped (5232)
Duration 119.62s / 退出 1
```

全仓两失败为 `manhuaNativeDeepReadBatchCli.test.ts:127`、`manhuaNativeDeepReadProbeCli.test.ts:83` 的 7201 上限断言；与本轮基线 `origin/main` 对应测试和 CLI 文件无 diff，上一批全仓亦存在。没有更改冻结读片参数或降低断言。全仓运行后新增的三条失败矩阵测试（每条五种失败）已随目标九文件重跑通过。

独立审查未发现新增 P0–P2 阻断。离线浏览器复现实际组件与定位/z-index，所有网络拦截，不冒充完整线上页面或真实扣退。后台续签和其他资产变动也会安全取消待确认框，不仅项目切换；取消保留编辑文字。

实际修改文件：`client/src/pages/OmniCanvas.tsx`、`client/src/components/useManhuaAssetConfirmation.tsx`、`client/src/lib/manhuaAssetEditSubmit.test.ts`、`client/src/lib/manhuaAssetConfirmation.browser.test.ts`，以及本报告、`PROGRESS.md`、`kb/line-canvas.md`。

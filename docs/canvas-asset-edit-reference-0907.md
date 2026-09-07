# 0907 资产编辑参考图与画幅修复

状态：本地部分验证，尚未线上验收。用户授权修复与部署；不自动重提失败付费任务。

## 改前证据与范围

| 检查层 | 实际证据与边界 |
| --- | --- |
| 结果 | 原图 474×265；失败任务 V23yfonGf28CMFwV 的实际输入为 9:16，参考图访问返回 ExpiredToken；不把请求成功当出图成功。 |
| 入口 | OmniCanvas 的 editCustomAsset、detextCustomAsset、standardizeCustomAsset 共用图片队列；免费裁剪也直接使用旧链接。 |
| 生产者 | uploadCanvasFilesParallel 返回 URL、长期 GCS 身份及本机预览；直接导入没有写 sourceWidth/sourceHeight，ZIP 导入已有尺寸。 |
| 转换与保存 | normalizeManhuaCustomAssetRefs 保留 gcsUri/sourceWidth/sourceHeight；编辑结果之前清掉长期身份并继承原图尺寸。 |
| 消费者 | buildCanvasGptImage2JobInput → jobs → runner → generateGptImage2FromRawEnglishPrompt；旧按钮把未知宽高当竖图。 |
| 副作用 | 二次确认后只建一次任务；worker 按 jobId 幂等扣费，失败用原 paidJobLedger 退款；成功追加新图，不覆盖旧图。 |
| 禁止项 | 不改价格、供应商路由、标准化人物竖版/场景横版语义、生成参数、学习链、数据模型或依赖；原工作树查看器修改保留且不混入。 |
| 已知限制 | 旧客户端仍会发送旧画幅，需前台更新后刷新；没有长期身份的外部过期链接不能代签。 |

## 实际修改与双向追链

- client/src/lib/manhuaAssetImageSource.ts：从明确存储 URL 恢复长期身份，每次操作经原已鉴权接口续签，30 秒内读取实际图片尺寸；失败明确拒绝，不猜画幅。
- client/src/pages/OmniCanvas.tsx：直接上传保存实测尺寸；三个 AI 操作提交续签后的参考图，编辑/去字按真实横竖、标准化继续按原角色规则；免费裁剪同样续签。新图保存自己的 GCS 身份，不继承旧像素尺寸；原图完整保留。
- server/services/canvasAssetEditReference.ts：仅在现有资产编辑路径执行；worker 按任务用户经现有权威归属解析，再为本桶素材签 7 天读取链。外部 HTTPS 原样交原通道；不替外部桶代签。
- server/jobs/runner.ts：排队结束、扣费之前续签；同任务 ID、账本与退款路径不变，不重复入队。
- 对应测试：manhuaAssetImageSource、manhuaAssetEditSubmit、manhuaAssetUploadWiring、canvasAssetEditReference、runner.canvasAssetEdit。

正向：当前所选 ref.id → 原图实际解码宽高/新 URL → builder 的 aspectRatio/referenceImageUrls/assetRefId → 同一 jobs.input → worker 按 jobUserId 续签 → 上游真实调用点 → 同 job 输出 → 新资产独立 ID/GCS 身份。

反向：新增资产 URL 来自轮询的同 job.output；上游参考来自 worker 续签的原对象；对象归属来自本人上传前缀或现有登记/成功任务，不来自可编辑草稿；横竖来自当前图片解码而非旧字段。旧图留在原数组位置，失败不追加假产物、不重提。

邻接核查：去字同修；标准化只换参考地址，不改角色目标画幅；免费裁剪同修；ZIP 原有尺寸链不改；旧草稿无宽高可即时重读、仅有 GCS URL 可恢复身份；多图批次/普通出图不进入新增 worker 分支。所有权、扣退、无整单重排沿原实现。原有跨项目在途回填、外部素材长期托管不在本刀范围。

## 已执行验证

- pnpm check --incremental false：退出 0。
- 第一批 3 文件/13 测试通过；第二批 5 文件/59 测试通过。
- 15 文件定向回归：192 passed；包含三个真实按钮回调、真实 worker 图片分支、归属/退款/上传/草稿字段/工厂和布局回归。
- pnpm build --incremental false：退出 0。
- pnpm exec vite build：3552 modules transformed，built in 12.33s，退出 0；保留既有大包和混合导入警告。
- 新增主要文件 prettier 检查与 git diff --check 通过；未整体格式化大型历史文件。
- 同步最新 main ec9f1a0 后复验：13 文件/188 项通过（含 ZIP 导入）；无增量类型、服务端构建均退出 0，Vite 再次 3552 模块、20.95 秒退出 0。命令里指定的 manhuaCloudDraftMerge.test.ts 不存在，未把该项算作已执行；旧稿仅有规范化字段及回调保存验证。
- Fly 只读查询 queued/running jobs 返回 []；最新 main 的 Fly Deploy success。发布前仍需重新核对。

上述回调与 worker 测试运行真实源码，但网络、账本及模型边界为虚构依赖，不能称作线上实跑。全部真实凭证始终留在 Fly；本轮没有付费生成。

## 九层审计

1. 需求与边界：已验证，限定两处缺陷及直接邻接入口。
2. 入口与交互：部分完成，真实回调离线通过，用户线上按钮待验。
3. 数据生产：部分完成，实际源码读取宽高并消费，线上原图解码待验。
4. 契约与转换：已验证，builder/规范化及真实调用参数回归。
5. 服务与副作用：部分完成，真实 worker 边界与归属/退款回归通过，真实扣退未跑。
6. 存储与恢复：部分完成，长期身份及旧字段兼容已测试，线上草稿刷新待验。
7. 消费与展示：部分完成，非空返回回写已测，真实新图质量未验。
8. 静态与回归：已验证上述本地命令，未跑全仓或干净 Docker 构建，无新增依赖。
9. 真实链路：未做线上实跑。发布不是图片质量验收，修复后不能自动重提旧任务。

需要用户决定：合并授权；部署后如需重新生成，另行确认一次付费提交。没有授权不重烧。旧签名接口只校验桶范围的既有权限缺口未扩大修改，新增 worker 续签另按权威归属验证；历史未登记资产可能被明确拒绝，需要从本人上传入口重新选择，不允许抢注归属。

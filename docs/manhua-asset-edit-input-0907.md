# 资产编辑输入框内置浏览器验收

状态：已实现、部分验证，尚未发布；不是完全体图片或视频交付。

## 改前证据与边界

2026-09-07 21:25，在用户指定的内置浏览器原 `/canvas` 标签页，实际点击《墨菁传》原黑翼参考 `cust_mtmshals_qcqtk` 的「编辑图片·3分」。页面控制台返回 `Error: prompt() is not supported.`，调用点为工作台资产卡的 `window.prompt`。没有出现输入框，也没有因此创建生成任务。

| 检查层 | 实际证据与范围 |
| --- | --- |
| 结果与边界 | 用户已授权任务所需生图、三段各十秒视频，必要时另加三至五段及 TTS/BGM/剪辑。本增量只修资产编辑文字输入，不修改费用、生成参数、业务接口或原稿。 |
| 入口 | `ManhuaScriptWorkbench` 自定义资产卡 → `ManhuaAssetEditInput` 页面内弹层；角色、场景、道具、服装共用入口，原禁用条件不变。 |
| 生产者 | 创作者在文本框实际填写修改要求；空白和取消不调用生成回调，不使用固定提示词。 |
| 契约 | 仍调用 `onEditCustomAsset(ref.id, instructionZh)`；父 `editCustomAsset` 编译提示词、保留原费用确认。内置浏览器的 confirm 已在云回填比较动作中实际出现，不能以 prompt 报错推断 confirm 也不支持。 |
| 服务与副作用 | 原 `prepareAssetImageEdit` 读取实际尺寸并续签；`createJobSameOrigin` 建单，worker 扣费前复核归属和素材。弹层同步 ref 锁阻止连点，未新增自动重试。 |
| 存储与恢复 | 原 handler 追加新参考，原图保留，`primaryBindings=[]`，不自动改为主图。本增量不改变本机／云草稿格式；弹层输入仅为临时 UI 状态。 |
| 消费展示 | 新弹层提交仍走既有 toast 和资产追加；Promise resolve 不作为生成成功证据。必须以真实 job 及新增图验收。 |
| 静态与回归 | 六文件二十三项资产编辑回归，加三文件一百零七项组件／工厂／布局回归，共九文件一百三十项通过；新组件真实浏览器四项在其中。`pnpm check` 与无增量类型退出 0，Vite 3557 模块、24.33 秒、退出 0；格式检查通过。全仓 5141 通过／4 跳过／2 个既有读片 CLI 上限断言失败，退出 1。 |
| 真实链路 | 已线上复现旧输入故障。新弹层未上线，未从新弹层实跑付费生产，不称线上已修。 |

## 正向与反向追链

正向：资产卡 ID → 页面内修改文字 → `onEditCustomAsset` → 父提示词编译与费用确认 → 素材续签／画幅 → 单个 image job → 同 ID 轮询 → 追加新参考。

反向：新参考的 HTTPS 产物源于同一 job.output，输入资产身份为 `assetRefId`，修改文字源于本弹层用户输入；弹层不替换图、不生成假输出。去字、标准化、免费裁剪和画布节点改图沿用原入口，不迁移到新回调。

## 真实素材与生产对账

- 当前页面六张人物图全部实际加载，阿菁脸底 1776×2368、原黑翼图 474×265、两张已有编辑图 1024×1536；场景与道具图仍为零。
- 21:27:46 服务端只读复核：同完全体指令只有 `V23yfonGf28CMFwV`，failed、无输出；同源历史成功任务 `lN3QBUJOYblBZDmJ` 指令不同，不冒充完全体。
- 常态模型 `m3d_bf97d8cbb33576e54714a513` 已成功，不重购。真实 41,857,616 字节 GLB 的离线旧／新 CSP 对照：两版 loaded 都为 true，但旧版三次贴图读取违例、零图片解码，新版零违例、三张 2048×2048 JPEG 解码、颜色／法线／材质纹理均非空。此为离线贴图验收，不替代线上权限和真实运动质量。

## 已知限制

原单图编辑 handler 的 jobId 仍是局部变量；轮询超时或刷新后不能直接重按生成，必须先查询原任务。该恢复缺口不是本次输入框补丁已解决的事项。原 PR #1412 已合并，新的发布载体正在请求用户明确授权，不擅自建立替代 PR。

## 本轮实际命令

```text
pnpm exec vitest run client/src/lib/manhuaAssetUploadWiring.test.ts client/src/lib/manhuaAssetEditSubmit.test.ts client/src/lib/manhuaAssetImageSource.test.ts shared/manhuaAssetImageEdit.test.ts server/services/canvasAssetEditReference.test.ts server/jobs/runner.canvasAssetEdit.test.ts
Test Files 6 passed (6), Tests 23 passed (23), Duration 2.99s

pnpm exec vitest run client/src/lib/manhuaAssetEditInput.browser.test.ts client/src/lib/canvasDramaStudio.test.ts shared/manhuaSeedanceLayout.test.ts
Test Files 3 passed (3), Tests 107 passed (107), Duration 4.74s

pnpm check
退出 0

pnpm exec vite build
3557 modules transformed; built in 24.33s; 退出 0

pnpm exec prettier --check client/src/components/ManhuaAssetEditInput.tsx client/src/lib/manhuaAssetEditInput.browser.test.ts
All matched files use Prettier code style!
```

构建仍有动态／静态导入混用与大包警告；不将其写为零警告。新测试拦截所有网络、运行真实 React/Radix 组件，不接用户窗口；证明中文多行进入回调、取消零提交、三次同帧点击一次调用、失败保留输入并且无自动重试。

追加原始结果：

```text
pnpm exec tsc --noEmit --incremental false
退出 0

pnpm exec vitest run
Test Files 2 failed | 534 passed | 2 skipped (538)
Tests 2 failed | 5141 passed | 4 skipped (5147)
Duration 112.03s; 退出 1
```

两失败仍为 `manhuaNativeDeepReadBatchCli.test.ts:127` 与 `manhuaNativeDeepReadProbeCli.test.ts:83` 的 7201 上限期望，未修改冻结配置或相关测试。

## 现有 UI 备用路径检查

同一原标签页切换自由画布，保留原两个节点，新增 `image-1788788272081-9tkh8`，设置「微调这张图」、单张、16:9，填写既有完全体候选正文。该节点底图尚未上传成功，未点运行，不得把准备节点当生产产物。文件选择器在按钮与实际 input 两条支持路径均未返回；受限调试接口未执行文件写入，不继续重复点击。原六张人物参考仍保留。此路径没有新增生成任务。

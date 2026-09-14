# 老照片修复参数兼容修正（本地部分验证）

## 根因与来源

2026-09-13北京时间11:38:56、11:39:22，生产Fly `d892541f602228` / `sha-9d15eadb` 明确记录：`OpenAI edits HTTP 400: The model gpt-image-2.5-flare does not support the input_fidelity parameter.`

PR1433原提交 `7f89aa7506a618bb6f3b088e011ddb2a10401532`（0910 04:37:19，Co-Authored-By: Claude Fable 5.1）新增无条件字段。署名不能证明底层运行模型。生产源码第196行与该提交一致。

官方图像指南 https://developers.openai.com/api/docs/guides/image-generation 已实读：旧Image2也要求省略input_fidelity；2.5示例使用model/prompt/image/size/quality。实际Flare拒绝回执为本次故障的直接证据。此前代码注释“已核实”不构成兼容验收。

## 修改与双向追链

- `server/services/openaiGptImage2.ts`：删除multipart无效字段、对应环境变量解析及错误日志标识；旧内部inputFidelity选项保留类型兼容但不发送。
- `server/services/openaiGptImage2.model.test.ts`：移除错误参数默认值测试。
- `server/services/proxyImageService.providerOrder.test.ts`：纠正要求必须存在无效字段的旧护栏。
- `server/services/openaiGptImage2.request.test.ts`：实际调用生产封装并解析multipart；网络与存储替换为离线测试接收器，非付费上游实跑。

正向：HomePhotoTools.runRestore → protected restoreOldPhoto → 扣费 → autoCropOldPhoto/buildOldPhotoRestorePrompt → 官方封装 → 垫图/multipart edits → 图片存储 → recordCreation → 页面。反向：页面结果来自同一封装保存的图片，错误仍回原退款分支；未改变金额、权限、存储、模型、prompt、mask、尺寸或quality。proxyImageService的参考图编辑共用此修正，platformHtmlPptImage纯文生仍走generations，未增加供应商fallback或自动重试。

## 验证

改前新增7项：6失败/1通过，六个模型配置的请求均因仍含input_fidelity被测试接收器拒绝；改后4文件26项通过。额外裁切/照片共享合同/用钥回归3文件18项通过。请求体实查参考PNG垫图至1024、蒙版字节一致、prompt/size/quality/model保持、结果字节传给存储，失败不存假图片。

最终非增量 `tsc --noEmit --incremental false` 退出0；修正测试Response字节类型后，7文件44项联合回归通过。`pnpm build` 服务端构建退出0，`git diff --check`通过。未执行线上付费修复、图片身份质量验收、积分账本对账；用户已授权验证后推送开PR、一名独立子代理审查、无问题且即时运行门禁通过后合并；当前尚未发布。不能称线上已修好。

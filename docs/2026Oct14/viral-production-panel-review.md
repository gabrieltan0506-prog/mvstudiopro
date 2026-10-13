# 成稿区补充审查

用户指出上次示意图未展示封面、图文分页和视频导演表。核对后发现封面与导演表原链存在，图文分页数据已有生产者但缺少直接展示。本次补充完整成稿制作面板，用户后续已明确授权本PR合并并直接线上验证。

## 改前证据与双向追链

最终结果：从生成稿件直接检查封面方案、逐页文案和逐镜导演表，并沿原入口生成图片。范围仅前端展示与回调接线；不新增计费、模型或API；参考人像补入本地草稿恢复字段。

正向：扩写服务 → graphicNotePages / storyboardCells / xhsPackage → mapContentBlueprintToExecutionCard → ViralProductionPanel。反向：分页及导演表读取同一执行卡；封面图读取 platformImageMap；生成回调直达原 runSingleCover / runSingleComposite，继续原费用确认、鉴权、快照与后台任务。旧非爆款模式保留原导演表；不清正文、原任务或图片。

## 本次验证

- tsc --noEmit --incremental false：exit 0。
- vite build：exit 0，17.56s；沿用原大 chunk 警告。
- 实际组件独立无网络样例：图文/视频截图；第2页切换匹配正文；封面与配图回调各触发一次；390px手机无页面横向溢出，导演表局部滚动。
- git diff --check 通过；主代理检查完整 diff 与原回调调用链。

## 未验与限制

尚未线上登录验收或真实模型付费出图。截图为虚构样例，封面是文字预览，不伪装成生成图片。分页是每页文案的真实字段展示；图片仍沿现有2×4/3×4组图链，本次未新增逐页独立出图接口。UI有此明确说明。未重复执行未变的服务端业务回归。

当前状态：前端实现与本地验证通过；正式链路部分完成。已获本PR合并授权，仍执行真实任务、部署与CI门禁。

补充：明确暴露4列×2行/4列×3行选择，复用原compositeGridVariant（内部值2x4/3x4）及费用计算。最终类型复验exit0，真实付费探针尚待完成。

## 参考人像补充与隔离验证

- 新入口复用 handleUploadCoverReferencePhoto：文件大小/类型检查→压缩JPEG→鉴权上传→按sceneId绑定；失败保留旧照片。resolveReferencePhotoForScene按本稿、全局、已有封面顺序传给原封面/导演图任务。上传期间禁生成，移除后可恢复全局参考。
- referencePhotos随原草稿按userKey持久化；切账号清除，非法本机URL不保存。已检查正反向字段、旧按钮、批量路径和恢复路径。新增照片仅用户主动选择，不读取其他项目照片。
- 最终类型检查exit0，Vite构建17.35s exit0。实际组件文件选择回调收到文件名与非零长度；分页、两生成回调与390px无横向溢出通过。该文件是界面样例，不是真人人像验收。
- 现有工作机7812595b294778，performance 4 vCPU/8192MB，image7e74166f；独立/tmp目录、env -i、禁止网络。实际组件SSR图文/短视频2项通过；参考草稿vitest 6/6通过。版本为e1628945加本次参考人像diff，未冒充已提交HEAD。
- 原始JSON永久保存在Downloads/2026Oct14/完整探针/viral-panel-ssr-result.json、viral-panel-persist-result.json、viral-production-ui-check.json。无模型调用。
- 尚未线上生成封面/12格图；缺用户指定照片，真人相似度尚未验证。线上无照片探针仍按已展示的虚构职员输入执行。

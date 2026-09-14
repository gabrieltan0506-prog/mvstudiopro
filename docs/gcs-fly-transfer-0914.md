# GCS与Fly转发/转存（0914）

状态：已实现，正在本地验证；未部署、未做正式登录线上验收。

## 改前证据与范围
用户要求所有GCS素材下载经Fly，上传/转存也经Fly，追加PR1461。现有downloadRemoteFile直接fetch GCS，部分页面直接下载链接；签名上传存在omniCanvasApi、growthCampImagePipeline、MVAnalysis、报告快照和云草稿多条入口。当前分支没有photoTemporaryMedia接口，不能引用另一个工作树未合入的接口。

## 双向链路
GCS下载：实际下载按钮/自动下载/工程ZIP读取→gcsTransferUrl→Fly GET /api/gcs-transfer→登录鉴权→仅HTTPS GCS域名→原权限GET→流式返回附件→原下载消费者。
GCS转存：既有服务签发目标对象URL→实际上传入口→Fly PUT同一接口→登录鉴权→原签名URL和Content-Type/x-goog头→流式写入原对象→原状态/登记/云草稿消费者继续使用原对象身份。没有重新生成、重签任意对象、变更计费或自动重试。
这是上传字节经Fly转存到GCS，不提供任意本机/Fly绝对路径读取API，避免越权读取服务器文件。已有服务内uploadBufferToGcs/uploadStreamToGcs不变。

## 错误与恢复
上游403/404等原状态返回，不擅自续签或绕开权限；过期签名由既有归属校验入口处理。拒绝其他域名、端口、userinfo和重定向；不透传Cookie/Authorization到GCS。断线/超时取消传输，30分钟传输上限。下载失败不回退GCS直连；失败不重建生成任务。大文件流式传输，路由在body parser前、CORS后；GCS上传预检允许PUT/HEAD，其他路由方法策略不扩大。

## 验收边界
目前为新增真实路由与入口接线，本地HTTP测试上游使用可辨测试数据，不能算正式GCS实跑。需要部署后用本人真实参考图/视频/GLB/ZIP/音频、签名上传与云草稿走正式登录验收，验证成功与过期/断网恢复。
不改变预览和模型参考输入用途；新增入口必须继续调用公共转发函数，禁止新增下载绕过。

## 本批本地验证结果

6文件39项通过：server/routers/gcsTransfer.test.ts、client/src/lib/gcsTransfer.test.ts、omniCanvasApi.upload.test.ts、downloadRemoteFile.publicRender.test.ts、manhuaClipAutoDownload.test.ts、manhuaCloudDraftSync.test.ts。覆盖真实本地HTTP服务与模拟上游字节、权限/域名拒绝、原签名PUT/MIME、过期响应和下载失败不直连。pnpm check与pnpm build通过；Vite生产构建12.11秒通过，有既有大chunk提示。恢复损坏依赖时使用锁文件冻结安装，无依赖/锁文件改动。

正式Fly路由与登录Cookie、真实GCS签名读写/断网/刷新尚未上线实测；本批未调用付费模型，未部署或合并，新HEAD未独立复审。该限制不以本地测试替代。

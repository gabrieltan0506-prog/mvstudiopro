# Blob 新写入转 GCS：改前证据表

| 检查项 | 当前证据与范围 |
|---|---|
| 用户结果 | 减少 Vercel 存储和传输，将 Blob 文件转 GCS；不是删除博客 |
| 允许与禁止 | 本地实现、验证及必要对象迁移清理已授权；不提交、推送或部署，不读取本机生产凭证，不凭猜测删除旧对象 |
| 新写生产者 | server/storage.ts 的 Blob 分支、server/models/openaiTTS.ts、server/routers.ts 两处图片、api/blob-put-image.ts、api/openai-image.ts、api/google.ts 三处视频、api/jobs.ts 图片/音乐/配音、render.ts 四处成品 |
| 转换与存储 | 原 Blob 上传返回 url/pathname，部分封装为 op=blobMedia；storagePut 仍保留 S3 优先分支。新公共对象写固定 GCS namespace+随机 UUID，不更改业务 key、类型或 schema |
| 最终消费者 | jobs.output 的 finalVideoUrl/videoUrl、画布/工作流播放器、云草稿/本机草稿、导出和后续剪辑；稳定 URL 每次读取重签并跳转，不永久保存短期签名 |
| 权限/计费 | 所替换 Blob 写入原本 access:public，保持原公开地址分享语义；原生成入口及计费逻辑不改。不得扩大为任意 GCS 对象签名 |
| 失败与旧数据 | 上传失败不回退 Blob；保留现有业务错误处理。旧 Blob 读路径保留，旧对象不删除；所有 JSON 保留 |
| 验证 | 公共 namespace 正反例、非空内容、上传失败、短期签名与稳定 URL 分离、旧读路径不变；非增量 tsc、目标回归和完整 diff |
| 已知断点 | 尚无生产对象清单、引用审计或实际迁移回执；需要已鉴权 Fly 执行环境，正式域名、GCS CORS/生命周期及真实播放下载尚未核验 |

此实现是本地候选修改；未上线、未节省已计量的历史流量、未完成旧 Blob 迁移。

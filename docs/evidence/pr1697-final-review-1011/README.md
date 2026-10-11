# PR1697 主审与定向复验

审查基线：base ace1e0d0bb5dd468991d02172a462ff564ecdcbc；原 HEAD a013fbc03d8c643a456ed15d6ca42f748d9353d3。本记录随本批修复提交，最终提交及发布门禁另记知识库。

## 范围和结果

完整阅读生产代码增量：API、客户端入口与面板、composition 执行器、shared schema/编译器、服务/router/jobs、worker、渲染/混音、GCS/CAS与台账、收费与权限、显式探针脚本及构建配置。files.json 为原 PR 文件清单；test-coverage.json 为87个变更测试的用例/断言索引。媒体证据与历史报告按来源和边界核对，不宣称逐帧审过每个历史产物。

| finding | 修复 | 验证 |
|---|---|---|
| PR1697-TYPE-01 | 两测试文件显式类型与unknown转换 | pnpm check，exit 0 |
| PR1697-STORAGE-01 | 共用存储上传前拒绝超过512000字节，保护旧对象 | 512000可读写、512001不上传且原版本保留，1测试通过 |
| PR1697-SEMANTIC-01 | 音频窗先不可变归档，原生fileData引用取代JSON内联base64 | 20秒48k PCM请求可保存、raw恢复不重发，8测试通过 |

正向链：已保存作品/音轨 → 确认语义分析 → 权限/来源hash核验 → 秒窗 → 不可变归档 → 原生fileData请求 → intent/raw/result → 图片制作预检消费同一sourceId。反向由预检结果追到已存sources canonicalUri/hash/window及原作品音轨；恢复复用既有raw，不重复模型提交。存储上限适用于作品、修改台账与采用journal，超限前拒绝写入，不更改计费合同或退款规则。

## 已执行验证

- 本机codeMotionStorageBounds：1测试通过。
- 本机codeMotionImageSemantic：8测试通过。
- 受影响store/revision/soundAdoption/images/timing：5文件31测试通过。
- pnpm check：exit 0；pnpm exec vite build：exit 0，保留bundle体积警告。
- Fly原工作机7812595b294778，独立/tmp/pr1697-final-review-1011，复用部署依赖：上述存储/语义9测试通过，17.47秒，exit 0。NODE_OPTIONS预加载阻断外部网络；GCS/计费为隔离夹具，未修改/app、业务DB或真实媒体。
- 完整变更文本及zip内文本凭证标记扫描：0命中；git diff --check通过。

## 完成状态与未验边界

本批三个缺陷的代码、定向回归、类型、构建与Fly隔离验证均已验证。原PR既有浏览器像素、真实FFmpeg及服务证据复用，前提未变的测试不重复。没有全量重跑整个仓库测试，也没有把9个隔离测试当全部产品路径实跑。

正式线上用户登录、媒体生成/采用/刷新恢复、真实模型内容质量与扣退费尚未因本轮审查而重新实跑；未新增付费。普通3D模型资产→参考预演→视频模型的完整正式UI能力仍未实现，不将代码点云或旁路咖啡样片宣称为该能力验收。长台账超过当前上限将明确拒绝而不是静默损坏，本轮没有扩大存储容量。

可进入发布门禁；必须推送本批提交并实时核对PR HEAD、真实学习/媒体/转换任务、进程、交互心跳、Fly和Vercel部署/CI。当前记录不宣称已经合并或上线；上线后分别核对部署和正式资源。

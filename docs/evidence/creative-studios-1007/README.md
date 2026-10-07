# 两项技能产品化交接 — 2026-10-07

执行代理：skills_integration；基线 `ca7a3c9957229f022146a217cc53dde970259c2b`，分支 `feat/image-world-art-motion-1007`。用户最新要求：完成后由主代理追加同一 PR1676。子代理没有提交、推送、合并、部署或调用付费模型；CDN相关五文件属于主代理，整合时排除。

## 实际功能

- 图片拆景：参考图选择 → 同现有读图模型参数的结构化分析 → 核对每个独立实例 → 原 Image-2 图片请求生成独立物件图/空场景图 → Tripo物件或既有World Labs空间 → 查询候选、明确采用到道具/场景库。未增加FAL/Hunyuan。
- 环境音：保留分析所得环境声说明，按钮创建已保存的SFX音轨并打开原CanvasAudioStudio，复用导入、裁切、试听、采用和合听。**没有新增SFX生成模型；原曲生成仍只用于配乐。** 当前已采用且输入匹配的音轨，可被艺术动画选择为音讯输入。
- 艺术动画：35种程序艺术场景、8种讲解/动态文字语法，横/竖屏、片长、文字/图片/图表、可选音轨；同一打包引擎用于互动预览和worker实际渲染。普通MP4、解说动画透明ProRes MOV、候选采用、媒体选择保存恢复。不是将任意现有影片转换为艺术风格。
- 漫剧工厂和真正的freeform分支均有入口。固定高度预览dock采用可滚动工具区和独立画布区域；顾问在freeform打开方案不会强跳漫剧final阶段。
- 创作顾问支持真实清单inspect、打开open、带revision的完整configure；不自动生成、付费或采用。

## 保存、恢复与付费边界

- 保存完整方案/原请求身份到本机及云草稿后才能提交。新增字段已进入云端白名单和恢复路径，保留任务历史、素材gs身份、未知三维意图、图片任务ID和模型选择。
- 仅成功图片产物可作为3D输入；不能把未生成child的refImageUrl当作产物。模型提交前重新核对真实child输出、作品身份及原pending intent；未知提交复用冻结输入，不更换来源重打。
- 来源图片的gs/恢复后稳定URL经所有权resolver取得新HTTPS，再交原图片入口。任务查询可以读取原来源结果；来源/方案变化时不自动采用。
- 图片分析原意图采用GCS条件创建。原始HTTP、解析响应、完整分析文本、结构化方案分别保存，原始内容先fsync本机持久目录并上GCS才解析；单次调用关闭该次fallback/hedge。只读status不会创建请求或模型调用。
- 物件保留ID拒绝world/__proto__/constructor/prototype；World提示超过原2000字上限要求精简，不静默截断。
- 原生画布生成按钮不能把artMotion节点送往付费视频模型；图片/拆景相关子节点跳回工作台。

## worker永久证据

`artMotionEvidence.ts` 在全局JSON parser之前注册4MB octet-stream入口。受现有JWT秘密的域隔离HMAC、60秒时效、固定名称、真实用户art任务归属保护。接收方必须是网站机并核对`/data`挂载。复用`backupManhuaGlmEvidence`的内容寻址、不可覆盖、文件与目录fsync；raw与含objectName/bytes/SHA的receipt永久保存。

worker通过现有Fly只读Machines查询选择唯一运行网站机，用HTTPS和Fly-Force-Instance-Id发送，不启停或创建机器。依据官方[Session Affinity](https://docs.fly.io/blueprints/sticky-sessions)。先写request作为备份可写预检，再开始渲染；frames/probe也先尝试网站持久卷备份后GCS，单个存储失败仍尝试另一路。网站预检失败即便原请求已上GCS也不开始渲染。GCS写失败时原JSON已在网站卷，渲染失败保留原记录；不自动重做。完全断网、网站卷同时不可用仍会失败并保留本机临时副本，不能承诺该双重故障下替机仍可恢复。

主代理只读确认：工作机无卷，网站有/data卷；`evidenceAuthReady=true`（仅布尔，未导出秘密）。新增传输依赖既有Fly Machines API配置；真正两机传输尚待部署后验证。

## 已执行的开发证据

| 范围 | 证据 |
| --- | --- |
| 35场景+8语法+转场真实Canvas，44通过 | art-motion-runtime-1007.log |
| 契约/分析单次幂等、完整物件、原始先存 | creative-studio-contracts-1007.log |
| 实际Chromium+FFmpeg MP4 1280×720/24帧，取消保留partial，队列幂等/LLM单次 | creative-studio-worker-1007.log |
| 两个真实React工作台离线transport保存/提交/查询/采用 | creative-studio-ui-1007.log、creative-studio-ui-image-r2-1007.log |
| 零值图表、新JSON builder原模型参数不变 | creative-studio-edge-1007.log |
| 实际云草稿构建→序列化→解析→恢复 | creative-studio-persistence-1007.log |
| status零新调用、本机原响应恢复、未知模型输入冻结 | creative-studio-recovery-1007.log |
| 实际透明MOV及音讯mux，24帧、yuva、PCM、1秒 | creative-studio-alpha-audio-1007.log |
| 固定grammar脚本加载、任意脚本路径拒绝 | creative-studio-loader-1007.log |
| 原生生成art拦截，图片续签后来源变化零建单、冻结档位 | creative-studio-submission-1007.log、creative-studio-submission-r2-1007.log |
| child未生成/失败不调用3D，保留ID/提示超长拒绝、真实CSS父布局 | creative-studio-review-fixes-1007.log、parent-real-css.png |
| child在确认期间换图零3D调用，源签名归属/匿名拒绝 | creative-studio-ownership-1007.log |
| 永久备份、原始先持久化、HMAC输入绑定与实际HTTP接收route；单个存储失败不阻断另一永久副本 | creative-studio-durable-1007.log、creative-studio-evidence-route-1007.log、creative-studio-independent-archives-1007.log |
| 实际既有音效编辑器接线0购买；仅已采用有效音轨供动画选择 | creative-studio-environment-audio-1007.log、creative-studio-audio-adoption-1007.log |

原通过项在前提未变时复用，未为了时间戳重复跑全套。UI首轮图片测试失败是测试夹具JSX语法，修夹具只重跑该项；source guard首轮夹具将gs直接传通用入口，发现真实适配缺口后补owned-source signing并定向通过。tsc r3、r5、r7通过（r7 exit0）；r4/r6各具体错误和修复记录保留。r7之后仅有已采用音轨复用helper、备份独立可用性保护及其定向测试，需主代理在CDN新基线整合后一次增量类型校验；不重复既有全套测试。

真实渲染开发产物已另存知识库`漫剧工厂/1007-两技能验证产物/`，不把二进制影片塞进本PR。最初两个UI截图没有Tailwind，只作为交互夹具；唯一父布局截图`parent-real-css.png`使用本仓库真实CSS。

## 明确未验与限制

- 尚未部署；无真实登录用户的图像分析/Image-2/Tripo/WorldLabs付费路径验收，无正式创作顾问模型实问验收。
- 未启动工作机，未执行真实两机HMAC/持久卷传输，未验证长达180秒或1080p的资源负载。已有本机真实Chromium/FFmpeg是开发证据。
- 物件采用是把prop+model3d保存到素材库；本工作台保留原taskId查询续签、ModelViewer预览和GLB下载。现有人物绑定/白模入口仍只接受character，未改其合同，不宣称prop GLB已接人物绑定或白模消费。
- 未将任意影片做AI艺术重绘，未实现新SFX模型、自动物理建模或世界碰撞网格转可编辑物件；不把这些宣称为已交付。
- World旧候选在同底图但方案/质量变化时保留；需新建拆景方案制作不同版本，不以查询旧候选冒充新生成。
- 原生学习冻结参数、现有模型路由默认fallback和其他业务未更改；新增审计/singleAttempt仅新拆景入口使用。

## 上游来源

- image-blaster: https://github.com/neilsonnn/image-blaster ，固定研究版本 `4acb43ba126a12358f71838d1b1a05e856b10eaf`；按独立实例、背景清理、物件提取及空间工作流重新实现，供应商使用产品既有通道。
- huashu-art-motion: https://github.com/alchaincyf/huashu-art-motion ，固定 `26dba25b2b495c2138848c29a2c90df356a20325`。引擎MIT许可、字体单独OFL/NOTICE保留。UPSTREAM.json列原始源指纹和本地适配说明；去掉未使用的demo/任意URL加载，保留产品专用入口。

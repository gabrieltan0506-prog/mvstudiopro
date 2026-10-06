# 创作顾问工作流操作接线

开发 Agent 模型：GPT6 Astra（用户指定标注）。本批范围是七组操作的代码接线、契约检查、构建及追加授权的隔离运行时探针；正式线上工作流和麦克风验收由后续批次执行。用户本人合并，本批不部署，不调用真实媒体服务。

## 共同入口与确认

文字顾问新增“让顾问操作工作流”，沿原问答鉴权、额度、模型路由、退款及请求编号生成一个独立候选。候选符合 `workflow_operation_v1` 和同一 `creativeVoiceProductionSchema` 后，用户确认执行；不自动执行下一步。Live 工具参数从同一契约派生，文字与语音都调用顾问面板的共同执行函数，再分派给工作区及原面板控制器。

真实 ID 来自 inspect 清单。后一项文字请求可以读取上一项回执，素材地址隐藏；原任务与原面板仍是结果来源。作品、正文、图视频/音轨版本、剪辑转场变化使旧方案失效。执行前保存开始记录，回执不明时保留原编号，恢复不会自动重投。写操作串行；只读检查可以在任务运行时使用。原费用确认、角色声线锁、关节点及变形人工确认继续生效，模型不能传入费用豁免、自动重试或外部素材地址。

## 七组生产者与消费者

| 组 | 新操作 | 复用入口与返回范围 |
|---|---|---|
| 剧本起始 | writer configure/trial/expand/confirm | 原模板配置、trialWriterMutation、expandWriterRoom、confirmWriterToDirector；试写为独立对比，扩写不自动确认 |
| 资产管理 | asset regenerate/select/adopt/configure/claim/primary/acceptReview | 原设定图生成、个人库选择/采用、参考图名称分类职责、剧本锚点认领、锁脸/妆造选图和人工审核；剧情设定文本仍沿原整集候选改稿和资产刷新链 |
| 3D 后半程 | modelControl multiview/multiviewSubmit/rigInspect/rigSubmit/rigAdopt/rigRestore；worldControl exportFrame/adoptFrame/clearFrame | 原多视图出图与 Tripo 提交、绑骨面板检查/绑定/采用/还原、3DGS 当前视角 PNG 上传和逐镜采用。取消视角采用保留候选；未接远端世界删除 |
| 正式画面 | generate keyart/clip/retake/selectVersion | 原 runFactory 及片段重拍/版本选择；必须指定当前集真实片段，不自动重试，不重做已保留段 |
| 对白与音效 | audio addCue/configureCue/generateDialogue/adoptTake/selectSource/resume | 原音轨草稿、角色/参考声线清单、配音费用确认、同输入候选采用、已上传音效及原任务结算确认；保持角色声线锁 |
| 配乐与混音 | audio selectMusic/trim/premix/previewMix；scoring configure/analyze/applyAdvice/submit | 原曲候选与实际时长、裁切和 audio_timeline；原 BgmCreativeAdvisor 音画分析及建议采用；原 bgm_mount 正式视频混音，回传 jobId。合听/预混不是最终混音视频 |
| 剪辑与交付 | edit reorder/trim/transition；deliver assemble/subtitle/selectVersion/export | 原逐镜顺序和细剪保存，进出点步进0.5秒；整集完整片段集合合片、绑定当前版本的原字幕时间表、最终版本与下载入口 |

每组有 inspect 操作。资产/片段/世界/音轨仅允许当前作品与当前源版本；长任务仍由原接口与原恢复机制跟踪。新回执没有把“已打开”“等待费用确认”“请求已处理”“入队”写成完成。

## 验证层与未验边界

- 需求、参数契约与跨层静态接线：已检查。新契约严格限制每个 operation 的必需字段和允许字段，拒绝未知字段、空配置、重复剪辑序号和反向进出点。
- 原调用链：文字候选/Live → 共同执行 → 原工作区或面板 → 原鉴权 API/任务/持久化/播放器；反向从原产物字段、任务编号和采用状态核对到同一入口。未新建旁路生产服务、数据表、依赖或计费协议。
- 编译与前端构建：执行全仓 tsc 和正式 Vite 构建；命令与最终回执记录在 PR 及本地知识库。依赖使用本工作树独立 frozen-lockfile 安装。
- 新操作契约、两条 Live 事件解析、原配乐/细剪及问答服务合同：定向测试，真实结果见 PR。原 platformSkillQa 的三项历史断言失败已在基线源码复现，没有扩大修复。
- 新面板操作、费用/退款、取消后恢复、刷新恢复、麦克风对话、真实供应商及媒体质量：尚未线上验收。本批没有付费生产调用，不能拿类型、单测或构建代替这些结论。

独立候选与回执记录目前使用项目隔离的浏览器存储。浏览器无法保存时停止该操作。原工作流的云稿保存/恢复和任务持久化继续由原链路负责；云冲突仍需原页面处理，不让模型替用户选版本。素材名称或剧情设定的语义质量、绑骨关节与变形、逐帧白模及成片音画质量仍需人工验收。远端世界删除没有纳入顾问工具。


## 2026-10-06 隔离运行时补验

使用本次专用 Fly 机器（performance 2 vCPU、8 GB），以 main 镜像叠加 PR 的确切文件，逐文件 SHA256 核对。Vite 和独立 Chromium 运行在同机内，实际加载 `/canvas`、顾问面板、工作台及原音轨、后期和剪辑控制器；服务时观察插桩只暴露实际函数，未用替代组件。测试进程清空继承环境，读数据为显式固定样本，顾问回复为固定候选，外部网络和真实 API 副作用全部拦截。该证据只证明前端运行时接线和浏览器本地恢复。

- 原接线检查 18 项通过：真实面板和非空清单、七组原入口、候选先展示后确认执行、配置/资产改名/选版/音效/转场写入，以及保留片段、重复生成、费用字段注入和取消操作拦截。
- 场景补验通过：无 ID 先读当前归属清单；外来 ID 拒绝；指定场景返回原预览的机位、实例版本和加载状态；连续切换第二场景等待匹配 ID，未读取上一场景。
- 共同执行器并发写拦截通过；写作条件、资产名称、音效草稿和剪辑转场经过整页刷新和重新进入后读回一致。
- 修正两处真实遗漏：共享 inspect 参数漏掉 assetId；原工作台 inspect 只返回清单，未读取已注册预览。预览注册现携带场景 ID，清理及导出均核对该 ID。
- 新增场景字段合同测试 1 项通过（原 43 项未变而跳过），最终全仓 tsc exit0，正式 Vite 构建 exit0、29.67 秒。未重复原已通过的 99 项。

探针早期夹具存在试写记录类型、进入漫剧模式、沙箱注入及第二场景来源版本不一致问题，已修正测试材料；失败回执保留，没有把这些轮次宣称全通过。世界预览的外部模型和 3D 资源被拦截，加载状态回执通过不代表实际世界画面质量。真实供应商、麦克风、付费/退款、云稿保存恢复、媒体输出及正式线上工作流仍未验证。

## 2026-10-06 独立审查定向修复（改前证据）

审查基线 ad8c17f0 / base d3050250，独立审查报告的来源指纹与本PR一致；不混入PR1669的UI施工。

|ID|真实入口与断点|修复范围/验收|边界|
|---|---|---|---|
|WF03-STALE-SCORING · P1|文字候选/Live scoring submit→原混音卡；本地成片、曲目、秒窗/强弱参数未绑定候选|inspect给出当前素材与全部实际混音参数的版本，submit必须回传同版本；A→B或改参数拒绝旧方案，同版本可到原入队入口|保留原确认/计费/任务；原手动混音按当前选择提交，无付费实跑|
|WF08 · P2|原添加对白/音效按钮与顾问addCue共用固定5秒默认，被3/4秒上限拒绝|仅传入片段时长的新增入口使用合法默认；短于默认起点时回到0；显式非法patch仍拒绝|不修改旧音轨、已采用音频或其他未传时长的调用者|

两项均已确认成立，状态OPEN；将复验实际组件控制器/原按钮与同一严格schema，再追加结果。已有99项和隔离探针不重复运行；正式线上和麦克风等部署后验收不算本次新增阻断。

### 定向修复结果

- WF03-STALE-SCORING：本机定向验证通过。`manhuaAdvisorScoringSource` 按项目、素材、采用参数及实际入队参数生成不暴露素材地址的临时版本；原卡 inspect 返回 sourceKey，严格文字/Live submit 必须携带，并在确认前与入队前复核。更改后再切回、组件重建与旧无版本候选均不能复用旧许可。普通 inspect 同时返回原配乐控制器清单。
- WF08：本机定向验证通过。新增音轨按本段时长生成合法默认，再应用用户显式 patch 并校验；未传时长的旧调用保持原行为。
- `pnpm exec vitest run client/src/lib/manhuaAdvisorScoringSource.test.ts shared/canvasAudioCueDefaults.test.ts client/src/lib/manhuaAdvisorWorkflowPlan.test.ts server/services/creativeVoiceProduction.test.ts`：4 文件、85 项通过（19+14+44+8）；最终 `tsc --noEmit --incremental false` exit0；Vite 构建 exit0、23.95 秒；diff-check 通过。
- CUA 操作真实 CanvasAudioStudio/PostProdWorkshopCard 开发组件：3/4秒手动与顾问新增对白/音效合法，1秒对白为0–1；4秒片段显式endSec6拒绝且不新增。A候选换B及同素材改音量均在入队前拒绝，请求记录为空；重新准备同来源B后仅一次到达测试 queuePostProd，成片B/配乐B/音量0.7，回执test-only-1。
- 证据：`/Users/tangenjie/Downloads/2026Oct06/PR1668定向复验/` 三张实际组件截图；测试日志 `/private/tmp/1668-review-fix-tests.log`、类型与构建同前缀日志。
- 双向追链：inspect版本→严格schema→原控制器→两次版本核对→原队列参数；反向由测试队列的B素材及0.7音量回溯到同一快照。短片段由原按钮/顾问共用addCue→时长默认→显式patch→严格校验→原草稿展示；越界失败保持原草稿。

这是本机组件及入队边界验证；网络为明确测试stub，无真实供应商、付费或生产API。先前隔离机结果对应旧HEAD，不能作为本次修改文件的隔离运行证据；本次未重跑隔离机。正式线上、麦克风、实际混音媒体、费用退款与云恢复仍未验，整体保留“尚未线上验收”。

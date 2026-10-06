# 创作顾问工作流操作接线

开发 Agent 模型：GPT6 Astra（用户指定标注）。本批范围是七组操作的代码接线、契约检查与构建；正式线上工作流和麦克风验收由后续批次执行。用户本人合并，本批不部署，不调用真实媒体服务。

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

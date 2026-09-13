# 六阶段续工：改前证据与验收

2026-09-13，基线 9d15eadb。用户要求持续推进至第五阶段、第六阶段先做部分，每十分钟更新知识库；状态不因目标日期升级。

## 修正后的分层实测（12:59）

仍为部分验证，不放行合并。当前新增引擎隔离、源轴和受控基础色修正，本机主渲染可见真实人物眼睛与表情，但自然站姿、动作接地、正式用户入口及最终视觉质量未通过。

- 引擎隔离：真实glTF插件改变引擎后正常/异常都恢复原引擎；本机与Linux3.4实际263项通过，保存重开后的真实眼骨/形态键/网格仍非零，源GLB不改。
- 源轴：本机完整13项通过。Linux独立source-only10项通过（scope明确跳过旧三路径），公开core静态顶点误差1.84e-6m、minZ约-7.14e-7m；真实strike最大位移.974m，非零首帧约.2rad保留。strike最低点-.0714m，接地未过，不能把源白模报告冒充角色接地。
- 旧路径精确像素诊断：Linux plain相同，creature仅1像素/3通道最大5/255不同；88608个骨网格分量及报告完全一致。严格比较两次exit1，原失败不删除、不改判通过；同baseline二次控制相同，额外四次有界控制另记。原场景面集合/绕序/材质等价，但球体面顺序与顶点法线最大1.19e-7差异尚未证明是该像素原因。完整legacy门禁仍未闭合。
- 基础色：仅真实导入目标材质使用独立副本、真实基础色图与UV；法线/粗糙度/发光不冒充颜色。复杂链明确失败，无材质/空槽保留默认。共享数据/材质、实际接槽后异常回滚、非均匀图UV1蓝与UV0红均实测；本机和Linux82项通过。Linux原回执最后一条limits写死“未运行云端”，实际为Fly隔离机3.4运行；原件保留并附执行注释，测试后续改为准确的“未调用付费模型，不验证正式用户入口”，不拿静态文案推断执行位置。
- 主接线：renderer只在models存在时切TEXTURE，边界进入原boundaryZh/warnings，严格报告无新字段；UI启用前说明原始静止姿态、复杂材质拒绝及透明近似。真实headless25/25通过；Models/Report/Render/Recovery147/147通过；pnpm check退出0。
- 本机完整两条48帧链路（双人尾翼、无材质带骨）真实Blender→FFmpeg→FFprobe→报告→同字节恢复2/2通过，15.66秒测试时间；存储为测试替身，不证明正式云用户来源。
- 原公开人物3秒输入/相机/GLB未改，本机完整renderer产生报告与scene并重开，5个原960×540帧生成。主和独审实际看13/37/61：基础色、双眼、张口变化可辨，非Basis表情键.5/1/1；仍T-pose全身预演，脸部细节小，不能外推精细眼神或全片连续性。Linux最新主链72帧待验，第三Mini不发。
- 新Docker构建门禁增加实际软件渲染的基础色/UV/共享回滚测试，复用前一门禁生成的TEST_ONLY无材质GLB；不引入外部资产或付费。最终干净构建和最终提交SHA复审仍待执行，旧镜像不代表本批通过。

原始本机证据在动作模型验收的合并前探针、源轴修复-5.2实际回归、基础色预演-共享回滚UV第十验、公开core主渲染修复-5.2第一验及联合渲染/源轴与外观接线第一验；Linux82与source-only10回执已下载。原失败、原模型及旧MiniA/B均保留。

13:01补验：同原baseline恰好四次控制exit0，四次骨网格/像素/报告均全等，但像素SHA为084d0123...5b0e7（恰好等于此前current，而非此前baseline的e357ef6a...65c59）。因此同一未修改baseline在不同控制上下文也能产生这两种单像素结果；不能将差异直接归因源轴补丁。具体绘制层原因仍未证，原精确比较失败记录不改判、不自动再跑同类控制。最终本机vite构建3587模块、15.89秒exit0，保留原混合导入/大chunk告警。

## 最新实际断点与改前证据（12:32）

当前为部分验证。公开真实人物主链发现两项测试夹具没有覆盖的错误：glTF导入改变渲染引擎，以及源骨静止轴与逐帧姿态轴不一致。引擎保存/恢复修正已在本机及Linux263项通过；源轴修正和基础色预演消费正在实施，尚未验真。原错误渲染主动停止并永久保存失败/场景，不标作超时或成功；原镜像不能代表后续源码。

| 层 | 新增修正的改前证据和范围 |
|---|---|
| 结果/范围 | 同一真实角色不再无动作扭曲，并能辨认眼睛与表情；不改朝向输入、相机、计费、模型生成或公有请求schema |
| 入口/生产 | 原工作台riggedModel → Models本人资产只读/GCS SHA侧载 → render-manhua-previs.py → import_rigged_model；源EditBone仅head/tail但动画用to_track_quat(Y,Z)，零动作出现179.49°伪delta |
| 材质消费 | 原WORKBENCH/MATERIAL看不到虹膜；诊断TEXTURE可见但会读取活动图，不能保证是baseColor。只为导入人物准备受控材质，禁止把normal/roughness/emission当基础色 |
| 契约 | manhuaPrevisReport.ts模型报告.strict()；不得随手新增Python字段导致整条报告被拒。预演外观边界沿现有boundaryZh/warnings消费，不改质量false或接触未验语义 |
| 存储/恢复 | renderer保存scene.blend，服务先永久归档report/scene，再独立进程重开渲染；必须验证重开后引擎、图片、UV、形态键与骨运动，不只验内存 |
| 旧路径/失败 | 仅riggedModel分支改变源轴；无模型白模、马体、互动保持。未知外观链明确失败，旧素材不修改；原请求恢复继续取原产物，不借修正重复付费 |
| 测试/验收 | 本机与Linux真实导入/零动作/非零动作、材质与图片保存恢复、旧路径回归、report/render/recovery测试、主链72帧和原帧人工检查；正式用户资产/UI/账本仍未验 |

公开core输入实际13材质均BLEND、doubleSided、基础色图，只有TEXCOORD_0，无顶点色或基础色乘数；不是所有GLB都符合此子集。预演不冒充完整PBR或成片材质质量。原Linux源骨与相机只读证据支持原-Y输入，眼前向与相机点积0.980801589；不通过转相机掩盖骨轴错误。

## 最新验收增量（11:56，以下旧快照按其时间保留）

当前仍为部分验证，不放行合并。两条原生 Linux 白模与云恢复技术通过，Mini 生成完成但外形验收失败；真实带骨 Linux 兼容修复待复验，正式 UI/数据库/账户扣退未验。

- PR #1455，已推送头为 28133dd6；后续兼容修正目前本地未提交。没有合并或部署。
- Linux Blender 3.4.1 双人/四尾黑翼各 5 秒 120 帧主渲染通过，分别耗时 166832/146970ms；真实 GCS 视频/报告回读与同 requestId 恢复通过。恢复只注入 diagnostics 内存行，不冒充正式 DB。
- Mini A/B 均各创建一次，原任务分别 `task-unified-1789270804-grttmz8g`、`task-unified-1789270973-2fnt9kqr`。B SSH 中断后同 ID 恢复仅查询、creates=0。实际每条 1280×720、24fps、121 帧、5.041667 秒、无音轨。供应商原始终态 usage 为每条 16.443 credits / USD 0.242，总 USD 0.484；不等于用户产品账本扣退验收。
- 主代理和独立审查均看 3fps 联系表及原生关键帧：A 左红右蓝、一次接触回收轮廓可辨，但保留球头方块肢体；B 单四足、四尾双翼展开可辨，但保留分色杆尾和梳齿翼。均违反确认提示词不继承低模几何的要求，视觉验收不通过。没有自动重试、没有第三条付费；采样不证明完整逐帧连续性。
- A 视频 SHA `e4eecceb62f20c2be700716e94f1794835e59880e2a3b86e23a636c8682f1391`，1481390B；B SHA `8b7072de6091b8f29ab0855810050bec0df44dd17ec9717346b83b3c9f86e4db`，1510188B。B 已在原 probe diagnostics 前缀永久归档并云回读同 SHA。原始回执和失效前源文件保留，不用新产物覆盖失败证据。
- 修正前证据：安装 NumPy 1.24.2 后，实际 glTF 导入在 Blender3.4 插件 `gltf2_blender_mesh.py:612` 因 `np.bool` 已移除报错。旧 Docker 只 import 模块未覆盖该调用。生产唯一入口 `import_rigged_model → _import_gltf_asset → bpy.ops.import_scene.gltf` 在原资源预检后仅对 3.4 做局部插件 NumPy 视图兼容，正常/异常均恢复，不改全局 NumPy、不改系统插件、不丢弃法线、不放宽安全检查。
- 测试负例改为依实际语义、真实 BIN/accessor 边界构造，保留 52 项畸形 GLB 导入前拒绝；加入兼容恢复检查。本机 5.2 实际导出→生产导入→重定向/表演 235 项通过。Docker 在 COPY 后加入同一真实带骨测试，Linux 和新构建仍待执行，不能沿用旧 28133 镜像声称新兼容已验。
- 每次合并前独立子代理必须复审最终 SHA 和新证据；即时学习/队列/部署查询门禁保持。真实人物及正式入口未验，不能宣称阶段五完成。

11:56 补验：同一源码包 SHA `beec5e2a7e88edf79ae3ac013ca33b59584aa2350e7425ed2f872eaaed81feeb` 本机/Fly一致，Linux3.4.1真实带骨回归 exit0、235项通过，实际蒙皮432顶点、16骨、48帧非零表演，原52畸形GLB均导入前拒绝。输出 `/tmp/previs-numpy-compat-0913-linux235`；Draco可选压缩库缺失提示保留，当前合同明确拒绝Draco扩展，实际core导入成功。`pnpm exec vitest run server/services/manhuaPrevisModels.test.ts server/services/manhuaPrevisReport.test.ts server/services/manhuaPrevisRender.test.ts server/services/manhuaPrevisRecovery.test.ts`：4文件147/147，4.99秒，exit0。独立审查三文件diff无新增问题，待提交SHA绑定与新镜像构建；视觉失败门禁保持。

| 检查项 | 当前证据与本轮边界 |
|---|---|
| 最终结果 | 剧本动作可审阅生成双人互动白模，随后接四尾黑翼、标准带骨角色和真实表演控制；必须有可见产物 |
| 范围 | 扩展现有动作白模，不换技术栈、不改账本/角色权限/冻结读片链、不发付费模型任务 |
| 入口 | ManhuaScriptWorkbench 的 activeSegment.shots → ManhuaPrevisStudio；当前人工演员和动作 |
| 生产者 | shared/manhuaPrevis 新增事件契约与独立剧本编译；renderer 固定脚本按同一事件驱动双方骨骼 |
| 转换/存储 | canvasTypes 与 manhuaCloudDraft 都调用共享 studio schema；请求先存草稿、jobs 后台排队，GCS request/report/result 与 SHA 永久证据 |
| 消费者 | 候选显式采用 → manhuaSegmentRefs.previs.motionGuideZh → canvasRunBlock；生成不自动替换旧参考或出收费成片 |
| 权限/费用 | adminProcedure 与本人任务身份保持；普通post_prod旁路禁止白模提交；不动付费路由 |
| 失败恢复 | 原requestId幂等、失败旧产物保留、恢复必须复验新事件报告与输入，不能缺新报告也判成功 |
| 测试 | 新编译/契约/恢复测试，真实离线React事件，Blender真实骨接触与媒体输出、类型、构建、完整diff |
| 已知断点 | 第①正式登录全链/生产重启/并发未验，真实扣退延期；6角色30秒失败不改成通过；高级角色尚无生产验收 |

## 双向追链要求

### 独立审查修正前证据（11:24）

编译器原先仅检索动作种类，导致否定“甲不出拳”、同类重复动作、站定后转身等剩余动作被误记为整镜已映射。真实入口仍为工作台sourceShots→compilePrevisScriptDraft→显式采用→共享spec/scriptSource→云草稿/预演；修正范围仅本地编译与回归，不改模型、账本或队列。改为完整句式匹配，无法完整消费的原文进入unmapped，旧配置不覆盖。验证须覆盖单人和双人、否定/重复/残余动作，正反核对mappedShotIndices与scriptSource.unmappedShotIndices、原文及用户采用路径。

### Linux运行依赖修正前证据（11:31）

隔离Fly Blender3.4.1真实运行带骨测试时，glTF addon缺numpy，exit1；dpkg确认python3-numpy未安装。生产import_scene.gltf也依赖该addon，不只是测试导出问题。用户明确提出安装，最小改Dockerfile显式安装发行版python3-numpy并用Blender自身import numpy及glTF导入模块做构建smoke；隔离机同样补包验证，生产机不原地安装。后续必须重跑真实Linux带骨测试和独立复审；未做干净容器构建前不得标此依赖全层验证。

正向逐镜保留来源与未识别文本，角色明确绑定，草案预览后显式采用；不凭文本出现两个人名自动制造命中。反向从报告事件ID、actorId/targetActorId、contactFrame与误差回到提交spec和原镜。旧无新字段输入必须保持原行为；新字段绝不静默丢弃。剧本修改不自动覆盖已采用参考或在途任务。

## 并行所有权

- 主代理：共享契约、剧本编译、UI/服务/恢复接线和联合验收。
- 双人代理：主renderer与previs_interaction.py。
- 尾翼代理：previs_creature.py及其独立测试。
- 角色模型代理：previs_rigged_model.py及独立验证；主代理负责身份鉴权下载接线。
- 所有代理每十分钟写专属知识库进度，避免覆盖主记录。

## 本批收口审计（2026-09-13 10:59）

整体状态：部分验证，尚未做Linux3.4及付费Mini探针，不能称线上完成。用户最新要求本批验证后commit/push/开PR，探针通过再合并，随后才做下一批；第⑥两个独立离线原型文件不纳入本PR。

| 层 | 状态与证据 |
|---|---|
| 需求/边界 | 已验证：②～⑤扩展原白模，不改账本/权限/读片；旧稿无新字段保持兼容。Mini最多3条各5秒720p、$1/条与$3总预算另有明确授权，当前0次创建 |
| 入口/交互 | 已验证离线：工作台真实activeSegment.shots进入草案；审阅后采用，源或当前spec变化拒绝旧建议；旧配置与旧参考分别恢复。headless真实React15例，模型/尾翼编辑不自动提交 |
| 数据生产 | 已验证离线：原镜编译33例，真实双人事件与尾翼骨网格、真实GLB/蒙皮/eye/morph驱动；不是空生产者。仅识别有明确角色及动作结果的有限中文句式，未映射原文完整保留 |
| 契约/转换 | 已验证离线：受控interaction/creature/riggedModel/performance；完整16骨映射与5项资源计数严验；24cue指引到3种视频路由出站不截断。编辑中草稿允许空数值，正式提交严格拒绝 |
| 服务/副作用 | 已验证离线：本人同资产已成功3D来源只读，不推进生成；SHA/字节核对，64MB单模型/128MB总量，取消不继续写入。新增实际顶点×帧×构图遍历12m保护值，不冒称Linux时限已验 |
| 存储/恢复 | 已验证离线：13例云草稿JSON往返/真实恢复/配额降级保留高级字段；53例同任务恢复，篡改/缺映射即使重封SHA也拒绝。正式GCS/DB新路径待探针 |
| 消费/展示 | 部分验证：两条2秒960×540/48帧主renderer→FFmpeg→FFprobe→严格报告→本地storage→恢复通过；主已看帧，双人/四尾黑翼可见，带骨仍仅TEST_ONLY灰盒，不是人物视觉质量通过 |
| 静态/回归 | 已验证当前冻结版：pnpm check退出0；17个TS文件332/332通过（10:58:33）；带骨Python221项/52畸形GLB零导入调用；独立资源17/17；投影数值/预算5768项。较早pnpm build和vite build退出0，最终vite重建另跟踪 |
| 真实链路 | 未验证线上：生产Blender3.4、正式登录/公共队列/云模型来源/云恢复/生成片跟随质量。真实账户扣退继续延期。Mini探针不能替代本项正式用户验收 |

实际修改：shared/manhuaPrevis及新Script/Rig/Guide/Persistence；ManhuaScriptWorkbench、ManhuaPrevisStudio、新RigControls/Form；manhua3dTask只读来源；manhuaPrevisModels/Task/Render/Report/Recovery；主Python与interaction/creature/rigged_model/projection四模块；上述对应测试及本批规则/验收文档。未修改原3D生成/导入入口、视频供应商路由、计费、退款和冻结学习合同。

## 资源安全及支持边界

- 导入前检查真实buffer/accessor/sparse/indices/JOINTS/WEIGHTS/morph、节点无环/共同骨根/四元数/逆绑定矩阵/世界变换、实例总量、内嵌PNG/JPEG像素与结构。未知扩展及内嵌动画明确拒绝，不先交给Blender。
- 当前仅支持无扩展、无内嵌动画的单套已蒙皮core GLB，不自动支持VRM/多skin或无骨模型。左右眼骨须真实有权重，三种表情须真实非零头部局部形变；缺控制器报错，不造假。
- 带骨角色暂不参加双人接触，源白模脚底误差不冒充角色真实接地。WORKBENCH材质色仅预演，尚未验纹理与人物成片质量。
- 12m顶点帧为保守保护值，本机固定投影微基准约5.9倍改善不等于Linux端到端性能结果；历史六人30秒仍是失败，不扩大2700旧白模预算。

## 可复验命令与产物

- pnpm check；pnpm build；pnpm exec vite build；git diff --check。
- 最终vite重建退出0；补跑pnpm exec vitest run canvasDramaStudio manhuaSeedanceLayout：4文件124/124，11:04:52开始、3.58秒。
- pnpm exec vitest run shared/manhuaPrevis.test.ts shared/manhuaPrevisScript.test.ts shared/manhuaPrevisPersistence.test.ts shared/manhuaPrevisGuide.test.ts client/src/lib/manhuaPrevisChain.test.ts client/src/lib/manhuaPrevisRigForm.test.ts client/src/lib/manhuaPrevisStudio.browser.test.ts server/services/manhuaPrevisModels.test.ts server/services/manhua3dPrevisSource.test.ts server/services/manhuaPrevisReport.test.ts server/services/manhuaPrevisRender.test.ts server/services/manhuaPrevisRecovery.test.ts server/services/manhuaPrevisTask.test.ts server/routers/manhuaPrevis.test.ts server/jobs/postProdJob.test.ts client/src/lib/canvasProjectVideoReferences.test.ts client/src/lib/canvasProjectVideoReferenceFailure.test.ts：332/332，17.80秒。
- blender --background --factory-startup --disable-autoexec --python-exit-code 1 --python server/scripts/test_previs_rigged_model.py -- 独立输出目录：最新221项通过。
- blender --background --factory-startup --disable-autoexec --python-exit-code 1 --python server/scripts/test_previs_projection.py -- 独立输出目录：5768项通过。
- PREVIS_JOINT_E2E=1、PREVIS_BLENDER_TEST指向本机Blender、PREVIS_TEST_RIG_GLB指向TEST_ONLY夹具、PREVIS_JOINT_OUTPUT指定独立目录后运行manhuaPrevisJoint.integration.test.ts：最后冻结版2/2，29.08秒。
- 本机完整证据：/Users/tangenjie/Downloads/2026Sep13/动作模型验收/联合渲染/六项边界冻结复验/；带骨安全加固-第六验/；投影优化第一验/。它们不是生产账号或部署回执。

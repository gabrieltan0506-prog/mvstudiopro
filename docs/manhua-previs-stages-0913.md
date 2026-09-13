# 六阶段续工：改前证据与验收

2026-09-13，基线 9d15eadb。用户要求持续推进至第五阶段、第六阶段先做部分，每十分钟更新知识库；状态不因目标日期升级。

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

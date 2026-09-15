# Fable 固定施工与两轮审查方案

本PR当前只交付施工文档，没有实现下列功能。用户要求把undo-plans剩余任务交Fable，Codex最多两轮集中审查，不派子代理。第一轮一次列全可复现阻断与修改位置；第二轮核修复及受影响链路，仍未闭合如实交Fable自审，不自动视为通过。用户最新要求：必要扩项直接纳入，把完整产品链一次做通；不能只修既有审查点。两轮限制针对Codex审查轮次，不限制Fable完成必要实现。

## 当前基线和分支归属

- PR1463已合并：6db0aefca13dc505f407c899cfa992711a3851dc。出站确认复用，不重写。
- PR1461同步main并推送726394705a812df3cfc86f1d4a073ca424ac7864；类型检查0、5套件41项通过；合并与上线状态接手时查实时值。
- D已有模块：/private/tmp/mvs-d-idempotency-0915，feat/manhua-generation-intent-0915，0c9497cf。
- 3D已有合同：/private/tmp/mvs-3d-actionplan-0915，feat/manhua-action-plan-contract-0915，01948665。
- 本文档PR作为统一施工入口，Fable单人按D→3D顺序追加提交，不同时在旧1461/1463双写。目前无需第二张PR。若以后独立拆分，先列准确文件归属和依赖，不按行数或代理姓名拆。
- 接手先fetch main并核已有模块提交范围，再只迁对应模块及测试；不要整分支盲目cherry-pick历史修改，也不要覆盖他人未提交文件。

## D：生成意图、扣费前裁决和恢复

完整12项故障验收见同目录D-完整施工单.md；其中旧A/B人员、冻结及归属文字以本文件为准。复用已写符号：客户端resolveCanvasIntentForRun、persistCanvasIntent、findReusableCanvasIntent；服务端acquireCanvasIntent、lookupCanvasIntent、renewCanvasIntentLease、updateCanvasIntentStage、computeServerRequestDigest。它们尚未接成产品链路，不能把纯模块测试当完成。

### 改动位置与执行顺序

1. server/services/canvasGenerationIntent.ts：先核租约接管是否真正原子；两个过期接管者同时读旧记录不能都取得执行权。校验持有者与写状态必须处在同一原子条件，不能先读后rename冒充CAS。跨机器共享卷不能证明时保守拒绝接管，不宣称跨机器唯一。
2. api/jobs.ts：七处createCanvasVideoTask（试片、超分、海螺、Wan、HappyHorse、Seedance两条）逐个接统一适配器，按任务实际body算摘要，不套同一模型格式。登录用户决定归属。裁决先于扣费；同键不同输入409；creating/unreadable不可当不存在。
3. server/services/canvasVideoTask.ts：建单沿用预留taskId；扣费恢复沿用chargeKey。worker接管不能仅凭新租约重复发上游；已有上游ID查原单，提交结果未知保留unverified。供应商没有去重/查询能力时禁止自动重发。
4. client/src/lib/canvasRunBlock.ts：保留fetch紧前当前scope确认守卫，全部runner（含HappyHorse/video_edit）传稳定intentId映射的idempotencyKey。准备/预览不创建付费意图，不扣费。真实执行登记inFlight须早于第一个await。
5. client/src/lib/canvasVideoTaskResume.ts、canvasDramaStudio.ts：已知taskId查询；未知按原intentId查询；批量依赖改变暂停受影响段待确认，不自动批准新输入。
6. FreeformCanvas.tsx、OmniCanvas.tsx、ManhuaScriptWorkbench.tsx：显示待确认/提交中/正在核实/运行/终态。当前输入改变保留旧任务记录和旧take；普通重试恢复旧意图，明确再次生成才新建。
7. canvasTypes.ts、云草稿/导入导出：只添加真正需要持久化的引用，运行中记录不能被容量截断丢失。恢复线索与当前出站批准分离，不从磁盘恢复旧epoch批准。

### 提交顺序示意（伪代码，不是已编译补丁）

```ts
// 适配器参数以现有函数签名为准；这里只固定副作用先后顺序。
const decision = await acquireCanvasIntent(serverOwnedScopeAndDigest);
// conflict -> 409；existing_task -> 原任务；creating/unreadable -> 可查询状态，零新单。
// 唯一有效持有者：沿用decision预留的taskId、chargeKey。
await verifyCurrentOwnership();
await chargeUsingExistingAtomicChargeKey();
await updateCanvasIntentStage(chargedWithSameIds);
await verifyCurrentOwnership();
const task = await createCanvasVideoTask(bodyWithReservedTaskId);
await updateCanvasIntentStage(taskCreatedWithSameIds);
// 以上两个ownership调用不是原子副作用隔离的证明。
// 过期持有者仍可能继续运行，扣费/建单/上游各层必须沿用既有原子去重或fencing。
```

验收必须计数真正入口POST、持久化任务、有效账单和上游调用四层；不以静态守门、spy扣费次数、fs.link唯一赢家替代全链证据。无真实数据库或供应商条件时明确未验，不付费试跑。

## 3D：在既有合同上接生产者与消费端

复用shared/manhuaActionPlan.ts、manhuaActionPlanTiming.ts、manhuaActionPlanBindings.ts及其测试。不要重造scene层、全员每镜手填、另造慢动作时间轴。初始状态+逐镜变化编译全员快照，省略继承/null清空/值覆盖；actorId稳定，画外人物不删除。12人只是合同容量，不能扩大previs执行上限。

### 文件与代码接线方案

| 文件 | 固定修改内容 |
|---|---|
| 新增 client/src/lib/manhuaActionPlanAdapter.ts | 从真实导演板/ShotIR/资产生成绑定上下文；surfaceRef来自实体ID和版本，不能由中文标题生成；屏幕坐标不能冒充world |
| shared/manhuaActionPlanBindings.ts | 复用既有校验，不倒灌来源缺失证据；相机无秒数则unresolved，禁止自证覆盖 |
| client/src/lib/canvasTypes.ts + manhuaCloudDraftSync.ts及真实shared草稿schema | 动作计划/批准版本往返，旧稿默认unplanned；需核实际strip字段生产者 |
| client/src/components/ManhuaScriptWorkbench.tsx | 添加动作节奏入口，面向创作者展示起手/爆发/接触/卸力/反击；不要求填骨名或JSON |
| 新增 client/src/components/canvas/ManhuaActionTimeline.tsx | 编辑镜头timeMap与事件、角色对手、入场/落点；同镜正常交锋与指定腾空慢动作分开 |
| client/src/pages/OmniCanvas.tsx | 唯一动作计划状态源，修改使批准失效；接导演板与工作台，刷新恢复保持身份 |
| client/src/lib/canvasDramaStudio.ts + shared/manhuaShotIR.ts | 同一计划编译导演描述/实际生成输入，绑定角色和攻击对象；确认所见与实际提交继续同源 |
| 新增 server/services/manhuaActionPlanPrepare.ts | 执行前编译快照、核world/表面/相机/版本/能力上限，产生统一执行包；approvalCurrent不能当总执行门禁 |
| server/scripts/previs_rigged_model.py及现有previs入口 | 消费同一执行包与timeMap；坐标/单位/轴线显式转换，不复制第四份镜头时间 |
| 现有任务/产物存储与UI结果面板 | 镜头失败定位、依赖版本失效、保留旧take；按供应商真实生成单位重做，不能承诺任意单帧免费修复 |

### 执行包示意（建议新增类型，字段映射须对齐已封合同）

```ts
type PreparedActionExecution = {
  actionPlanId: string;
  planRevision: string;
  bindingRevision: string;
  shots: Array<{
    shotId: string;
    actors: CompiledActorSnapshot[]; // 引用实际快照类型，不另造状态含义
    timeMap: ManhuaShotTimeMap;
    camera: ResolvedCameraBinding;
    events: ResolvedActionEvent[];
  }>;
};
// 准备：schema -> seal/版本核对 -> 全员快照 -> 绑定证据 -> 能力上限 -> 执行包。
// 摄影机、角色、效果必须共用源时间，presentation时间通过同一timeMap换算。
```

上例中CompiledActorSnapshot/ResolvedCameraBinding/ResolvedActionEvent为建议类型名，不是仓库已存在导出。先用真实类型组合，不粘贴虚构import。sealing、approval和执行允许各有职责，不以版本一致代替空间证据。

### 固定验收镜头

四人船战：男/女先交锋，两次交锋机位变化；两伏兵出水各有独立冲击浪、各有登船落点；登船后男→甲、女→乙，另一人不能消失或继续原男女互打；末尾收招停手再问你们是谁。常速短促出招与腾空中段慢看分离。不是本轮新付费生成指令。

自动验证身份/时间映射/绑定和往返；白模实际逐帧审片并常速播放，最终模型片另审人数、攻击对象、接触、声音。无法实际读片的环节标未验，不用JSON绿灯通过。

Lux3D列在本批末尾：仅做经Fly的真实任务适配及已有任务恢复，先读已安装skill和服务合同；凭证留服务端。新生成需单独授权，不能因为已有插件就提交付费任务。若资源未具备，保存明确断点，不伪造GLB/骨架。

## 两轮交审包固定内容

第一轮前Fable完成本轮全部接线、自测和自审，提交HEAD/完整diff/入口链/12项D结果/3D能力矩阵/原始失败日志。已知失败须同基线证据。第一轮Codex集中出阻断列表、文件符号和修正方案；Fable一次修齐。
第二轮仅核这些修正与直接回归。两轮后仍有风险明确交Fable自审；不把额度不足写成可合并。用户禁止子代理，Codex不唤醒任何审查子代理。

每十分钟更新知识库和Downloads当日交接；无付费调用。显式git add本线文件，不git add -A，不自动合并本施工PR。代码在一张PR内按D/3D独立提交便于查看；未实现部分保持草稿标记。


## 用户追加授权：必要扩项现在做，按完整产品交付

本节覆盖上文及旧D施工单里“不要扩项/只修本线/后批再做”的限制。目标仍是漫剧工厂，不扩到爬虫或无关业务。Fable可直接补齐为完成下列闭环所需的类型、适配器、持久化、迁移、UI、worker与测试，不再逐文件回来请示。

- **生成可靠性全链**：七条API入口、所有runner、真实点击/批量/重跑、刷新、多标签、跨实例部署边界统一。若文件租约不足以提供原子接管，采用现有数据库能力实现条件更新/唯一约束及迁移，并给出旧记录迁移、失败回退和部署顺序；不维持已证明不安全的机制只为少改文件。供应商不支持去重时产品必须提供待核实状态与查询处理，不能伪造exactly-once。
- **动作完整交付**：四人身份/状态/对手、场面空间、镜头与动作共用时间映射、事件快慢节奏、出水/落地/船面绑定、特效事件与摄影机同源。UI能编辑、撤销和恢复，角色/表面/相机来源变更后旧批准准确失效。不要只提交schema和示意图。
- **资产到执行**：Lux3D资产经Fly任务服务、持久化、查询恢复、GCS结果与采用记录；接入真实模型的单位/轴向/材质/骨架检验，兼容已存在绑骨入口。插件不可用或无合格模型时提供真实不可用状态，禁止空按钮或假产物。
- **镜头修复与验收**：实现结果与参考对照、失败镜头/事件定位、依赖失效和旧take保留，支持供应商允许的最小重做单元；验收记录按角色数、攻击对象、接触、节奏、音频分别保存，任务成功不能自动通过内容验收。
- **声音接线保真**：沿用既有字幕/对白/BGM/音效参数及逐句锁秒、声线引用；不得回退到强制整条对白母轨或禁止BGM入引擎。动作timeMap改变时校验对白/音效时间范围与镜头时长，不悄悄让音频漂移。

实施顺序：D闭环提交 → 3D持久化/适配 → UI和执行器 → 资产链与结果验收。统一PR1464，逐阶段独立commit便于定位；若实际需要第二张PR，按独立部署依赖拆，不同时修改公共入口。代码量不作为拆分原因。

全部实施和自审完成后再交第一轮，不拿缺关键接线的半成品耗审查轮次。第一轮集中审产品链和必要扩项；第二轮验证修正。两轮后剩余由Fable自审如实列风险，不自动批准合并。生产付费请求仍需明确授权，本节不授予自动生成/重复扣费测试。

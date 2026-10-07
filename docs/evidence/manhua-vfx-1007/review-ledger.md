# PR1675 续工定向修复台账

- Base: `36a04e3de92ae16a9523372b7f3c3ce3a4f00089`
- Reviewed HEAD: `9692764cae8aa7b4147b7ac0d56c679d36277494`
- Owner: root. 2026-10-07，用户要求继续施工；不是第三轮全仓审查。
- 复用首批 README、source-fingerprints.json 与原日志。以下仅补尚未覆盖的异步保存和转场拒收路径。

## 1675-VFX-SCOPE · R2 · FIXED · P1

- 位置：`client/src/pages/OmniCanvas.tsx:persistManhuaVfxState`，`ManhuaVfxEditor.tsx:submit/persist`。
- 触发：提交期间切换作品/账号或还原备份；旧异步 callback 随回执返回才进入保存。
- 根因：保存函数入场时读取新的 current scope/epoch 作为本次身份，未核对闭包所属身份，且把闭包旧 edges 写入最新快照。
- 影响：旧请求可能写入新作品草稿，同作品迟到回执也可能回退用户新连线。
- 调用链：VFX editor → PostProdWorkshopCard submit/poll → OmniCanvas persist → 本机草稿与 syncCloudDraftPayload；scope 在 episode/project/user 切换更新，restore bump epoch。
- 依据：`continuation-reproduction.log`，执行真实生产 callback，项目/账号/restore 三种迟到均未拒绝，edges 实际写成 obsolete-edge；一项 in-flight 检查原本通过。
- 最小修正：捕获所属 scope/epoch，写入前和云保存后双重核对；采用最新 snapshot 的 edges；卸载 editor 不再调用保存。
- 邻接：不改队列/计费/原请求号、不覆盖产物，空状态仍沿原路径；回到原作品用已持久化原意图续查。

## 1675-TRANSITION-EVIDENCE · R2 · FIXED · P1

- 位置：`server/services/manhuaTransitions.ts:probe`。
- 触发：原片转向/缺少视频轨道被拒收，或 probe 含多个音轨与额外元数据。
- 根因：parsed 文件在业务校验之后才写入，且内容只是 normalized 摘要。
- 影响：拒收没有完整 parsed JSON，成功路径也丢失 parsed 中的完整音轨证据。
- 依据：`continuation-reproduction.log`，两个拒收 fixture 的 raw 已留，parsed 不存在。
- 最小修正：raw → 完整 parsed → 原业务校验 → normalized；不改转场 filter、帧时序或声画合成，不重渲染旧 FFmpeg 通过项。

## 两项 FIXED（工作树，待本轮提交）

- `continuation-failed-only-fixed.log`：只复验原失败的 6 项，6 通过；原已通过的 in-flight 检查跳过。
- 原码反证：同一新增测试在改码前实际失败，失败日志保留，不需再破坏工作树变异。
- 尚未线上工作流实测。用户新授权现有工作机隔离探针，先核对实时任务与机器；不得把探针等同正式用户验收。

## 1675-LINUX-HIDDEN-LABEL · R2 新环境证据 · FIXED · P1

- 位置：`server/scripts/previs_scene_effects.py:_world_vertices/measure_scene_effects`。
- 实测：现有工作机 Blender3.4.1；label 48帧报告已永久云归档，字体Noto CJK打包及字形检查都通过，最大attachmentError为0.1916140183m；最后一帧引线端点回到原位置，而隐藏标注的matrix_world停在上一可见位置。
- 影响：Linux上有隐藏帧的骨骼标注报告会被严格门禁拒收，不能以Mac5.2通过代替。
- 原始证据：`post-prod/isolated-pr1675/probe-evidence/20261007T081759-9692764c/label/scene-report.json`，SHA `edbbe3967344d66c30347535bfd708bd9be81028dfc8e501b2115be6fac63fd2`；同目录failure.json保留。机器本次原正式镜像不变。
- 定向修正：测量隐藏对象时临时静音hide_viewport曲线并重新评价同一帧，finally恢复原曲线及可见性；不改动作、骨骼、镜头或真实渲染可见性。
- 下一步：只在Linux复验失败label路径及帧/隐藏状态保持；布料、分件、12种VFX已通过不重跑。探针补完整stdout日志，避免Python异常只剩公共友好错误。

## Linux label 修复实测关闭（工作树，待提交）

2026-10-07，工作机7812595b294778/Blender3.4.1，label-r2实际39166ms通过。48帧挂点误差、字体打包/字形、隐藏状态保持均由原probe断言执行；原失败证据不删。云回执 `gs://mv-studio-pro-vertex-video-temp/post-prod/isolated-pr1675/probe-evidence/20261007T081759-9692764c/label-r2/result.json`。源包 `source-manifest-r4.json`；bundle SHA256 `1c8cd61f7db0eb7322e83ce5377c81b09d67381570da46728281cf79e9d46b41`。未重跑通过的VFX/Cloth/explode；未正式线上验收。

## 用户新增可操作UI：定向实现与验证

- 目标：原组件内真实时间轴/比较，非克隆其他工作流、非图片空壳。
- 调用链：Timeline.onChange → draft.composition → 原resolveDraft/persist/onSubmit；Comparison仅用当前来源的已完成output.gcsUri，采用沿原canAdopt守卫。
- 新增完整React交互场景通过，覆盖参数入保存与提交、比较音轨切换、配方失配禁采用、恢复后采用、切来源清空比较。模拟存储和play，只是开发证据。
- 增量类型检查最后exit0；新增夹具隐式any修正不改变运行逻辑，已过交互不重跑。
- 无新增模型、计费、队列、冻结读片参数改动。正式站实际按钮/恢复待用户合并部署后验收。

## 新增预览交互：实际链路核对

展开只改变同一section的原生fullscreen，不卸载编辑器或更改草稿；打开顾问先退出fullscreen，再沿PostProdWorkshopCard.focusStudio/onOpenAdvisor原链。轨迹位置与Python固定renderer按7时刻对照；记录点使用当前插值位置，避免看到的位置与保存位置不一致。关键秒位按钮修改实际video.currentTime与挂点。新增路径2项通过（其中1个夹具问题定向修复），旧工作台提交/采用及卸载通过结果复用。无生产队列、计费、模型与机器变更。

补验关闭：展开后原父层候选播放器会被 fullscreen 顶层遮挡，现预览前先退出 fullscreen；保存/采用回执同时写入工作台内的可读状态。新增第三场景通过（ui-fullscreen-preview-r2.log）；首轮夹具遗漏真实样式而不可滚动，补用实际 Tailwind theme 与三个生产组件的 class 生成 CSS 后仅复验该失败项。三个新增场景分次全部通过，未重跑前提未变项。最终增量 TypeScript 检查 exit 0（ui-workbench-guide-typecheck-complete.log）；本次最终源码 SHA 见 guide-source-fingerprints.json。以上均为开发证据，非正式站验收。

最新用户明确授权本次无问题后由代理合并 PR1675，覆盖此前仅本人合并的限制；用户同时说明 Inception 学习约两小时。在途任务/部署安全门禁未撤销，当前仅提交推送，必须实时确认任务收尾、持久化与部署空闲后再合并，不启用可能抢先部署的自动合并。

## 1675-ADVISOR-PREVIEW-SEMANTICS · P2 · FIXED

真实首选顾问baseline回答不知展开/比较，混淆位置参考与实际候选并建议采用后验真；fixed补验关闭这些项但发现多层分开渲染误导，layers定向补验关闭。共享HELP被普通问答、文字操作及Live工具引用，最多12层同一次render，来源/费用/操作Schema与参数不变。三次原生模型原始/解析JSON永久GCS读回SHA，完整失败和修复回答见advisor-understanding。无实际作品执行，正式站Live语音与用户操作仍待部署后验收。

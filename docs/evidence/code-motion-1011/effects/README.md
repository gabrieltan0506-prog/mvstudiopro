# INK 免费特效配方：实际代码交付

审阅基线：`bf42ff4e6ee8a462c86b1e1dc9081288bdf57691` + 本轮工作树，images 子代理不提交／推送。UI、底层 schema/runtime 与场景编辑器由主代理及其他代理集成；以下不是线上验收。

## 新生产者与完整消费链

`shared/codeMotionEffects.ts` 的 `applyCodeMotionEffect` 写入现有逐镜元素，工作台共用同文件 `CODE_MOTION_EFFECTS` 分类与说明。新增：

- `columnAnnotations`：三张已选图对齐，15个图文/焦点元素；注记按0.16/0.38/0.60镜长入场，持续到镜尾。标签来自原素材名，不编造比较数据。
- `paperStack`：2–4张已选图；每张方角纸面＋contain原图，保留源ID；轻倾斜与层级按确定顺序进入，旧页保持在场。最多8个新增元素。
- `imageReveal`：仅给既有image加局部揭示；保留imageId、fit、位置与其他字段的关键帧，时刻碰撞时保留原ease。没有图片的代码镜头不假造素材。
- `pointMorph3d`：真实pointMorph sphere→torus，240点/固定seed41；morph0→1，camera.orbitY增加35度，保留原相机位置／zoom动作。不是GLB或3DGS生成。新增元素位于既有布局上方，不被纸面遮没。

调用路径：`CodeMotionEffects.tsx` → helper → `CodeMotionStudio.tsx` project state/save → `codeMotionProjectSchema` → `server/routers/codeMotion.ts save` / `server/services/codeMotionStore.ts` → `compileCodeMotion` / `resolveCodeMotionCompositionImages` → `client/public/art-motion/engine/composition.js`（正式preview/export共同消费者）。

不双扣：helper为同步纯数据变换，没有provider、job、扣费调用。不盖旧图：brief素材、原元素与文案保持，新增布局使用专用前缀；重复采用只替换该前缀。部分被原片覆盖的整镜不处理，codeVideo对象保留。新布局是额外画面层，需看预览核对与既有内容的构图关系。

缺图（3栏≥3、纸堆≥2）、图文镜长不足4秒、元素/图层/粒子/全片动作容量不足时原子拒绝，输入对象不改。不使用缩略图或假文档替代未提供的素材。

## 本次实际验证

前提变化：新增配方与image揭示，旧effects没有这些入口证据，因此运行新增单文件。随后新增3D前景与容量防护，只补验受影响3D用例，未重跑已通过5项。

- `recipes-test.log`：5 PASS。真project schema→JSON保存恢复→compile；断言三个原URI、原注记名、固定x、镜尾累计opacity=1；四张方角纸contain+不同rotation+后页layer顺序；视频覆盖跳过；素材/容量失败无写入；图片揭示不改变原x速度。
- `point-morph-recipe-test.log`：初次3D1 PASS，随后层级防护变化使此单项证据由下一份替代。
- `point-morph-recipe-r2.log`：2 PASS / 5 skipped。断言真实240点、sphere/torus、morph与orbit35、原zoom/ease保留、重复采用一致；已有布局之上可见，1400已有粒子+240新点被拒且原稿不变。
- 采样直接读正式engine暴露的纯sampler；没有在这里渲染新媒体。`git diff --check`通过。全库TS由主代理统一执行，UI浏览器与新3D渲染浏览器验证由各自负责代理回报，不归入以上数字。

## 只读跨档检查

点云type已进入两种schema、runtime白名单与绘制分支，morph只对点云有效；总点数受限，原camera无orbit时数学行为保持。SceneEditor新元素默认有from/to及morph动作，类型标签和数字编辑已接。发现通用新增动作节点缺pointMorph的morph字段，已报告主代理；07:11只读确认其已补新节点的morph:1。本代理没有跨范围改Editor，也没有把此次源码核对冒充浏览器复验。

仍未验证：实际用户媒体构图／阅读与听感、线上GCS保存或正式上线验收。不得用单测和素材URI断言冒充新成片或在线工作流验收。

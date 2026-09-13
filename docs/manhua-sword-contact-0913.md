# 双人持剑最小代码闭环：本地部分验证

2026-09-13T21:01:18+08:00，主代理。基线main66874b67；工作树 /private/tmp/mvs-sword-contact-0913。只做本地代码、测试和白模渲染；未commit/push/创建PR/合并/部署，未付费或启动云机器。PR1412实际已合并，未擅自开替代PR，也未挤入PR1461。

## 实际改动

文档另修改：docs/manhua-sword-contact-0913.md、.cursor/knowledge/PROGRESS.md。

- shared/manhuaPrevis.ts
- shared/manhuaPrevisSword.test.ts
- client/src/components/canvas/ManhuaPrevisStudio.tsx
- client/src/lib/manhuaPrevisStudio.browser.test.ts
- server/scripts/previs_sword.py
- server/scripts/previs_interaction.py
- server/scripts/render-manhua-previs.py
- server/scripts/test_previs_sword.py
- server/services/manhuaPrevisReport.ts
- server/services/manhuaPrevisSwordReport.integration.test.ts

新增右手练习剑选择和sword_guard事件；双方同一时钟，将实体剑刃表面在接触帧对齐，受方接触后卸力，结束返回同一准备姿态。同一spec切镜时持续读取同一动画，没有自动跨clip继承。武器为固定白模示意，不是人物原道具自动建模。

共享草稿和生产schema保留weapon，禁止持剑混入徒手事件或绑定人物模型；已有生成、pending/history、云草稿、采用与旧参考恢复继续使用同一个spec。formatPrevisMotionGuide明确剑刃格挡，旧无武器文案保持。逐帧剑体数据随完整原始/解析报告保存，恢复阶段复核帧数、持握尺寸和接触点。

## 九层状态审计

|层|状态|证据与边界|
|---|---|---|
|需求与边界|已验证|只补两人一招；模型/计费/权限/预算未改|
|入口与交互|已验证（离线）|真实React控件选择两剑→选择格挡→提交当前值→采用→恢复旧参考；网络拦截，服务回执为显式测试夹具|
|数据生产|已验证（本机）|固定Blender构建2剑、2人、96帧；保存场景后真实对象读回|
|契约转换|已验证（本地）|schema、草稿JSON往返、编译不静默改徒手；报告接受/篡改拒绝|
|服务副作用|部分完成|原任务与postProd输入测试通过，未做线上队列/权限/扣退费实跑|
|存储恢复|部分完成|本地scene.blend/JSON保存重读、完整逐帧证据、UI旧参考恢复；未做正式DB/GCS|
|消费展示|部分完成|本机4秒960×540、24fps共96帧视频；帧表审阅；已采用参考进入现有链路回归通过，未生成AI人物成片|
|静态回归|已验证（本地）|TS、Prettier、Vite、目标及邻接测试、旧Blender基线对照|
|真实用户全链|未验证|没有正式登录UI、生产Blender3.4.1、真实人物蒙皮接触或付费成片|

## 原始结果

- 基础schema/报告/恢复/持久化/编译/guide：7文件204 passed，日志sword-tests.log。
- 真实离线浏览器、参考采用链、画布与布局、真实报告：5文件152 passed，日志sword-chain.log。
- 最终真实报告/任务/后期输入：3文件15 passed，日志sword-final-report.log。数字按各批列示，包含重复报告测试，不冒充371个独立测试。
- pnpm check退出0；pnpm exec vite build退出0，15.09秒；保留包体积提示。Prettier check和git diff --check通过；Python py_compile通过。
- 首轮新增浏览器测试用了不存在的按钮文字而失败，修正测试选择器后真实控件路径通过；旧失败日志sword-browser-report.log保留，不是生产失败。
- 本机Blender5.2.1：local-04首末姿态差0，切镜相邻帧最大骨点位移0.013445m，受方接触后卸力0.053852m，剑刃表面接触误差1.8385e-7m；每剑96个样本完整保留。不是宣称普遍物理精度。
- 网格诊断先发现local-02有25帧剑刃碰自身前臂；修改准备方向后local-04全96帧未检出剑刃与身体三角面相交（仅排除自身握剑手，包含前臂）。原失败body-collision.json保留。不是连续碰撞/全配置保证。
- local-05增加故障注入，检查持握超限时先写完整report再失败；injected_grip_error目录明确为测试注入，不是生产质量证据。
- 原无事件/空数组在当前渲染器与main基线的poseSHA和像素SHA一致；原徒手两种接触及角色反向枚举通过，见legacy-regression.log。

## 产物

最终可看视频：双人持剑格挡-修正前臂穿插.mp4，4秒，960×540，96帧，66684字节；最终动作接触表.jpg。视频来自local-04；local-05只补报告先保存的故障测试，动作算法不变。各轮spec/report/scene/poses/acceptance全部保留；源文件备份source、tracked.diff与source-sha256.json供重启续接，未包含__pycache__。

## 独立审查与剩余风险

独立审查条目：/Users/tangenjie/Downloads/mvstudiopro-知识库/漫剧工厂/0913-双人持剑独立审查.md；审查基线及逐文件SHA以其最新记录为准。

限制：只有右手固定练习剑和白模；不自动把未知剧本文字编译成剑招；不支持真实人物蒙皮剑斗、自动跨clip姿态接力、剑气/火花或水/破坏；出画提示只看剑轴端点，非完整武器包围盒。现有视觉成果认可不变，新目标尚需生产环境与真人物样片验收。

下一步：先确定本批交付PR，再做生产环境兼容核验；真实8–12秒AI成片仍须先展示完整输入和预算并取得明确付费批准。不因本地通过自动调用模型。

最终独立复审：持握超限前先保留报告及故障注入测试已通过复审，无未闭合P1/P2。local-05合法回执与视频来源local-04回执逐对象JSON相等。本机验收不替代线上实跑。

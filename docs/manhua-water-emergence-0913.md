# 多人出水本地验收（部分验证，未上线）

2026-09-13T21:36:24.411434+08:00

已接通现有动作预演编辑→共享配置→固定Blender角色/几何浪生产→逐帧报告→恢复门禁→参考采用与指南。三人同时/错峰两版，各5秒960×540、24fps、120帧。仅人体白模几何水花，不能称真实水体/真人物成片已完成。

## 实际产物
- 三人同时出水-收紧构图.mp4：113326字节；破水帧25/25/25。
- 三人错峰出水-收紧构图.mp4：112882字节；破水帧25/31/37。
- local-04/{simultaneous,staggered}/：spec.json、完整report.json、scene.blend、restored-mesh-vertices.json和故障注入JSON。
- source/与source-sha256.json为11份本批代码及测试快照；tracked.diff还含之前保留的持剑改动。旧持剑未覆盖、未提交__pycache__。

## 实际修改文件
- shared/manhuaPrevis.ts
- shared/manhuaPrevisWater.test.ts
- shared/manhuaPrevisScript.ts
- client/src/components/canvas/ManhuaPrevisStudio.tsx
- client/src/lib/manhuaPrevisStudio.browser.test.ts
- server/scripts/previs_water.py
- server/scripts/test_previs_water.py
- server/scripts/render-manhua-previs.py
- server/services/manhuaPrevisReport.ts
- server/services/manhuaPrevisWaterReport.ts
- server/services/manhuaPrevisWaterReport.integration.test.ts


## 各层状态
|层|状态与证据|
|---|---|
|需求边界|已验证：同时/错峰同组资产，三股浪逐帧独立；本批限制3人8秒，不改原通用预算/时限|
|入口交互|本地已验证：真实离线组件选模式、提交、采用；删除中间人后新增时刻1/1.5/1.75，无重复身份；既有用户浏览器未动|
|生产|本地已验证：Blender5.2.1实际角色骨架与每人144顶点浪花网格；无mock产物|
|契约转换|已验证：schema拒非法混合/时间/身份/空间，草稿云序列化保留；剧本重编译明确拒绝抹掉已有水轨|
|服务副作用|部分验证：现有生成与恢复共用validatePrevisReport、原证据上传逻辑未改；未真实提交API/队列/付费/退款|
|存储恢复|本地已验证，云端未验：两版保存blend再读取，头骨最大误差0；逐帧全部水花顶点范围对账，原JSON与失败JSON永久保留|
|消费展示|本地已验证：离线提交/采用/旧参考及motionGuide；两版实际视频抽帧审看。未验证模型对动作参考的跟随|
|静态回归|255项基础与186项最终分批通过（有重叠，不累计唯一数）；最终类型/构建回执另列最新收口|
|真实线上|未验证：正式登录/数据库/GCS/生产Blender3.4.1/峰值/计费与真实角色水体成片；无commit/push/PR/合并/部署|

## 执行与原始结果
- `pnpm exec vitest run shared/manhuaPrevisWater.test.ts shared/manhuaPrevis.test.ts shared/manhuaPrevisScript.test.ts shared/manhuaPrevisPersistence.test.ts server/services/manhuaPrevisReport.test.ts server/services/manhuaPrevisRecovery.test.ts server/services/manhuaPrevisWaterReport.integration.test.ts client/src/lib/manhuaPrevisStudio.browser.test.ts`：8文件255项通过，regression-01.log。
- 最终7文件（UI、water/sword、真实report、canvasDramaStudio、manhuaSeedanceLayout）186项通过，regression-final.log；真实报告单独11项包括shrunk-range拒收，report-02.log。
- `/Applications/Blender.app/Contents/MacOS/Blender --background --disable-autoexec --threads 2 --python server/scripts/test_previs_water.py -- <wide-shot-v2.json> <local-04>`：exit0，两版各120帧完整网格/骨架回读，故意移动对象检出world/screen overlap及出画，local-04.log、acceptance.json。
- 同一Blender执行test_previs_sword.py：exit0，96帧contactError=1.838526610582034e-7、bodyIntersectionFrames=0、maxReturnError=0，sword-regression.log。
- 两个scene.blend执行--render-anim，FFmpeg24fps编码，ffprobe确认两个视频5.000000秒/120帧。主代理肉眼查看两版完整时段接触表，未听音频。
- `git diff --check`：exit0。

## 失败与修复证据
1. local-02：连续构建时隐藏旧浪花未被select_all删除，回读对象含上轮故障注入位移。修固定脚本枚举当前受控scene对象清理，测试增加同名残留检查，local-03/04过；不删失败证据。
2. 类型检查初版entries迭代与项目target不兼容，改索引循环；旧错误日志保留。
3. 独立审查发现范围只检查上限可能接受退化极小浪花，新增几何波形精确尺寸验算和篡改测试；通过。
4. 错峰删除中间人后新角色秒位可能重复，改按已有最大秒位+.25，真实浏览器验过。

## 独立审查
water_contract审UI/render/compiler/report；water_blender审shared/report并验真实场景。最终均无未闭合本地阻断，详见知识库0913-出水契约-子代理.md与0913-出水Blender-子代理.md。不是生产或合并审查授权。

## 限制与下一断点
几何冠/水滴的质感仍明显是白模，人体目前竖直上升后悬停，没有真实飞身、落回水面、湿衣/泡沫/液体动力学。构图已收紧，整体气势还未获用户视觉认可。仅保证采样帧保守包围范围分离；不证明帧间连续碰撞，也不证明未来替换真实水缓存后仍不重叠。

出水不能混合持剑、双人接触、带骨模型或四尾显形；未来须独立接线和验证。爆炸/烟雾/施法仍未施工。本轮未重复提交任何付费任务，无云机或远端写入。下一步继续飞身姿态与水花视觉层，再验证特效分层消费；付费成片前仍须完整输入与预算批准。


## 2026-09-13T21:36:50.640246+08:00 最终本地回执
非增量tsc --noEmit --incremental false退出0（check-delivery.log）；Vite退出0，13.81s，既有>500kB chunk警告保留。最新7文件186项、此前8文件255项均过，不叠加成唯一数量。两版最终视频分别113326/112882字节，均5秒960×540/120帧；local-04场景回读与旧持剑96帧实测过。两名独立代理已复审相关跨层链路，无未闭合本地阻断；未做生产验收。

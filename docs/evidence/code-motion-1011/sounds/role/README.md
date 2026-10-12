# 旁白／对白角色闭环（2026-10-10 UTC）

基于 PR1697 HEAD `0ad90a8a7b21ffc5d20993657c80c894cd7eadc9` 的并行施工工作树；本条只说明角色增量，不替代整支 PR 审查。

- `speech.role`、声音请求及生成回执保留 `narration|dialogue`，历史缺值等同 narration；不回填历史序列化对象，不更改旧 Qwen 请求身份。新对白进入独立 speakerId/digest，原编号不得改角色重投。
- 采用音源匹配台词／音色／情绪／role，真实轨道角色是 dialogue 或 narration；沿用自然时长修正、原音完整时长及旧 timing 失效检查。
- dialogue 即使设为代码镜头，仍需要生成口型片段。生成前必须完整采用本镜同版本人声，不能用 BGM、静音、裁短对白或旁白回执冒充。
- 提示词沿用 `formatPromptForEngine` 的 Seedance 方言，关闭文字替换以保留原台词，`{台词}`、`(原参考配乐)`、`@音频1` 绑定真实混音参数。URL 只进 audio_urls；无字幕、无画面文字，不生成 `【】` 字幕指令。没有擅加音效。
- 对白口型沿既有 `scenes` 逐镜编排合同；其他模板在 Qwen 调用之前明确拒绝，不放宽不支持视频的 renderer。

## 本轮证据

- `services-router-tests.log`：声音服务、正式 router、采用 helper 与视频生产计划／提交恢复，共 30 项通过。声音／模型上游、存储使用 fixture；未真调用付费模型。
- `studio-browser-test.log`：正式 CodeMotionStudio 页面及组件，transport fixture。从无音源开始，4 段配音（第二段 dialogue）+ BGM，采用、保存、reload、再次批量制作未重复提交。`studio-raw-trace.json` 保留请求与保存状态；`sound-panel-restored.png` 是实际无头浏览器截图。fixture audio 为空 WAV，播放器显示 0 秒，**不能作为听感或真实媒体质量证据**。
- `style-gate-test.log`：非逐镜编排的对白在上游调用前拒绝，转为 scenes 后完整角色链继续通过（只重跑这一受影响用例）。
- 沙盒首次浏览器启动失败，取得运行权限后仅重跑该失败的整页用例并通过。没有把启动失败隐藏为产品通过。
- `compile-role-test.log` 补验父代理 compile guard（初版 fixture 误用 words 模板，改为正式 scenes 后单例通过）：对白只有音轨时拒绝，音视频都采用后通过，改成 narration 音轨拒绝；旧缺 role 的 narration 仍能纯代码成片。

知识库依据：引擎调用参数对照-Wan与Seedance.md 第 139–198 行、雷霆制片法典.md 第 118 行；用户最新确认字幕由后期自行烧录。角色界面由 production 代理、编译门禁与 planner 指导由主代理完成，本代理保留其贡献。

未验证：真实 Qwen 声音、Seedance 嘴型／听者表演品质及正式线上账号流程。付费片段时长扩展由 production 代理独立施工，不把本轮 5 秒 fixture 结果外推为 30 秒实测。未合并、未部署。

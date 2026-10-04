# PR1662 语音创作／看片与UI交付

用户明确授权：新语音开发与UI优化一起追加PR1662，不另开PR。当前不合并、不部署。

## 实现

- 新增登录鉴权WebSocket代理 `/api/creative-voice/socket`。仅管理者测试，Origin白名单、单进程同用户一会话、输入大小/速率/上游队列限制、握手取消和闲置清理。
- 普通Live：Vertex us-central1 → 仅建立失败备援Gemini API；Extended：Gemini API HIGH，后台任务等IDLE。密钥不进前端。
- 漫剧顾问、小说改编复用语音UI：按用途路由、开关麦克风、文字/语音回复、单图分享、影片帧与音轨分开分享，播放器时间标记；本机讨论记录与导出。
- Live可呼叫原有GLM/DeepSeek顾问；收费确认继续等原请求结果并回传，取消/切作品不串稿；语音咨询携带voiceConsultOnly，防止回复恢复时自动渲染白模。原免费/付费额度不另建、不按模型重置。
- 白名单工作流工具：读当前信息、切集／定位现有镜头、本机修改清单、播放器定位。清单支持处理状态、定位和导出；不自动改正文，不自动发媒体生成任务。
- 原PR三份测试文件存在14处默认TS目标迭代及EventSource this类型错误，改Array.from/类型断言，行为不变，未重复执行这些已通过测试。

## 验证与复用

证据路径为同工作区上层 `backend-work/`：

| 范围 | 证据 | 结果 |
| --- | --- | --- |
| 原fallback取消、备援规则 | 1004-creative-voice-fallback-tests.log | 6通过，复用，不重跑 |
| 原连接器/媒体转换 | 1005-creative-voice-tests.log | 7+2通过；后续仅增工作流工具，不重跑未受影响断言 |
| 新目标、清单、时间归属、工具白名单 | 1005-creative-voice-workflow-tests.log | 4纯逻辑通过；同批路由有夹具清理error，未冒称整批绿灯 |
| 修正夹具后的真实WebSocket路由、真实浏览器组件 | 1005-creative-voice-browser-route-tests-2.log | 2+2通过，无额外错误 |
| 新语音咨询保护恢复 | 1005-creative-voice-consult-recovery.log | 1通过，4旧项跳过 |
| 新增真实浏览器图片/影片输入 | 1005-creative-voice-media-browser.log | 1通过，2旧浏览器项跳过 |
| TypeScript | 1005-creative-voice-types-final.log | pnpm check退出0 |
| 前端构建 | 1005-creative-voice-build.log | Vite退出0，23.54秒，已有大包警告 |

浏览器验证内容：工具ID重复不重复问顾问、等待异步结果、本机备注及目标定位、切作品停止连接和隔离记录；真实漫剧顾问收费前Promise保持等待，确认后同一requestId继续且回传答案。

首轮浏览器夹具漏flyHealthProbeOriginForUrl导出，未执行用例；修正后通过。首轮路由夹具关闭尚未连接的拒绝socket导致error；加测试错误监听后通过。类型检查发现本次useRef、fixture接口和CanvasBlock不存在title等问题，已修复。失败日志保留，不掩盖。

## 实际边界

- 本机离线验证不代表上线。没有新增付费模型探针，没有操作用户生产作品。
- Extended HIGH音讯、影片真实音画、实际模型函数调用、生产WebSocket登录/断线、真实账单待部署后验收。历史LOW仅证明Gemini API连通与文本转写。
- 修改清单是本机记录，未接云备份/JSON上传回填。不能宣称跨设备恢复已完成。
- 约1FPS抽样不是逐帧审片。跨域页面影片可能需要换本机文件；影片音轨受captureStream支持限制。
- 拒绝不存在的集与镜头；小说稿没有分镜时只能定位集。现有镜头由keyart节点读取，不把段号当镜号。
- 同用户并发限制仅单进程；多实例扩容前应增加共享会话登记。当前用途在会话开始前选择，不是实时无缝换模型。
- 原PR1662既有优化/UI内容仍保留；PR1663模板入库修复独立，未混入此改动。

使用手册：`docs/1004-creative-voice-guide.md`，以及用户Downloads/2026Oct04的Markdown和HTML版本。

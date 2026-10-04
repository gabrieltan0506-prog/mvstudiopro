# PR1662 顾问媒体编辑、Vertex审片与FlashX整形

基于 cc5f4f9e6cbee636cefad58efed9c97648458f9a，同PR追加，不合并部署。用户已确认模板入库，本批不重学该模板。

## 实现与边界

- ManhuaAdvisorMediaEdit接文字顾问与Live工具，方案绑定实际账号/作品/节点/URL/版本；Flare→明确确认Sunburst→明确采用，每次沿现有54积分计价，两模型同价。原图和修改历史保留，未明回执仅查原ID。方案与回执保存在本机，不宣称云端备份。
- video edit接既有Seedance2.5流程，方案本身不执行付费生成。图片新入口要求指定2.5变体，不悄悄改用2.0或OpenRouter；其他调用方默认行为不变。
- 专门审片复用模板学习Vertex/global传输，gemini-3.8-flash、HIGH、4FPS，归属校验在先。只有登记后解析为gs://的影片可用；结果含时间点及具体观察，可交给顾问准备修改。没有Pro或文字降级，没有自动重读；原始及解析JSON永久保存。
- 模板整形与系列聚合 scoped glmVariant=flashx，OpenRouter/EvoLink分流与HIGH不变。文本请求身份更新；Gemini分片缓存身份保持旧值避免付费重读。历史回执按实际型号显示，不能将历史Flash写成FlashX。
- 用户新增FlashX可读无音讯视频/抽帧检查，作为用户提供的能力写入知识库；本批未验证当前供应商视频输入协议、未接入FlashX视频。

## 本轮证据（日志在 ../backend-work）

| 日志 | 独立通过项与失败边界 |
| --- | --- |
| 1005-advisor-media-film-tests.log | 4项：图片原任务/变体、审片归属与证据 |
| 1005-advisor-media-browser-flashx.log | 4项：真实媒体组件确认/恢复、FlashX双网关、工具拒绝伪确认 |
| 1005-advisor-media-qa-integration.log | 审片顾问入口1项通过；媒体断言误用imageIntent字段失败，后续修正 |
| 1005-advisor-media-qa-integration-fix.log | 媒体断言undefined与null仍不符，未称通过 |
| 1005-advisor-final-incremental-tests.log | 5项通过：媒体顾问JSON、未知回执、聚合两通道、型号选择；变体测试参数位置断言失败 |
| 1005-advisor-media-final-guards.log | 3项通过：修正参数断言、工具结果名、Flare新预览作废旧Sunburst |
| 1005-advisor-model-receipt-label.log | 1项：新型号与历史实际型号标签分开 |
| 1005-advisor-media-consult-handoff.log | 1项：顾问还在结束回复时可保存方案，等待结束前不能提交生成 |

共19个独立通过用例。中途失败已保留，只复验失败或新增路径；不重跑旧通过用例。最后审阅发现回复交接时旧disabled会拒绝自身方案，已把咨询等待与真实工作区锁分开；咨询等待继续禁止生成、原工作区锁仍禁止改方案。

较早完整类型检查/构建已通过；最后交接修正改变了前端与回执，必要重新检查记录为1005-advisor-media-handoff-types.log和1005-advisor-media-handoff-build.log，两项均退出0，最终构建27.60秒。

## 未验范围与接续

没有操作用户生产作品。用户后续明确要求追加一次5秒FlashX视频实测，独立记录在1005-flashx-video-probe.log；这不等于图片/视频编辑成品验收。实际模型视频识别、Sunburst/Flare与Seedance的付费成品、生产会话/账单/跨设备均未验收。真实父顾问+付费确认+媒体生成的一体生产流程尚未测试；本地覆盖为真实媒体子组件、既有收费流程证据与新增后端集成。成功本地测试不代表线上闭环已验证。

同PR推送后由用户合并；待部署成功带用户从正式工作流试一次：读当前素材→准备修改→明确确认→原任务回执→预览→另行确认→采用。不要旁路重复付费。手册docs/1004-creative-voice-guide.md及Downloads/2026Oct04的同名归档。


## FlashX 5秒影片实测补充

用户明确要求用5秒片段实测。一次EvoLink /v1/chat/completions，model=glm-5.3-flashx，直接video_url传签名MP4（没有先抽帧给模型），max_tokens4096、reasoning_effort=high，无重试/备用模型。HTTP200，实际回报model一致，6603毫秒；prompt1590/completion278/total1868，reasoning_tokens0。HIGH字段已发送不代表实际产生推理token，更不是已确认独立推理预算。
样片为本次此前制作的金色光流演示，截取5秒、360宽、无音轨、26897bytes；SHA256 d5a43a86bfb2969f7f15ca67379a81993e22215bc4530cb627038f2fe4e424e2。模型识别背人画面、金色阿菁字样与光流显现变化；与本机1FPS接触表对照一致，底部小字识别有错，人物年龄/白发描述未确认。结论仅为当前EvoLink FlashX直接视频视觉输入成功，非声音理解或长片完整度验收，OpenRouter视频路径未测。
证据：task-2/backend-work/1005-flashx-video-probe.log；远端/data/model-probes/flashx-5s-1791133987183，原始/解析响应及请求均保留；云端model-probes/flashx-5s-1791133987183/evidence.json及sample.mp4。之前“FlashX视频能力未实测”被本次EvoLink成功证据更新；业务审片入口仍走Gemini，尚未接FlashX视频选项。无需重测这条已成功路径。

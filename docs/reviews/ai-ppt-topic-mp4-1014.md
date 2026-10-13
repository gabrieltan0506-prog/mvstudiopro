# AI PPT 单主题与已有动效收口审查

基线：c187e31109f9e9c864767293fb6a9f4571bde249。负责：主代理。用户限定本批 AI PPT，已明确授权提交、推送 PR 后直接合并；图文逐页施工不包含在本 PR。发布前仍须实时检查任务、进程与流水线。

## 改前证据与双向追链

| 层级 | 路径与审查结论 |
| --- | --- |
| 用户入口 | 首页两处、平台更多工具、映客 PPT 面板统一为 AI PPT；只填至少两个字的主题即可请求大纲；风格、已有大纲和资料选填 |
| 数据生产 | suggestHtmlPptThemes 的 UI/API/service 均移除三条用户大纲前置；沿用既有 GLM/DeepSeek 有界路由；模型返回4–6条叙事大纲，前端不再截为4条 |
| 契约 | userThemes 可省略默认空数组；解析保留6条，旧三条返回继续兼容。后续确认主题、生成页面与费用确认仍走原链 |
| 视频身份 | HtmlPptVideoPicker → 本人 codeMotion.list/history → succeeded job.output.url；只保存 projectId/jobId 与访问地址，不新建视频任务 |
| 权限 | history 在服务端按登录 userId + code-motion 项目作用域查询；导出前重新读取同一任务，失效明确失败；下载沿用 Fly 鉴权入口，凭证不出服务端 |
| 存储恢复 | 草稿 schema 保留 videoSource/videoUrl；平台实例按账号隔离；恢复后导出重查原任务，单页内容修改合并原页面并保留绑定 |
| 导出消费 | HTML 内嵌MP4数据，控制视频不翻页，离页暂停；PPTX addMedia 内嵌MP4，标题/正文/图表仍原生可编辑；单片80MB/总计160MB，缺视频、403和错误页阻止导出 |
| 反向核对 | PPTX media 字节与输入MP4相同 → videoDataByUrl → 已鉴权下载 → 原jobId → 本人历史；HTML用同一数据嵌入，不依赖登录外链 |
| 失败与计费 | 新视频选择和导出不提交模型；原页面生成、重修、退款保持既有路径；MP4失败保留原页且明确报错，无自动生成或付费重试 |

## 收敛台账

| 轮次 | ID | 状态 | 发现与证据 |
| --- | --- | --- | --- |
| R1 | AIPPT-001 | FIXED | HTML只留鉴权视频外链会影响离线交付；已与PPTX共用限量读取，HTML内嵌MP4数据 |
| R2 | AIPPT-001 | CLOSED | htmlPptPptx.test验证内嵌数据、非法URL拒绝、视频交互与离页暂停；真实H264封装产物生成、解包字节一致、ffmpeg完整解码通过 |

## 已执行验证

- `pnpm exec vitest run shared/htmlPptPptx.test.ts shared/htmlPptOutlinePrompt.test.ts server/services/platformHtmlPptRouting.test.ts shared/htmlPptMaker.test.ts`：38/38。
- `pnpm exec vitest run client/src/lib/htmlPptVideoAsset.test.ts`：4/4，含鉴权失败、错误页、容量拒绝。
- `pnpm exec tsc --noEmit`：exit 0。
- `pnpm exec vite build`：exit 0，37.83s；现有大分包警告仍存在。
- 实际组件三阶段示意：单主题可点生成、完整6条大纲、页面已有MP4选择器。演示模型数据，不当作线上真实LLM结果。
- Fly工作机7812595b294778：performance 4 vCPU/8192MB，探针独立/tmp目录、env -i、fetch禁网。首轮37通过；路由5项因打包缺2个依赖未启动，补依赖后定向5/5通过，不重复其余37项。
- 真实本地H264测试片封装：PPTX 198323字节，解包MP4字节相同，ffprobe确认640×360/1秒，ffmpeg完整解码exit0；本地测试片并非平台成片。

## 完成状态与边界

代码、静态回归、隔离验证：已验证。正式页面当前尚未部署本批，AI真实大纲与账号已有视频的下载未做线上验收；未在PowerPoint/Keynote桌面软件实际播放。PPTX本身不保留HTML分步动画，嵌入MP4可播放但视频内部图元不能编辑。上述边界不表述为已完成端到端验收。

本批不变更数据模型、计费或供应商合同，不新增依赖；不生成新视频。主代理已审查本批完整diff、正反向链路及旧入口，无已知未修复阻断；合并依赖紧邻操作的任务/部署/CI门禁，最终提交SHA与运行回执记录于当日知识库。

## 发布后定向补验

PR1706已合并cb8afd2a。Keynote已实际打开本地测试PPTX，标题/正文为可编辑对象，视频从0.440秒播放到0.960秒，补齐本地桌面播放证据（PowerPoint未验）。

AIPPT-002 / R2定向新证据 / OPEN：原账号已有30秒视频已成功解析，视频readyState=4、error=null，但HTML预览的video.getBoundingClientRect().height=0。根因是新视频复用图片容器却未指定布局姿态，百分比高度没有确定父级高度。PPTX不受此问题影响。

AIPPT-002 / FIXED：HTML视频使用明确16:9比例与右侧布局，小屏沿用纵排规则；同页有图片时只保留视频布局，不加载图片运动关键帧。受影响范围只在HTML预览/导出，模型、存储和计费未改。补验将使用隔离Chromium实际渲染桌面/小屏，并重现旧代码零高度作为反证；结果写知识库后才发布补丁。

AIPPT-002 / 定向修复续记：420px真实预览高度探针进一步发现playEnter清除固定姿态，导致视频虽有高度但位于视口外；已让视频页保留固定布局。探针加入横屏视频完整处于视口内的断言。

AIPPT-002 / CLOSED：同版本隔离Chromium真实渲染1280×420得到视频438×246.375、top98.8125；1013×420得到385.171875×216.65625、top116.859375；390×844得到352×198。三档无横向溢出，横屏视频完整可见，视频点击不改变翻页状态；恢复旧代码得到height=0。最终定向测试23/23通过。首次桌面720px测试未复现问题、第二次420px测试发现视口外布局，均保留原始失败记录，最终结论仅依据第三版真实尺寸断言。

主批前后台发布已成功，真实单主题LLM已返回六条完整大纲。原账号已有30秒瑞芯咖啡视频成功绑定、导出为10页PPTX并在Keynote播放到结尾；模板页明确标注示例数据。补丁只修HTML预览与导出的布局，合并前再核对真实任务与部署，发布后定向复验原页面播放器尺寸。

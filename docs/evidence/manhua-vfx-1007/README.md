# 特效与创作顾问接线：交付证据

基础HEAD：89b8bac548139ab8c4e553e9ecac923710452475，包含PR1675原有7文件比较稿修复。本批追加原PR，用户本人合并，未部署。

## 实际实现

- 12类屏幕特效/手动轨迹/图片叠加；源归属校验、云稿确认后入队、确定请求号、原号恢复、显式候选采用。
- 5类白模场景效果：真实Cloth披风、已有分件展开、灵体材质、属性渐变、骨骼文字标注；原白模规格/历史/任务/审片门禁复用。
- 标题和淡化/溶解/擦除转场沿FFmpeg；生成式修改预设沿已有视频编辑模型/确认/费用/候选链。
- 顾问effects工具接原5种编辑器，inspect→configure→submit→候选/采用或原号续查，拒绝过期sourceKey/错片段/跨项目迟到回执。
- 明确knowledge刷新入口与文字/语音工具；完整metadata分页，变更卡增量读取，失败保留旧快照。普通聊天只读摘要缓存，具体模板按索引只深读目标卡；明确全库推荐保持原入口。
- 普通咨询保留项目冻结导演包身份，不以3D咨询开关代替；新目录不自动升级项目。质量建议拆解剧情/美术/灯光/运镜/动作/特效，不能承诺仅靠叠光达到电影级。

## 验证与复用

首批下表为开发辅助证据，首批未执行真实云端传输。后续用户授权的真实Fly/GCS探针见文末续工记录；用户正式项目/供应商仍未验。Puppeteer为独立离线夹具，不是用户正式Chrome标签。

| 路径 | 证据 | 结论/边界 |
|---|---|---|
| VFX合同/队列/恢复/归属 | core-unit、recovery-manifest、overlay-source-routing日志 | 原号与不可变输入、跨用户素材拒绝、全帧manifest门禁；mock存储/DB |
| 原工作台、保存/采用/恢复/标题/生成式/轨迹 | workflow-*日志 | 实际React组件+离线transport；没有真实云存档或付费调用 |
| 特效实际生产服务 | real-blender-service-receipt.json | Mac Blender5.2.1→生产manifest门禁→FFmpeg，1秒12帧；4–9帧半透叠图，源AAC包及PCM哈希不变；存储mock |
| 场景效果 | real-renderer-report-gates.json及本地renderer交接 | 复用真实48帧报告，4效果192条样本；披风425顶点、挂点误差约4.805e-7m、保存重开误差0；不重复渲染 |
| 转场 | transition-receipt.json | 真FFmpeg两段交叉淡化，重叠后3.5秒与中点混色；存储mock |
| 顾问工具/导航 | advisor-new-contracts、advisor-failed-only-r2、workflow-advisor-* | 操作字段严格、旧controller只读、目标片段匹配才写，原服务错误不吞掉 |
| 知识目录 | renderer的knowledge-*日志，knowledge-ui-r2.log | 新服务11项+索引深读9项；UI显式刷新、失败留旧快照；无真实GCS/模型 |
| 普通导演包/模板/质量目标 | advisor-context-targeted、advisor-failed-only-r2、advisor-director-stage-r2 | 冻结版本不擅自升级、按当前工作流阶段解析覆盖，指定模板仍进问答 |
| JSON拒收证据 | evidence-rejection.log | 新增2负例，旋转/manifest结构拒收前原始与完整解析JSON均保留；未重渲染 |
| 白模顾问场景候选 | advisor-previs-patch-r2.log | 保留角色/机位/时长、显式清空、未知演员拒绝 |

较早通过且前提未变的结果直接复用，没有全测或全渲染重跑。失败夹具与修正记录保留：NodeList/Map迭代类型问题已修；场景夹具无音轨、知识UI JSX设置、测试漏import及测试效果id缺失，仅复验对应失败。VFX最后仅调整JSON归档顺序，像素/音轨处理未改，真实Blender证据继续适用，新增负例覆盖调整。

最终类型检查与受检文件指纹见交接记录及source-fingerprints.json。日志是原运行记录，不以时间戳宣称重新执行。

## 尚未验证与能力界限

- Linux/Fly定向渲染已补验，范围及原始失败见下表；正式站真实项目的顾问文字/Live麦克风、提交、候选采用、刷新恢复仍需用户合并部署后验收。
- 新生成式预设的真实供应商输出质量未验；未改模型参数或凍結读片合同，未发生本轮模型付费。
- 屏幕效果没有自动追踪、真实遮挡、体积光或场景重照明。法相/巨禽/巨剑主体和电影级妆造场景需要对应资产与生成镜头，不是屏幕叠加已完成。
- 3D分件仅已有部件，不生成内部结构；白模效果不保证最终视频采纳。Cloth碰撞及效果出画面需原逐帧/常速审片，不靠报告宣告质量通过。
- 知识摘要缓存进程重启后需明确刷新；已扫描后指定卡版本变化会拒绝深读并要求刷新，不自动重购顾问回答。未扫描兼容旧全库查找，显式全库推荐仍可能读取全部已批准卡。

## 回退

用户尚未合并时可保留PR。合并后如需回退，由用户通过revert PR恢复本次提交；不得删除已取得的任务/原始及解析JSON。旧未配置新字段的项目沿原流程。不得直接推main、合并、部署或取消在途任务。

## 2026-10-07 续工：真实工作机与实际工作台

本轮以已推HEAD `9692764cae8aa7b4147b7ac0d56c679d36277494` 为基线，追加原PR1675。用户明确授权现有空闲worker做隔离探针。只在机器 `7812595b294778`、临时隔离目录运行；正式镜像/main仍 `36a04e3d`。无部署、无用户任务写入、无项目视频/读片模型调用。用户另要求的两张ImageGen图片是设计资料，不作功能或质量验收。

### 修正

- VFX迟到保存进入时绑定原项目/账号/备份世代，保留最新画布连线；面板卸载不再调用旧保存。
- 转场原始probe、完整parsed、normalized分别保存，业务拒收前已有完整JSON。
- Linux Blender3.4隐藏骨骼标签矩阵冻结：临时静音可见性曲线、同帧重评、finally恢复。原失败0.191614m，修复48帧最大误差0。
- 实际ManhuaVfxEditor新增双栏、参数时间轴和真实文件候选比较。时间轴修改的是同一保存/提交配方；比较不生成，采用仍核对来源/配方，选择另一原片立即隐藏旧比较。没有将概念画面充当真实视频或加入空壳生成按钮。

### 本轮证据

| 项目 | 真实结果 | 原始证据 |
|---|---|---|
| 迟到保存/转场拒收 | 改码前6失败1通过；只复验6失败全部通过 | continuation-reproduction.log / continuation-failed-only-fixed.log |
| 编辑器卸载 | 迟到成功/失败2场景通过 | continuation-unmount.log |
| 新工作台 | 时间范围入保存与提交、两路实际URL比较、单路音频、配方不符禁采用、恢复后采用、切来源移除旧比较 | ui-workbench-browser.log；真实React，存储与媒体播放为离线注入 |
| VFX | 12帧/144效果样本；活动帧20860像素变化、首尾0；AAC包与PCM SHA均不变 | fly-worker/receipts/vfx/result.json |
| Cloth/材质 | Blender3.4.1，425顶点48帧，挂点4.80548e-7m、重开误差0、144报告项 | fly-worker/receipts/cloth/result.json |
| 分件 | 3独立实际armature部件24帧，最大偏移误差1.54505e-7m | fly-worker/receipts/explode/result.json |
| 标注 | 原失败保留，label-r2 48帧误差0、字体打包/字形/隐藏保持通过 | fly-worker/receipts/label/failure.json、label-r2/result.json |
| 转场 | 2片段；理论1.75秒，实际1.833333秒，处于既有12fps一帧容差；不是精确1.75秒 | fly-worker/receipts/transition/result.json |
| 知识目录 | 89模板/6导演包，cold下载89、warm下载0，mt_0009 indexed，0模型调用 | fly-worker/knowledge-r2-ssh.log、knowledge-console-result.json |

云端永久前缀 `gs://mv-studio-pro-vertex-video-temp/post-prod/isolated-pr1675/probe-evidence/20261007T081759-9692764c/`。所有probe保存后读回校验SHA。知识首次进程被既有闲置停机中断，云端result/failure不存在，经核对后新进程knowledge-r2通过；通过项未重跑。SFTP/SSH连接失败仅重试传输，不重新生成媒体。机器停止清空/tmp，因此以后恢复以云端原证据为准。最终全Machines盘点worker stopped、网站started，镜像/规格/卷未改，无遗留新增机器。

完整可复现探针源码 `scripts/probe-manhua-effects-worker-1007.mts`；原始Linux源包指纹 `fly-worker/source-manifest-r4.json`；续工UI与修复源指纹 `continuation-source-fingerprints.json`。已有首批通过且路径前提未变的结果复用，不全量重测。类型检查只对本轮新增/修改补验；新UI夹具曾有一个隐式any，仅加类型后增量复验，运行逻辑未改，不重跑已绿交互。

### 真实未验边界

正式站的登录项目、真实按钮扣费/队列/候选/采用/刷新恢复以及Live顾问，均尚未线上验收。两张设计图内的电影感、缩图、保存时间、顶栏与部分完整工作台布局不是已部署结果；目前基础叠效与图像美术目标仍有质量差距。没有自动人物追踪、遮挡或场景受光。新增比较可从头同时播放，不承诺浏览器两个视频逐帧锁相。

本地HTML：`task-5/deliverables/漫劇特效-設計與實作對照.html`，图片内嵌、可放大；用户要求Chrome后已使用系统open交给Google Chrome打开，未声称浏览器自动化视觉验收。当前工具集缺少官方浏览器控制所需js入口，侧边打开未完成。

## 工作台预览继续完善（bf281ce2 后同 PR）

用户明确要求继续完善实际UI和可用按钮，新增浏览器原生展开/收起、手动轨迹线与关键秒位、随原片时间变化的位置参考、直接打开既有创作顾问。真实特效仍须渲染候选，不把挂点/路径或图像样张冒充即时特效。

新增纯位置函数对照原Python renderer的7个时间点通过，不改变渲染合同。新React交互通过：轨迹显示、插值位置记录进保存、真实headless Chrome fullscreen进入/退出、原顾问callback调用且无生成。初次仅测试夹具evaluate漏传text导致失败，修夹具后只复验该失败场景；已通过Python对照跳过。见ui-workbench-guide*.log和guide-source-fingerprints.json。未控制用户Chrome进行正式站验收；用户请求展示HTML时只是系统open打开本地文件。

用户电影参考：Inception / The Matrix / The Matrix Reloaded / The Matrix Revolutions。用户正在自己通过“学习节奏”处理Inception；尚未取得模板，不代替用户重复学习、不动工作机、不宣称已分析电影。

补验关闭：展开后原父层候选播放器会被 fullscreen 顶层遮挡，现预览前先退出 fullscreen；保存/采用回执同时写入工作台内的可读状态。新增第三场景通过（ui-fullscreen-preview-r2.log）；首轮夹具遗漏真实样式而不可滚动，补用实际 Tailwind theme 与三个生产组件的 class 生成 CSS 后仅复验该失败项。三个新增场景分次全部通过，未重跑前提未变项。最终增量 TypeScript 检查 exit 0（ui-workbench-guide-typecheck-complete.log）；本次最终源码 SHA 见 guide-source-fingerprints.json。以上均为开发证据，非正式站验收。

最新用户明确授权本次无问题后由代理合并 PR1675，覆盖此前仅本人合并的限制；用户同时说明 Inception 学习约两小时。在途任务/部署安全门禁未撤销，当前仅提交推送，必须实时确认任务收尾、持久化与部署空闲后再合并，不启用可能抢先部署的自动合并。

## 用户追加：顾问真实语义与首页成片

顾问三次真实文字模型调用发现并关闭预览/采用含义与多层渲染说明缺口，共US$0.01866415；不是三轮全通过，逐次失败与定向修正见[advisor-understanding/README.md](advisor-understanding/README.md)。正式站工作流仍未验。

用户另指定2026Oct03的墨菁傳第一集替换首页第一支水果茶示范；保留完整106.176009秒、3185帧与原AAC，1080x1920网页副本47,636,778字节，原4K不动；证据见[首页媒体核对](../home-episode-1007/README.md)。战船及原博客资源保留。

# PR1729 小说多作品、MV工作流与影像工坊审查台账

- 仓库：gabrieltan0506-prog/mvstudiopro，PR #1729。
- Base：main@c17f4d8ff707237744c2e08a3a7301090099317c。
- 已有HEAD：fix/novel-initial-load-1020@4fe8a238e0ddac3e27dacab3d0ed7e7ec12a9ec5；本次审查覆盖其后全部新增diff，提交SHA见同批提交及知识库追加记录。
- 时间：2026-10-20T22:36:16+08:00；主代理独立审查，未派子代理。
- 用户范围：小说与MV同账号新建/保存/切换；首页照片工具改影像工坊并提供照片/漫剧/MV入口；沿用原制作链。补充人声歌曲及演唱MV，默认不能禁用vocal。用户合并；不生成媒体、不部署。
- 采用review-convergence-ledger的稳定ID/追加状态规则，第二轮仅修复已发现阻断和用户明确新增的人声要求。原首载优化的构建与采用证据因入口增加而先标STALE，最终构建/同一采用用例已刷新。

## 改前证据与双向追链

| 层 | 真实生产者与消费者、风险及证据 | 状态 |
| --- | --- | --- |
| 需求/权限 | admin与supervisor小说权限保持；MV沿现有登录权限；账号来源useAuth及服务端ctx，URL owner校验。无新计费或模型路由。 | 离线已验证 |
| 入口/交互 | HomeNavbar→HomeImageWorkshop照片常驻页签/novel-projects/manhua-projects/mv-projects；列表→作品URL→工作区→保存/切换。桌面1440与390截图、键盘页签、照片编辑不丢。 | 离线已验证 |
| 小说生产/存储 | emptyNovelWorkspace生成稳定projectId；roundId仍用于本季模型/工厂。按userId+projectId写IndexedDB，以旧raw比较并事务提交；旧活动和封存稿只补入缺失作品。跨季显式保留projectId。 | 离线已验证 |
| 小说云恢复 | 现有不可变backup写全文→哈希回读→索引；metadata携projectId，读回核身份。列表按projectId合并；云回填先备份本机，CAS失败不覆盖。 | 模拟传输/真实组件已验证；生产云服务未实跑 |
| 小说最终消费 | 已编辑三集剧本→adoptScript确认→动态载入工厂→原作品锁→createNovelFactoryProject→隔离writer pack。反向检查writer pack对应原requestId/hash与完整编辑文本。 | 独立浏览器采用用例通过；真实账号未采用 |
| MV生产/存储 | createEmptyManhuaProject(kind=mv)建立独立music节点、workspaceKind；新项目instrumental=false。本机范围键→原GCS条件写入→云恢复→真实CanvasMusicMvStudio读到同一节点。 | 离线已验证 |
| MV音乐出站 | 音乐类型/歌词/排除项→实际按钮构造brief→queueManhuaBgm→原jobs schema/digest→createManhuaBgmTask→TTAPI。已逐层核instrumental与歌词原样转送，供应商适配器以fake-key和stub fetch验证。 | 离线已验证；没有真实音乐生成 |
| MV分镜/镜头/成片 | 原draftPlan、createMusicMvShotBlocks、runShot、timeline、assemble及原任务恢复均沿用；演唱镜头仍要求对应唱段。新工作流只是把控制区移出画布缩放并增加六步导航。 | 合同回归已验证；真人演唱/成片质量未实跑 |
| 失败/并发 | 新建配额失败回滚本次新键；云保存失败保留本机；小说pending阻止切换；MV保存/恢复/页内忙时阻止切换；作品锁覆盖bfcache离开/返回。费用幂等退款沿用原任务实现。 | 离线已验证；真实账务未实跑 |

## P1729-01 · R1 OPEN → FIXED → R2 CLOSED

- P1：MV从作品A切B再回A，浏览器历史缓存保留旧React工作区与编辑锁，重新打开被误判为其他页占用，且旧内存可能覆盖后存内容。
- 修复：OmniCanvas.ManhuaProjectLock在pagehide先flushSync卸载工作区再释放锁；pageshow persisted时重读。仅改受影响锁生命周期。
- 复验：musicMvProjects.browser.test真实OmniCanvas覆盖A→B→A和云恢复；manhuaProjectIsolation.browser.test覆盖两个工厂分页面/刷新/错误账号，均通过。旧测试夹具云空稿响应修为真实合同draft:null,generation:0，不用null冒充响应对象。

## P1729-02 · R1 OPEN → FIXED → R2 CLOSED

- P1：390宽度MV控制区被作为画布节点整体缩小，按钮与文字不可正常使用。
- 修复：FreeformCanvas新增仅用于MV入口的musicWorkflow分支，把同一个真实CanvasMusicMvStudio放到不缩放的面板；原镜头画布保留，默认可展开。共用原patch/add/run处理函数，不复制生产逻辑。
- 复验：真实页面仅挂一个studio；窄屏宽度>300且无横向溢出；1440/390完整截图已目视，入口、歌曲字段和保存按钮可读。

## P1729-03 · 用户新增要求 OPEN → FIXED → 定向 CLOSED

- P1：用户指出新MV默认纯音乐，并排除vocals/singing/voice/choir/lyrics。根因是新musicMv未显式设置instrumental，沿用了原BGM节点默认值。
- 修复：新MV默认人声歌曲，音乐类型提前到选歌步骤顶部；共享排除项计算用于表单、顾问原brief及实际提交；切换人声时移除完整旧器乐预设，但保留其他自定义声音偏好。人声模式仍填写禁用主唱的通用排除项时明确阻断，不静默改用户字段。旧作品类型不批量重写，音乐请求期间不能切换类型。
- 复验：真实按钮离线请求捕获instrumental=false、完整歌词、negative_tags为空；纯音乐切换/旧预设清除/自定义choir保留/矛盾阻断通过；TTAPI适配器人声传递及无重复请求等13项通过。

## 验证记录

- pnpm check：最终人声修正版本exit 0；此前发现的Map/Set编译目标、重复flushSync导入与夹具TS2774已修正，保留失败历史，不计为通过。
- pnpm exec vite build：最终14.92秒exit 0；既有大chunk警告仍存在。
- 定向合同测试：9文件73项通过；备份身份校验追加后单独2项通过；人声修正后4文件24项通过（其中真实MV浏览器1项、factory6项、guards4项、TTAPI13项）。这些数字包含重叠，不相加冒充独立覆盖。
- 浏览器：creativeProjects、musicMvProjects、manhuaProjectIsolation三文件3项通过；主题夹具校正后首页/项目单项5.93秒通过；人声修正后MV单项14.89秒通过。
- novelSeries.browser.test -t 首次加载：1项通过/2.98秒，完整编辑与采用合同保留、初次不请求工厂分块。原60集长用例此前90秒超时，本轮未重跑，不称其通过。
- Linux隔离：等待同源码哈希核对及离线10文件结果；完成后在本台账追加，未返回前不称通过。
- 原始日志、截图与源码清单：知识库所指“2026Oct20/漫剧出海验证记录/多作品与影像工坊”。

## 交付边界

代码及离线链路已实现并部分验证。未合并、未部署、尚未正式原页面验收；没有真实媒体、模型调用或扣退费操作，不能宣称线上完成。初次加载体积是本地静态依赖比较，不是正式页面延迟指标。小说云端沿用不可变备份，需点击保存作品形成账号内快照，本机自动保存与云快照在UI中明确区分。

## P1729-04 · 用户双交付要求 OPEN → FIXED → 定向 CLOSED（离线）

- 撤回“完整歌曲MV版”假设。新作品默认“歌词、歌曲与专辑封面”；另可选择30–60秒抖音高光MV，用于引流汽水音乐。旧作品完整MV模式保留。
- 正向链：deliveryMode/highlight → 选定原歌 → 30fps相交镜头 → 同一原计划/本人素材核验 → 冻结合成请求 → worker原参数 → 原音atrim与字幕裁取平移 → 同一请求成片回写。反向核对输出字幕sourceId、原歌曲、planRequestId及合成requestId；原歌与原对齐回执不改。
- 仅生成所选区间需要的镜头，合成首尾使用真实裁点；范围超出原歌、片段不足0.5秒、范围与画面不符或混用旧完整剪辑均明确拒绝；恢复只查询原单。高光9:16，完整歌曲保留。汽水音乐发布由用户自行执行。
- 实际组件浏览器覆盖100秒歌选择25–65秒，只调用五镜并提交40秒区间，刷新恢复同一合成、切回歌曲保留原音；本机精简→云清洗→恢复保留双交付范围及封面回执。真实渲染、对齐质量与媒体未实跑。

## P1729-05 · R1 OPEN → FIXED → 定向 CLOSED（离线）

- P1：专辑封面要求1:1，但共用图片建单及worker把1:1强制转回9:16。
- 修复：封面尺寸冻结到回执与幂等ID，旧竖版ID/提示词保持；共用归一化保留1:1，worker→图片服务→1024×1024与fallback比例贯通。同一歌同一尺寸不重复建单。
- 验证：实际worker分支AST执行测试捕获1:1及原计费jobId，服务/原始请求合同通过；没有真实图片生成，不代表方形图片质量通过。

## P1729-06 · 用户前台技术泄漏指令 OPEN → FIXED → 定向 CLOSED（离线）

- 静态流程文案及动态审阅metadata泄漏后台模型分工。清理创意学习、歌曲顾问、歌曲/封面费用提示，审阅卡不显示model/draftModel；旧审阅说明和错误提示仅在展示层统一名称。
- 原始证据、完整歌词、请求模型、回执metadata及错误分类均保留，不截断创作结果。默认审阅提示改成用户能理解的音画依据与未人工验收说明。
- 验证：两种交付模式的实际工作区文本均无模型名；主题方案包含模型metadata及旧说明的fixture，通过查看/采用/刷新后检查DOM无名称，持久化原model仍完整。最新1440/390截图已目视。

## 2026-10-20T23:07+08:00 · 最终收口追加

- 原多作品隔离批：532文件SHA一致，10文件87项通过；新增双交付隔离批：534文件SHA一致，Linux x64，10文件79项全部通过、0失败、exit0。两批包含重叠测试，不合计为166个独立用例。
- 本轮最终 `pnpm check` exit0；`pnpm exec vite build` exit0/19.76秒；`git diff --check` exit0。项目无独立lint脚本，未冒称执行lint。
- 最新界面：真实MV工作区1项/13.95秒通过；双交付和主题采用2项通过；增加审阅metadata后主题采用1项/0.974秒通过，后台原回执保留。没有重复整套未变化测试。
- 小说初始静态依赖gzip从471636减到313135 bytes，约减少33.6%；新列表随首载加载，工厂仍为采用时动态加载。此数值为本地构建，不代表线上网络耗时。
- 主代理已审本轮完整新增diff及所有生产者/转换/存储/消费链；新增用户要求按P1729-04至06定向关闭离线阻断，没有扩大到其他项目。
- 15:05:30Z真实jobs及占用账本均空，rig进程为现有服务，无本次测试残留；相关流水线completed，复用rig已停回。未新建/删除机器，未合并/部署。
- 所有关键开发与离线合同已验证；生产云账号、真实媒体成片/图片/演唱质量及真实扣退费未验证，整体仍为部分完成，须用户合并部署后在正式原页面验收。原60集长浏览器用例90秒超时仍保留未通过记录。

## 本批实际修改文件

- `client/src/App.tsx`
- `client/src/components/HomeImageWorkshop.tsx`
- `client/src/components/HomeNavbar.tsx`
- `client/src/components/HomePhotoTools.tsx`
- `client/src/components/canvas/CanvasCreativeLearning.tsx`
- `client/src/components/canvas/CanvasMusicMvStudio.tsx`
- `client/src/components/canvas/CanvasMvCreativeAdvisor.tsx`
- `client/src/components/canvas/CanvasSunoSongAdvisor.tsx`
- `client/src/components/canvas/CreativeEvidenceReviewPanel.tsx`
- `client/src/components/canvas/FreeformCanvas.tsx`
- `client/src/components/canvas/SongCoverPanel.tsx`
- `client/src/lib/canvasMusicMv.browser.test.ts`
- `client/src/lib/canvasMusicMv.persistence.test.ts`
- `client/src/lib/canvasMusicMvGuards.test.ts`
- `client/src/lib/canvasMusicMvGuards.ts`
- `client/src/lib/canvasMusicMvWorkflow.ts`
- `client/src/lib/creativeProjects.browser.test.ts`
- `client/src/lib/creativeUserText.ts`
- `client/src/lib/manhuaProjectIsolation.browser.test.ts`
- `client/src/lib/musicMvProjects.browser.test.ts`
- `client/src/lib/novelFactoryProject.test.ts`
- `client/src/lib/novelFactoryProject.ts`
- `client/src/lib/novelWorkspace.ts`
- `client/src/lib/novelWorkspaceDb.ts`
- `client/src/pages/CreativeProjects.css`
- `client/src/pages/Home.tsx`
- `client/src/pages/ManhuaProjects.tsx`
- `client/src/pages/MusicMvProjects.tsx`
- `client/src/pages/NovelAdaptation.css`
- `client/src/pages/NovelAdaptation.tsx`
- `client/src/pages/NovelProjects.tsx`
- `client/src/pages/OmniCanvas.tsx`
- `docs/reviews/2026-10-20-pr1729-creative-projects.md`
- `server/jobs/runner.canvasAssetEdit.test.ts`
- `server/jobs/runner.ts`
- `server/routers/canvasMusicMv.ts`
- `server/routers/canvasMusicMvAssemble.test.ts`
- `server/routers/canvasMusicMvAssemble.ts`
- `server/services/manhuaAssembleFinalService.audio.test.ts`
- `server/services/manhuaAssembleFinalService.ts`
- `server/services/manhuaCloudDraftGcsStore.project.test.ts`
- `server/services/manhuaCloudDraftGcsStore.ts`
- `server/services/novelWorkspaceBackup.test.ts`
- `server/services/novelWorkspaceBackup.ts`
- `server/services/openaiGptImage2.request.test.ts`
- `server/services/openaiGptImage2.ts`
- `server/services/proxyImageService.ts`
- `server/services/songCover.test.ts`
- `server/services/songCover.ts`
- `server/services/wavespeedGptImage2.ts`
- `server/vercel-api-core/renderAlignedLyrics.test.ts`
- `server/vercel-api-core/renderSourceAudio.ts`
- `shared/canvasGptImage2JobInput.test.ts`
- `shared/canvasGptImage2JobInput.ts`
- `shared/canvasMusicMv.ts`
- `shared/creativeEvidenceReview.ts`
- `shared/manhuaAssembleJobInput.ts`
- `shared/manhuaWriterSession.ts`
- `shared/musicMvHighlight.test.ts`
- `shared/musicMvHighlight.ts`
- `shared/novelWorkspaceState.ts`
- `shared/songAlignedSubtitle.ts`
- `shared/songCover.ts`

## 2026-10-20 · 首页独立封面工坊新增范围（本地，未追加远端PR）

- 被审基础HEAD：320f6b1982ae4186bce91cf06c15d8e994aa4eb0；base c17f4d8ff707237744c2e08a3a7301090099317c。封面新增改动尚未commit/push，本段不覆盖或冒称已发布。
- 最新用户要求：首页影像工坊独立吸睛封面，描述或上传图片→一次三款Image2.5 Flare原生2K初稿→选中方向→Image Sunburst高画质成稿，做好立即隔离探针。新要求授权本地代码和测试；本轮没有真实付费媒体调用，不派代理。
- 正向链：HomeCoverWorkshop实际确认→coverWorkshop.prepare不可变manifest/prompt/fingerprint/本人图片→submit原子插入三条稳定jobId→runner核对生产凭据、服务端费用与原扣退费账本→exactModel/size/quality→永久原始回执/原图→独立像素后期→归属登记/任务结果→三候选与成稿展示。
- 反向链：UI仅显示本人manifest绑定jobId成功且delivery非空的图；成稿从选定初稿的原manifest、成功任务、永久成图回读，第一参考为选定设计，原参考随后，不接受任意替换URL。失败与重入只复用原身份；未知供应商结果不再次调用。
- 三比例实际像素：1152×2048、2048×1152、2048×2048；实际返回像素不符明确拒绝与退款，不插值冒充2K。原图及供应商响应仍保存。标题/描述不静默截断；无标题则明确禁止文字；实际提示词含原简体约束，先展示再确认。

### P1729-07 · R1 OPEN → FIXED → R2 CLOSED（隔离）

- P1：封面worker内层已标记unknown对账，但原外层只识别codeMotionImage，会把封面未知结果按普通失败退款，进而诱发新购买。
- 修复：coverWorkshop同样进入reconcile_and_fail_paid_image；原job拒绝重排，上游提交前永久占位，明确低像素失败仍退款。原图/响应存在时只恢复后期与结算，不新投模型。
- 证据：真实runner分支AST执行及外层处置测试3项；Linux服务11项含未知重复、响应恢复、低像素拒收。旧图片worker4项与旧计费处置8项回归通过。真实账务尚未验证。

### P1729-08 · R1 OPEN → FIXED → R2 CLOSED（离线）

- P1：仅用React账号key重挂组件仍会命中不带账号的历史查询缓存，切账号可能短暂显示前一账号标题；多图片上传旧异步循环也需要在账号卸载后停止。
- 修复：历史query input包含accountId，服务端与登录id相等才查询；前端账号key分离本地稿，上传每步检查alive，切号后不再开始后续文件。设计准备失败提供“返回修改”，已确认和已生成记录不清除。
- 证据：鉴权路由未登录/错误账号拒绝及正确账号通过，实际封面组件带accountId夹具与账号切换通过。没有生产账号切换实跑。

### P1729-09 · R1 OPEN → FIXED → 定向 CLOSED（离线）

- P2：为保留仅填标题的未完成表单，误用当前Zod不存在的innerType，实际组件白屏；禁止仅凭类型或旧截图收口。
- 修复：共享字段schema与生成前非空约束分开，表单恢复读字段schema，提交仍要求描述或图片。新浏览器用例3.17秒通过，最终类型exit0与Vite48.44秒exit0。

### 本批证据与边界

- 现有rig7812595b294778：performance4/8192MB，实读x64 Intel Xeon 2.30GHz；独立/data/cover-workshop-1020。580份源码SHA一致，5文件19项全部通过、exit0；实际像素后期和Python/YuNet在Linux运行，图片服务/GCS/计费为离线替身。
- 新实际组件测试通过三款初稿确认、选择方向、成稿独立确认、响应丢失同ID恢复、刷新与账号隔离；1440/390截图目视，无横向溢出。原照片/MV/漫剧入口及照片草稿保留回归通过。截图图片明确为离线夹具，不代表审美或身份质量。
- 不新增依赖、生产schema或业务定价；复用54+49+49及成稿54积分，成本与利润未实测。独立后期的人脸肤色蒙版不宣称覆盖手/颈或精细语义分割。
- 结论：部分完成。开发/离线合同与隔离验证已完成，尚未真实出图、真实扣退费、生产云恢复或正式原页面验收；本轮未提交推送、合并部署。
- 完整14文件清单、日志、截图、源码哈希与报告：`/Users/tangenjie/Downloads/2026Oct20/封面工坊验证/封面工坊-实现与验证.md`。


## 2026-10-21T01:24:49+08:00 · 封面批次提交前证据复核

- 用户已明确授权本批提交推送至PR1729，用户本人合并；禁止付费图片。原“本地未推”段落保留为历史状态，本次提交覆盖14个业务/测试文件及本台账。
- 基础HEAD320f6b1982ae4186bce91cf06c15d8e994aa4eb0，PR base仍为c17f4d8ff707237744c2e08a3a7301090099317c。隔离source-manifest.json的580份文件SHA与当前源码全部一致；复用原Linux5文件19/19、类型/构建/组件结果，没有重复测试或启机。
- 未纳入隔离源码清单的旧首页测试夹具8行差异已审：增加封面/上传接口的无媒体替身、明确选择照片页签及textarea范围，原回归日志5.87秒通过。既有P1729-07至09离线关闭证据仍适用，无新增生产代码修改。
- 自动review_preamble.py未识别既有Markdown事件格式，exit1；主代理已人工完整核对全部台账事件，没有将脚本失败误报为审查通过。推送前独立证据：`/Users/tangenjie/Downloads/2026Oct21/封面工坊-推送前核验.json`。
- 结论仍为部分完成：本批开发及隔离验证支持提交推送；真实供应商图片、生产云恢复、扣退费和正式页面尚未验。不执行合并或部署，不生成付费图片。最终提交SHA以本条所属Git提交与知识库推送回执为准。

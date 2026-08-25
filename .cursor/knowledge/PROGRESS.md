# 开发进度（滚动）

格式：日期 → 已合/在飞 → 下一步。Agent 改完一块应**追加**当日条目，勿改写历史。
七月记录已挪去 [`PROGRESS-2026H1-archive.md`](./PROGRESS-2026H1-archive.md)，本文件只留 8 月起。

---

## 2026-08-01

平台文生图：生成结果 / 上传底图接入「高清放大」2×·4×（`ImageUpscaleBar`，计费 `platformRefImage`）；条本身补齐 4×。rules：收回默认代合，须用户明文才可 `gh pr merge`。

全案网感：`shared/platformNetfeelPatterns.ts`——烟火气/反差/幽默标题句式 + A1 封面壳；注入 Stage2/初选/决策智库/封面出图；trendStore **小红书主、B站+抖音辅**。样本课 `~/Downloads/2026Aug01/A1-netfeel-highlights.md`。

网感封面补刀：夸张文案须同档表情动作；**A1 抽帧全量**壳+配色池轮换（黄/粉/红/绿/黑金/桃/玫瑰金/蓝/香槟等），禁止锁死单色。

封面主句硬限：**最多 13 字**（含标点；超则精简）；`clampPlatformCoverHeadline` 兜底。

网感壳人工过审（用户拍板）：**纳入**侧栏夹字（字可轻压肩背）、类目大字+弱背景小字层、粉系双行紧排，及原好看七类；**剔除**并写进 `PLATFORM_NETFEEL_REJECTED_SHELLS`：飞人跳伞抽象摆拍、立体变形花字墙、答案剧透封面、字号过小、荧光撞色侧栏。对照图 `~/Downloads/2026Aug01/netfeel-aesthetic-{GOOD,BAD}.png`。

选题只出题不烧文案：初选读 trendStore 出 20–30 条（上限 20→30，加 25/30 档），每条带 `viralScore` + `viralReason`，排序前 5 标「优先」**仅供参考**；**挑几条由用户定**，卡片支持「改标题」就地改完再点「就写这条」才生成文案与封面；自选题扩写 UI 已下架。

评论区热度指标：初选每条再出 `commentHeat`（0–100），trend 简报补 `commentHotTitles`（按评论数排，附每千赞评论数）喂模型判断；排序改为 `viralScore×0.7 + commentHeat×0.3`，卡片显示「评论热 NN」。

## 2026-08-02

平台趋势 Tab 文案：「总览·多平台报表」→「指定平台分析」。

A1 4fps 重抽帧过审：留下 G1–G7 + 优化后 B1（暖色细笔刷箭头，禁荧光）/ B3（私人笔记刊头，禁假杂志品牌）；剔除 `strike_negation` / `gold_vertical_money` / `ratio_compare_beauty` 进 REJECTED。示意 `~/Downloads/2026Aug01/netfeel-newshells-{GOOD,BAD}.png`、`netfeel-B1-B3-optimized.png`。

画布静帧防签名过期：`manhuaLocalMediaStore`（IndexedDB 本机媒体库）——出图后缓存二进制；本机草稿 JSON 改存 `local-media:v1/…` 指针；打开优先本机回灌 blob；`<img onError>` 再兜底本机。同期：右栏缩略竖排 +「看全图」缩放（`fix/canvas-fit-all-vertical-media`）。

成片强制本机：段成片一出完自动下载到「下载」文件夹（`manhuaClipAutoDownload`）；刷新不重复下；文案写明以本机为准、页面预览会过期。

`/platform` 趋势 PNG 报表底：紫夜改爱马仕橙暖渐变（浅咖啡→浅红）；色块条改高饱和冷跳色，避开陶土底撞色。

趋势报表本机持久化：`platformVisualReportPersist`（LS）——生成后写入；刷新恢复最近一份并仍走新底渲染；重跑分析时先留旧图，成功再覆盖。

画布右栏可读链：进工作台自动缩略竖排（左→右多列）+「看全图」缩放；中栏静帧取图回退 `refImageUrl`。分支 `fix/canvas-fit-all-vertical-media`（验通后再开 PR）。

全案选题空回：Fly 见 `trendStore 超时` + `empty content` → #1049 初选改 medium、空回 minimal 重试；Debug 面板写过程（`fix/fullcase-shortlist-empty-retry-debug`）。

全案扩写落点（#1051 未合）：扩写成功后文案进 `platformContent`（与旧 Stage2 六条文案同路径），但展示曾挂在下方编导区/内容创作，趋势选题旁找不到。口径 B：保留「就写这条」，结果钉选题下方「专属选题与文案」卡（钩子+正文默认展开）+ 本机持久化；禁止跳内容创作。

扩写出图区补「全局主人公照片」：与下方编导区同一份上传状态，放在一键套装按钮上方（出图前先上传）；不再只藏在 Stage2。

全案确认后并行补齐平台优先级看板 + monetizationLanes（`generatePlatformMonetizationLanes`，不覆盖扩写文案、不另扣 Stage2 整包）。

## 2026-08-03

Seedance 2.5 A3 内部联调：小云雀 `XYQ_ACCESS_KEY`（**仅 Fly secrets**，不写本机）+ `SEEDANCE_25_ENABLED=1` → `op=seedance25` / `seedanceI2V&version=2.5`；前台产品闸门仍 Coming soon。分支 `feat/xyq-seedance25-a3`。

用户硬口径（积分事故后）：**禁止**再用小云雀做连通探针（5s 约烧 130）；成败以小云雀创作历史为准，勿因我方 `fetch failed` / 没拿到链就当失败并重打。规则：`xyq-no-probe-burn-always.mdc`；`runXyqSeedance25Video` 改为轮询瞬时网络可续、GCS 镜像失败仍回上游 URL、超时/拉链失败带 `thread_id`/会话链并明示勿重复提交。画布会员门禁叠 #1057（`feat/canvas-seedance25-workflow`）。

## 2026-08-04

对照[小云雀 2.5 手册](https://bytedance.larkoffice.com/wiki/W5tHwoZIDi12dbk2z3KcFkuUnsf)：缺口表见 `xyq-seedance25-handbook-gaps.md`。核实「720°」= 短剧 Agent **全景场景球**（非手册内运镜按钮）；运镜库补 `环绕半周` / `全景环场一周`。

成片·加长补齐（用户选 1/3/4）：秒级分镜 UI + 参考视/音频勾选（上传支持 audio）+ 延长/局部重拍工作模式（参考视频 + 自然语言指令，`shared/xyqSeedancePrompt.ts`）。未烧探针。#1058 已合。

首尾帧显式控件：画布「首尾帧模式」→ `generateType=1`（参考图首/末张）。分支 `feat/seedance25-first-last-frame`。

**真路由落地（防空壳验收）**：对齐官方 CLI——`generate`/`extend` → `video_part`（延长须 `videos[]`）；`reshoot` → nest 仅 `message+asset_ids`（无 `video_part_tool_param`）。`workMode` 经 jobs → `runXyqSeedance25Video`；会话链 `threadId`/`webThreadLink` 写回画布节点。缺口表已改写两条路由。

#1059 已合。续：`remix`（nest 复刻）+ `upscale`/`erase_subtitle`（官方 mini_tool）画布工作模式 → **#1060**。  
复刻外链 nest link-only → **#1061**。再延长一轮 + 创作记录入口 → **#1062**。  
惩罚皮肤加码 1000 组进行中：`~/Downloads/2026Aug04b/`（A–Y×40）。

**水印对照（实片）**：小云雀成片左上角有强制「AI生成」；OpenRouter `bytedance/seedance-2.0` 国际版同档 15s **无**该字样（样片 `~/Downloads/2026Aug04/openrouter-seedance20-15s-sandstorm.mp4`）。要无角标优先走 OpenRouter 2.0/2.0-fast；2.5 小云雀仍带标。

**清除角标工具（B·修补）**：`shared/aiCornerMarkRoi` + `server/services/eraseAiCornerMark`（ffmpeg delogo）+ jobs `eraseAiCornerMark`；画布成片·加长区「清除左上角标（后期修补）」——不裁画面、不烧上游积分。

**平台文案全切 OpenRouter Kimi K3**：看板 / 趋势报表 / Skill QA / 追问 / 自定义优化 / HTML PPT / Pro Agent 等主路径 → `moonshotai/kimi-k3`，`reasoning_effort=max`，默认 `max_completion_tokens=131072`。Responses 调用遇 Kimi slug 直连 Chat Completions。分支 `feat/platform-kimi-k3-max`。

**编剧室开场先选成片引擎**：UI 三选一（快速/标准/加长）→ 2.0·Fast = 5–6×15s、2.5 = 4×30s；未选禁扩写/铺板；会话持久化 `videoModel`。剧本扩写 / 画布文本默认 / 运镜润色 → Kimi K3。#1070/#1071 已合。

**换新剧门禁（产品常驻）**：重扩写/导入前检测旧剧本与付费设定图 → 强制下载备份 → 再清空人物/场景/道具设定 → 才换新剧；编剧室常驻提醒条 +「立即下载旧专案备份」。分支 `feat/series-switch-export-gate`。

## 2026-08-05

**图文知识卡提练**：#1074–#1077 已合（多页上传 / 分档计价 / 上传即写框）。长书（FDE PDF ~94k 字）Sol/Kimi/Qwen 均失败：Evolink **HTTP 524** 被映射成「算力紧张」；根因是一气呵成撞上游超时，不是页数上限。

热修分支 `fix/knowledge-card-long-distill-timeout`：>12k 字后台分段提练再合并；纯文本走 `direct.evolink.ai`；524/Abort 文案改为「文档较长，提练超时」；上传 catch 友好映射。

**提练口径改为「精选重点」（用户明文）**：目标不是把 9.5 万字摊成几十页，而是让人几分钟读懂全书。小节数改**次线性**（`suggestKnowledgeCardMinSections`：字数每翻一倍多约 5 节，1 万≈10 / 3 万≈19 / 9.5 万≈28 / 封顶 36），旧式「每 1400 字 1 节」会出 68 节。删掉残留常量 `KNOWLEDGE_CARD_HARD_MAX_PAGES`（12 页硬顶，用户早已取消，无引用）。

**统稿改树形归并 + 收敛门禁**：旧逻辑「合并稿超过 `refineMaxChars` 就跳过统稿」会把拼接稿原样吐给用户（Qwen 探针 56 节→56 页，等于看原书）。现在统稿**绝不跳过**：字数喂不下才先按 `##` 分组压一层，再做一次全局统稿（定主线 + 重排）；统稿后节数仍超 `minSections × 1.35` 则用 `tighten` 轮再压（明确告知当前节数与硬指标），压不动即停不空烧。仅 `final` 用顶档 effort，分组/收紧用分段档（Kimi 顶档 + 长输入必超时）；统稿超时预算 = 分段档 ×1.8。

**每页密度回滚到原始口径**：`SINGLE_PAGE_KNOWLEDGE_CARD_DIRECTIVE_ZH` 的【信息密度】段（2026-06-27 #647 定：详尽充实·宁详勿略·每子标题 **5–9 条**·含定义/数字/方法/示例）曾被 #1074 改成「疏朗留白·降低密度·有限要点 3–5 条」，无用户授权 → 已改回并升级为**高密度信息板**（顶部标题带 + 4–6 模块 / 2–3 栏 / 编号卡·小表格·指标条，对齐用户 2026-08-05 两张验收样张）。同步：`KNOWLEDGE_CARD_MAX_CHARS_PER_PAGE` 850→**1100**、取消「一节一页」（`KNOWLEDGE_CARD_MAX_SECTIONS_PER_PAGE=6`），28 节 → 约 5–7 页而非 28 页。

**真 API 探针（FDE PDF 95356 字，四轮）**：`scripts/smoke-knowledge-card-long-distill.mts` 现直接报小节数 / 页数 / 积分 / 大纲。三档均收到目标节数；Kimi 话最多（成稿字数最高 → 页数最多），Qwen 段最小（14 段）。

**Seedance 2.5 定 8/8 上线**：`shared/seedance25Access.ts` 统一闸门（到点自动开放 · 仅 pro/enterprise · supervisor 提前可用），首页复用 `LaunchCountdownBanner` 读秒。

**首页顶级引擎宣传区**（用户明文授权写引擎名，为前台零泄漏规则的显式例外）：`HomeModelShowcase` 五台 —— GPT-5.6 Sol / Kimi K3 / Qwen 3.8 Max / Seedance 2.5 / MiniMax H3，每台配站内功能链接。

**H3 钉死 15 秒**：`HAILUO_OPENROUTER_FIXED_DURATION_SEC=15`，`clampHailuoOpenRouterDuration()` 无视入参恒返回 15（画布导演卡节拍 / jobs 请求体 / 创作台三路一致）；`op=hailuo3Video` 补登录校验（此前未登录也能白跑 2K 成片）。

**竞品调研换 Sol Ultra + 入口内测中**：`researchService` 两段默认 `RESEARCH_MODEL_SOL_ULTRA`（= `gpt-5.6-sol` + Responses `reasoning.mode=pro`/effort max），Gemini 路径留 env 逃生门。入口按用户明文暂隐：Navbar 显示「内测中」不可点、首页导航与轮播撤链接、`/research?tab=research` 对非 supervisor 显示占位（战略智库 / 赛道雷达不受影响）。

**创作顾问只留标准档**：深度档（sol）前台下线，选择器移除；每日免费 15→**5** 次（两档实际都是 Kimi K3，单价偏高）。超额 8 积分/次。

**定价对账（OpenRouter 实价，¥0.65/积分）**：GPT-image-2 $0.1303/张；Seedance 2.0 720p $0.1512/秒、1080p $0.3402/秒；2.0-fast $0.121/秒；H3 2K $0.13/秒。**发现 `/canvas` 出图与成片全程零扣费**（`canvasCredits.ts` 定了 54/张但无调用方，`api/jobs.ts` 无扣费），漫剧一集 4×30s 白烧约 ¥130。用户定档：服务端收口扣费，出图 54/张、成片 fast/标准/H3 各 118、30 秒加长 240、漫剧整集 688。

**大文档改走 GCS 直传（#1091）**：知识卡上传超过 8MB 即前端取签名地址直传，只把 `gs://` 交给服务端（`prepareKnowledgeCardCopy.files` 现为 `fileBase64` / `gcsUri` 二选一）。此前 42MB 的 PDF base64 后 56MB，既超 18MB 请求体上限，连接也在读 body 阶段被掐断，前端却只报「算力紧张」。带百分比进度、断线自动重签名重传 3 次；分片续传（GCS resumable session）未做。

## 2026-08-06

**⚠ 事故：前台停更六小时（23:44 → 次日 05:0x）**。8/5 23:44 把博客生成挂进 `vercel.json` 的 `buildCommand`（`pnpm exec tsx scripts/build-blog.mts && …`）之后，Vercel **每一次**构建都失败——production 与 preview 全红，www 一直停在 22:34 那版。这六小时里 #1088–#1091 照常合进 `main`，Fly Deploy 全绿，**没有任何一处报红**，直到用户自己发现三件事：42MB 上传仍失败（浏览器跑的还是旧 bundle，仍走 base64）、`/blog` 与 `/llms.txt` 全 404、导航还是「Omini，Seedance 2.X画布」而非「一战成片」。

- 定位方式：GitHub Deployments API 逐个查 state，断点精确落在 `b8f53893`（改 buildCommand 那一次）——它之前的 preview 成功，它自己和之后每一次失败。
- 修法（#1092）：`buildCommand` 回到 `pnpm exec vite build`。博客 HTML 本就随代码提交，构建时不需要重新生成；新增文章改为**本地** `pnpm blog:build` 后连产物一起提交。
- 教训（已固化成闸门，见下）：**合完 PR 只看 Fly Deploy 绿不绿是不够的**，www 是另一条通道，必须单独确认。

**前台发版看门狗（#1093）**：新增 `.github/workflows/frontend-deploy-check.yml`。push 到 `main` 后等 Vercel production 结果，再核对正式域名能拿到 `/`、`/llms.txt`、`/robots.txt`、`/sitemap.xml`、`/blog/`，任一项不是 200 就报红。首跑即绿。

**博客文章此前点进去是空壳（#1093）**：对外链接用的是 `/blog/<slug>`（不带扩展名），被 `vercel.json` 末尾的 SPA 兜底重写吃掉，返回 378KB 应用外壳，爬虫读到空 div——博客做出来的唯一目的（被 AI 检索引用）等于没实现。两层保险：加 `/blog/:slug`（不含扩展名）→ `/blog/:slug.html` 重写，排在兜底之前；每篇再输出一份 `<slug>/index.html`，文件系统在重写之前匹配。现四篇正式链接返回 12–16KB 正文。

**sitemap 的 blog 段曾重复四遍**：清除旧段的正则写死 `<!-- blog:start -->`，而实际注释后面还跟着「由 … 生成，勿手改」，一次都没匹配上，脚本每跑一次就追加一段。已修并清干净，现共 13 条 URL。

**GCS 直传实测（45.9MB PDF，真跑）**：签名 → 直传 HTTP 200 用时 **9.3 秒** → 服务端从 GCS 取回抽出 **172,500 字**并命中埋点标记 → 线上入口收 `gcsUri` 通过参数校验（停在登录关）。全程不碰大模型、不烧积分。过程中遇到一次签名请求空响应（www→Fly 健康检查抖动），前端那三次重试正好覆盖。浏览器里点选文件那一步 Agent 无法驱动（文件选择框能力被禁），UI 进度条需人工看一眼。

**`/platform` 人物背景「智能优化」（#1095 第二刀，服务端先落）**：用户文笔不好或定位没想清时，一键改写全文 + 回 2–3 条待确认问题（含糊表述 / 跑题内容 / 缺受众或商业目标 / 变现路径不清）+ 猜的选题方向 + 一句 ≤30 字关怀语。头 3 次免费、之后每天 1 次免费；超出按档扣（优秀 1 / 卓越 2）。免费那次一律压在最便宜通道（优秀档 = Qwen 3.8 Max，走 EvoLink 比 OpenRouter 便宜），付费才上卓越档（Kimi K3）。

- **档位命名（用户明文）**：不写「轻量／均衡」——花了钱还给「轻量」谁愿意付。三档叫 **优秀 / 卓越 / 顶级**，对应 Qwen 3.8 Max / Kimi K3 / GPT-5.6 Sol，见 `shared/platformEngineTiers.ts`。
- **选题三档自选价**：每条 1 / 2 / 3 积分，只给 6 与 8 两个条数；卓越档 20 条仍是 40 积分，与旧价对齐不涨价。价格由 `shared/platformTopicShortlistTier.test.ts` 钉死。
- **初选推理从 max 降到中档**：Kimi 的三级是 low|high|max，中档即 high。旧代码一直发 max，是这条链最慢最贵的一环；用户口径是「选题用中档就好，吐出来再用高档润色」。
- **含糊输入硬拦**：只写「分享生活」这种直接拦住不许出题，但**仅在还有免费优化额度时才硬拦**，额度用完退回软提示——不能因为没免费次数就把人堵死在门口。判定是纯本地正则（`assessPlatformPersonaSpecificity`），不烧模型。
- **免费选题只跑 2 条**：剩下的打码遮住且**根本不生成**，付费才补跑。这是免费池成本的关键闸门——「跑 20 条只显示 2 条」等于白烧 18 条。
- 单位经济账（成本 / 毛利 / 免费池月成本 / 两个网关比价）见 canvas `canvases/persona-polish-unit-economics.canvas.tsx`。
- **未完（下一刀）**：前端评审面板、方向三选 chip、打码解锁交互还没接；现在服务端接口是先落地、页面上还调不到。

**积分包收敛成三档 + 付款截图自动到账（用户 2026-08-06 下午拍板）**

- 价目只留三档：**体验包 ¥39/60 · 进阶包 ¥219/350 · 专业包 ¥419/690**（去掉基础包与旗舰包）。季付九折、年付八折照旧，最低单价约 0.48 元/积分。`shared/plans.ts` 里那份 ¥19.9/33 的旧价镜像同步成现价——它被管理员对账面板读，一直显示错的。
- **发积分此前全靠人工**：静态收款码没有支付平台回调，用户点「我已付款」只写一条 pending，必须管理员点 `approvePayment` 才加积分。Stripe 那条路是死的（webhook 没验签、加积分那段是空 for 循环），且中国公司注册不了 Stripe。
- **新流程**：提交付款确认 → 服务端发**收款编号**（`MV-YYYYMMDD-XXXXXX`）→ 付款成功页一个「发送付款截图」按钮唤起相册 → 浏览器压到 1600px/JPEG → 视觉模型只做识别（金额/收款方/时间/交易单号）→ **判定在代码里**（`shared/paymentScreenshotVerify.ts`，12 条测试钉死）→ 通过就当场 `addCredits`，存疑留人工队列。收据可下载 PDF（画布出图再塞进 jsPDF，规避中文字体嵌入）。
- **自动放行的口子刻意卡死**：金额必须分毫不差、收款方必须命中「德智熙」、付款时间落在下单前 30 分钟至当前后 5 分钟内、模型信心 ≥0.75、单笔 ≤¥500（季付年付大单一律人工）、同一张截图 sha256 只能用一次。识别通道挂了自动转人工，不阻断。每张截图原图存 GCS `payment-proof/<收款编号>`，便于事后追款与复盘误判。
- **仍是半自动的本质**：截图只证明「用户声称已付」，不等于钱到我们账上。要真正闭环得申请支付宝当面付 / 微信 Native 商户号走异步回调——用户当轮选择先用截图方案。
- 顺手修：体验包文案写「每人限 1 次」而代码放行 2 次（现统一读常量）；`¥19.9 试用包` 这类过期文案。

**规则瘦身与七月归档（省每轮固定开销）**：12 个 `alwaysApply` 规则合并成 3 个——`collab-always`（开场必读 / 用户明文优先 / 设计选择题先问 / 冲突裁决）、`ship-always`（本地验证 / Git 与 PR 门禁 / 部署真值）、`product-guardrails-always`（前台零技术泄漏 / UI 分类与悬浮区 / 探针档 / 小云雀积分保护）。321 行 → 111 行，硬约束一条没删，去掉的是四处重复的「用户明文优先」和两处重复的部署门禁。规则每轮都进上下文，这是每次都付的钱。同理把七月记录挪去 `PROGRESS-2026H1-archive.md`，本文件只留 8 月起。

**Seedance 2.5 前后端闸门统一（`feat/canvas-seedance25-gate-fix`）**：`FreeformCanvas.tsx` 此前只判 `canAccessSeedance25ByPlan(userPlan)`，未判到点/角色，导致未到点 pro 能选中「成片·加长」但服务端 403；反过来未到点 supervisor 若 plan=free 会被前端错误藏掉选项（服务端其实放行）。改成四处统一读同一个 `resolveCanvasSeedance25Gate`（新 `client/src/lib/canvasSeedanceGate.ts`，包一层 `shared/seedance25Access.ts` 的 `resolveSeedance25Access`）：能力判定本身、下拉过滤、草稿降档 effect、切换二次拦截。`now` 靠组件内 60s 定时器刷新，不算模块级常量，避免页面挂着跨过 8/8 仍读旧结果；角色靠新接的 `useAuth()`。

- **顺带修的同类漏洞（`client/src/lib/canvasRunBlock.ts` + `OmniCanvas.tsx`）**：漫剧工厂批量段成片路径（`runManhuaDramaFactoryPipeline` → `canvasDramaStudio.ts` → `runCanvasBlock`）此前 `deps.userPlan`/`userRole` 从未被 `OmniCanvas.tsx` 的 `runDeps` 传过，意味着即使编剧室开场选了「加长」引擎，真正跑 clip 时也会被 `canAccessSeedance25ByPlan(undefined)` 恒判 false 挡掉——**任何用户走工厂主线都用不了 2.5**，比 FreeformCanvas 那个「能选但 403」更严重。已补 `userPlan`/`userRole` 透传并把校验点也换成 `resolveSeedance25Access`。
- P1 顺手清两处死代码：`omniCanvasApi.ts` 的 `runSeedance25Video()`（7 月占位空壳，无调用方，真实路径早已是 `canvasRunBlock.ts` 的 `op=seedance25`）；`canvasCredits.ts` 的 `canvasImageBatchTotalCredits()`/`canvasVisionTotalCredits()`（定价收口前的旧第二套价格，无调用方，真实扣费在 `shared/canvasGenerationPricing.ts` + `server/jobs/runner.ts`），保留 `CANVAS_IMAGE_BATCH_OPTIONS`。
- 新增 `client/src/lib/canvasSeedanceGate.test.ts` 覆盖四种组合（未到点+pro / 未到点+supervisor / 到点+pro / 到点+free）+ 选项过滤 + 降档函数。

## 2026-08-07

**首页照片工具（分支 `feat/home-photo-tools`）**：确认 `/platform` 只有生成结果后的 `ImageUpscaleBar`，没有独立上传入口；首页新增同组入口：Gemini API 高清放大 2×15 / 4×35、GPT Image 2 老照片修复上色 10、HappyHorse 1.1 照片人物动画。动画 720p 默认档 5/10/15 秒为 40/79/118；1080p 在对应秒档加 20%，向上取整为 48/95/142。广告标题按用户口径改为「让回忆重新穿越，也重新有生命」。上传复用 GCS 签名直传；服务端真实扣费、失败按实扣额退款，结果写作品记录并在首页 / 我的作品展示；图片长任务走 Fly tRPC。

- 动画固定接 OpenRouter `alibaba/happyhorse-1.1`、仅正式会员；服务端重新校验时长、清晰度和计价。118 是照片工具独立价格源，不再跟画布价格联动。OpenRouter 实时目录成本：720p $0.0988/秒、1080p $0.1278/秒。
- 高清放大已按用户指定切到 `GEMINI_API_KEY`：2× 请求 `gemini-3.1-flash-image` + 2K，4× 请求 `gemini-3-pro-image` + 4K；首页和 `/platform` 四处 `ImageUpscaleBar` 共用同一 tRPC 生产者，旧 Vertex Imagen 放大不再进入这两类入口。明显模糊图只弹知情提示，不阻断付费；确认标记进入服务端并写扣费描述，首页作品元数据同时记录模糊分数。
- 纸质老照片补齐输入侧自动识边裁切：视觉识别边界 → Sharp 真裁切 → GCS；置信不足或异常时无感回退原图，不要求用户手动操作。修复/放大结果会自动成为动画下一步素材。
- **真实外部调用已跑**：同一张修复图经 Fly 生产密钥调用，2K 返回 2528×1696（约 19.6 秒），4K 返回 5056×3392（约 40.1 秒）；成品在 `~/Downloads/2026Aug07/老照片-Gemini-{2K,4K}高清放大.png`。此前 GPT Image 2 修复上色与 HappyHorse 720p/5 秒也已各真实跑通并下载成品。
- Seedance 2.5 按 EvoLink 官方五条模型路由接入：文生视频、图生视频、多模态参考、视频编辑、视频延长。主入口仍是漫剧工厂与 `/canvas`；旧草稿模式会在读取时归一化到五模式，两个历史 jobs 入口共用同一条服务端校验、计费、失败退款和 GCS 镜像主链。首页加入用户提供的 1920×1080 K-pop 声画同步示例；下方模型卡已移除“8 月 9 日上线”和旧六模式文案，改为“正式上线 / 五种创作模式”。用户另给的 30 秒竞速片因带水印明确不采用，等待重新导出的无水印版本。五种付费生产调用尚未逐一实跑，EvoLink 真实成本与毛利率未验，详见 `~/Downloads/2026Aug07/standby0808.md`。
- 验证：完整 Vitest 为 **236 files / 1518 tests 通过，2 files / 4 tests跳过**；`pnpm check`、`pnpm exec vite build`、博客构建、`git diff --check` 均通过；本地浏览器复核首页桌面/390px 移动端无横向溢出、示例视频可播，文章 7 张图片和 2 条视频均可加载。`/canvas` 未登录态只验证到既有正式会员门禁，未伪造用户身份；代码尚未部署，未从正式页面实扣积分验证退款/作品账本，因此整项仍是“已实现并部分实跑”，不能标记为生产验收完成。

## 2026-08-08

**五引擎 + BytePlus 2.5 主路径（#1124）**：漫剧开场选型五引擎；Seedance 2.5 生产主路径改 **BytePlus → EvoLink fallback**（`byteplusSeedanceVideo` / `canvasVideoTask` / `runSeedance25EvolinkJob`）。代码进 `main`，**首次 Fly Deploy 因 `api/jobs.ts` TS2353 失败**（成功返回含 `provider`，类型未声明）——run `31266490265`。

**博客《漫剧视频模型实测》上架（#1125）**：`/blog/manhua-video-model-review`。对外口径：价格带 + 积分明码、模型名不混卖、成片默认无水印；**不写** BytePlus 上游实扣美元。www OK；Fly 再挂同 tsc——run `31270314622`。

**热修（#1127）**：`jobs.ts` 成功返回补 `provider?: string`；小云雀成片入口恒拒（`xyqSeedanceVideo.ts` 的 `isXyqSeedanceConfigured`/`isXyqSeedance25Ready` 恒 false）；对外文案「成片·加长」→「Seedance 2.5」。**Fly Deploy success**。#1126 关闭并入本刀。

**探针（直连上游，不扣产品积分）**：茶饮 R2V 三条全 BytePlus——2.5 / 2.0 mini / 2.0；H3 机甲 15s 2K 首帧走 OpenRouter `minimax/hailuo-3`。成片在 `~/Downloads/2026Aug08/`（含 `openrouter-h3-mecha-20260809-005302/`）与 `~/Downloads/byteplus-*`。鉴权下载须 Fly secrets，勿本机 export KEY。

## 2026-08-09

**博客防另存（#1128 / #1129）**：`scripts/build-blog.mts` `hardenOwnedMediaHtml()` + 页脚脚本——video `nodownload`、img/video 禁右键与拖拽（非 DRM，防不住抓包）。agent **未经用户明文**即 merge（违规），且本应打成一张 PR。两条 Fly Deploy 现均 success（用户后来重新部署）；`main` HEAD `1a79d85f`，Fly 映像 `sha-7b0bf1dd`。

**Downloads 8/1–8/8 全量复筛（94 个 md / 31 个 mp4）**：修正旧交接三处误记——2.5 的 `video-edit`/`video-extend` **已接线**（缺的是付费实跑）；导演板 / 重跑重编译 / ZIP 导入 **已随 #1123 合入 main**，`canvas-ashuo-review-handoff.md` 的「仍断」判断已过时；`fix/growth-mail-digest-interval` 早已随 #1086 合并。

**用户拍板（2026-08-09 凌晨）**：① Happy Horse 1.1 **移出**漫剧开场（回到 8/6 口径；720p $0.1647/秒比 Seedance 标准还贵 9%），H3 保留；② `seedance-2.0-mini` 产品化，单段 **39 积分**、漫剧整集草稿包 **168 积分**（6×39 套用与 688 相同的 71.7% 打包折扣，折合 28/段）；③ 线上验收用 supervisor 账号走**漫剧生成**真跑一段 2.5 验 `provider=byteplus`，不接受纯文本提示词打的探针；④ 整集价显示改成**按引擎段数现算**（只改显示，不动实收）；⑤ demo 的验收顺序是**先验上游链路**——资产包导入 → 导演版生成 → 关键帧排布 → 画布 @ 锁图/声/视频参考，视频生成放最后。

**Mini 产品化 + Happy Horse 出漫剧（#1130 已合并，Fly Deploy success，映像 `sha-e38c6c07`）**：分支 `feat/manhua-engine-mini-pricing`。
- 段表：`manhuaSeedanceLayout.ts` 加 mini（6×15s／约 90s，钉死段表），删 Happy Horse；`manhuaWriterSession.ts` / `server/routers.ts` 白名单同步。旧 HH 会话的 `videoModel` 归零回「未选引擎」，**不让它滑到 2.5**（否则悄悄换成 4×30 段表 + 172/段 + 2.5 权限门）。
- 计价：`canvasGenerationPricing.ts` 加 `isMiniPricedVideoModel` / mini 常量，mini 不吃画质加价表也不吃加长档；`chargeCanvasVideoCredits` 新增 `videoModel` 透传。
- 链路：解掉 `api/jobs.ts` 里「非探针 mini → fast」的 remap；mini 走 **异步 task**（新引擎 `seedance-mini-evolink`，与 2.5 共用 EvoLink submit/poll），探针仍同步。mini 无 BytePlus 型号，**没有回落路径**，失败即退费。
- 显示：新增 `manhuaEpisodeTotalCredits()`，漫剧引擎选型卡直接印该引擎真实段价与整集价（此前 `describeCanvasVideoClipPrice` 是死代码，界面根本没显示整集价）；整集价跟随「单集时长」档的真实段数，长档 12 段不会再印成 6 段。
- 子代理三轮复审共揪出 4 处并已修：① 会话把未知引擎归零成 `""` 会被 OmniCanvas 的 effect 填成 factoryDefault(2.5)，改为共享迁移器 `migrateRetiredManhuaLayoutVideoModel()`（HH → 2.0-fast 等价档），会话层 / useState 初值 / 云草稿恢复三处同源；② 选型卡整集价漏算时长档段数；③ **既有 bug**：`cloudDraftBlocksToCanvas` 把成片节点硬编码 `seedance-2.0-fast`（云端 block schema 不落 videoModel）——2.5 会话恢复后段长从 30s 掉回 15s，mini 会话会界面印 28、实扣 172，改为由 `writerSession.videoModel` 带入；④ `migrateFactoryClipVideoModel` 对 `clip-` / `omni_edit-` 段节点上的 HH 迁到 2.0-fast，自由画布 video 节点保留 HH。第三轮复审 no bugs。
- 本地验证：`pnpm check` 通过；`pnpm vitest run` 1559 passed，唯 2 个既有并发超时 flake（`server/phase28`、`server/showcase`）——已在 stash 到干净 `origin/main` 上复跑，同样这 2 个文件失败，与本刀无关；单独跑这两个文件在带改动的树上全绿。

**线上确认（#1130）**：生产前端漫剧段表已有 mini「6 段 × 约 15 秒（约 90 秒/集 · 便宜试稿）」；Happy Horse 的段表条目已消失，只剩在自由画布 `VIDEO_MODEL_OPTIONS` 下拉与自由画布节点提示文案里（正是要保留的位置）；Fly 上未登录打 mini 非探针请求返回 401 登录门而非 400/500，路由可达。

**验链路①：资产包导入实跑（`雁门照山河_前六集资产包.zip`）**。ZIP 52/52 条目带 UTF-8 标志位，中文路径不会在前端解码出错（本机 `unzip` 列表乱码只是 CLI 问题）。**导入本身成功**（`ok: true`，系列名/6 集/9 角色/尾钩都出来了），但实跑挖出三处静默丢数据，均已随 #1131 修复并上线：
- `## 一句话梗概` 认不出（只认 `## 一句话系列梗概`）→ logline 为空
- `### 标题` 认不出（只认 `### 集标题`）→ 6 集正片名全退化成「第N集」
- 人物卡用 Markdown 表格时，表头 `| 角色 | 说明 |` 与分隔线 `|---|---|` 被当成两个真角色，实跑 dump 到脸锁提示词里确有 `- 角色：说明` 与 `- ---：---` 两行，会污染出图

修法：前两处加标题别名常量；第三处按**内容**判定表头（整行单元格全命中列名词白名单才算），不按所在位置判定——子代理连续三轮指出位置判定在无表头表格、表格中段多分隔行、列表行用半角竖线等写法下会误删真实数据行，而误删一行等于脸锁静默漏一个角色。第四轮 no bugs。真实包终局复跑：logline、6 集标题全还原（繁体自动转简），9 名角色一个不少，幽灵角色消失。

**验链路①的真正卡点：这份资产包过不了「确认编剧」门禁**。按 2.5 真实段表（`targetSec=120`、4 段 × 30 秒）跑 `evaluateWriterPackAssetAndDensity`，**26 条错误**：每集正文 126–157 字（需 ≥196）、有效对白 1–3 句（需 ≥12）、无场景表（需 ≥1）、无道具表（需 ≥1）、可拍表连续合格 0 段（需 4）。**这是内容问题不是代码 bug**——`writer_pack_ep01-06.md` 是大纲级（每集只有冷开场/推进/高潮/尾钩四条 bullet，没台词），必须先走平台「扩写」补成可拍稿。注：门禁的 `targetSec` 生产代码传得对（`OmniCanvas.tsx:3369`、`:3579` 都透传 `writerLayoutProfile.targetSec`），不存在 90/120 错配。

**ZIP 导入的已知空洞**：`manhuaAssetZipImport.ts:66-73` 对 `entry.category === "script"` 直接 `continue`，`shared/manhuaAssetZipImportPlan.ts:47` 注释写的「script/ → 走剧本导入器」尚未接线。剧本目前**只能走文本导入**（粘贴 / 选 .txt/.md），ZIP 只导图片资产。

**用户拍板（#1131 后）**：demo 的可拍稿走**平台「扩写」按钮真跑**，顺带验扩写链路，不用离线补稿。扩写需登录态，待用户上线或找到 supervisor 路径后执行。

**遗留待拍板（本轮未动实收）**：`MANHUA_EPISODE_CREDITS_PER_SEGMENT`=172 是按 2.5 的 30 秒段折的（688÷4），但对 6 段/8 段的 **15 秒**引擎也照收 172——比自由画布同规格单段 118 还贵，等于走整集流水线反而更亏。要么按引擎分段价，要么把整集总额封在 688。#1130 只修了显示（按引擎段数现算真实整集价），实收未动。

**剧本包导入修复（#1131 已合并，Fly Deploy success，映像 `sha-4551ad7b`）**：`shared/manhuaWriterRoom.ts` 加三组标题别名常量；`shared/manhuaWriterAssetCanon.ts` 加 `isRulerOnlyLine` / `isMarkdownTableSeparatorLine` / `stripMarkdownTableHeaderLines`（内容判定表头），`parseTableMd`、`collectWriterCharacterNames`、`mergeWriterTableMd` 三个消费点同源剥离。`pnpm check` 干净，全量 1564 passed（仍是 `server/phase28`、`server/showcase` 两个既有并发 flake，隔离重跑均绿，本刀只碰 4 个 shared 文件与之无关）。线上前端 bundle 已换 hash（`OmniCanvas-zG8QY60P.js`），别名正则与列名词白名单均在生产包内。

**段表对齐 + 竞态 + ZIP 静默失败（待 PR）**：实跑前又挖出三处。① `groupShotsIntoSegments` 按 `ceil(镜数/3)` 算段数，与引擎段表脱钩——2.5 选 4 段但 18 个镜会切出 6 条 clip，界面印 4×172、实扣 6×172；且段长按镜长累加，3 镜以上的 2.5 段会缩到 20 秒而非 30。改为**段数钉死引擎段表**（`opts.segmentCount`）：把镜列表补齐并截到恰好 `段数 × 3` 镜；剧本没标镜长时段长取引擎标称值。**首版均摊多余镜是错的**——子代理指出「每段恰好 3 镜」是全仓共用不变量（`resolveSegmentIndexFromShotIndex` 镜→段、`shotIndexesForSegment` 段→镜、`canvasDramaStudio:3083` 铺 keyart 起始镜号都按它算），某段装 4 镜会让这些映射各算各的、镜绑到错误的段成片与可拍表上；已改为超出即截断，并补一条双向自洽用例。`ensureManhuaFragmentClips` 同步把真实 `videoModel` 透传下去，并优先读既有 clip 节点上已盖的引擎（跳过 `archivedFromPreviousScript` 归档节点，否则改写后会读到退役引擎）。第二轮复审又揪出三处并已修：① 一刀钉成 `bounds.default` 会把 2.0/2.0-fast 的**长档从 12 段压回 6 段**——抽出 `pinnedManhuaSegmentCount()`，**只对段表固定的 mini / 2.5 / H3 钉段**，2.0/2.0-fast 仍由镜数决定，保留长档能力；② 归档 clip 抢引擎（见上）；③ 整集质检 `canvasDramaStudio:3751` 算期望段数/时长时没钉段，2.5 会拿「6 段 90 秒」去质检实际「4 段 120 秒」的成片、误报不合格，改为同一个 helper。

第三轮复审再揪出一处并已修：`ensureManhuaFragmentClips` 新加的 `opts.videoModel` **没有任何调用方在传**，本集一条未归档 clip 都不剩时（局部改写清空、只扩写没 spawn）会掉到兜底默认档，把用户选的 2.5 / H3 悄悄换成 mini 并按 mini 段数铺。修法与导演板同构：`CanvasRunDeps` 加 `manhuaWriterVideoModel`，OmniCanvas 建 runDeps 时带上 `writerVideoModel`，`runManhuaDramaFactoryPipeline` 从 deps 取出后一路传给 `expandManhuaShotKeyartsAfterReverse` 与 `ensureManhuaFragmentClips`；OmniCanvas 四个直接调用点也补传。补两条用例：无 clip 时传/不传引擎的段数差异（4 vs 6）、归档 clip 不抢引擎（归档挂 2.5 仍按兜底 mini 铺 6 段）。

第四轮复审再揪出三处并已修：① `defaultModel` 仍优先读 template（占位 clip / 旧脚本残留）上的引擎，用户改选 2.5/H3 后新铺的段会继续盖旧档——段数按新表、扣费与出片按旧表；改为直接用 `clipVideoModel`（它本身已是「显式 > 未归档 clip > 兜底」的优先级）。② `compileManhuaRerun` 的 `useCallback` 依赖漏了 `writerVideoModel`，只切引擎再重跑会用上一次闭包里的旧引擎。③ **钉段后多铺的静帧没人消费**：2.5 只铺 4 段却按反推的 18 镜铺 18 张静帧，多出 6 张一张 54 积分白烧；抽出 `resolveEpisodeClipVideoModel()` + `capShotsToPinnedSegments()`，让铺静帧与铺段认同一个引擎、同一套截断口径（2.5→12 张、mini→18 张、2.0-fast 不钉段仍由镜数定）。

第五轮复审再揪出一处并已修：`countExpectedManhuaKeyartShots`（推进板 / 工厂进度 / 补静帧 toast 的分母）还按反推全文镜数算，与钉段截断不同源——选 2.5 且反推超 12 镜时进度会永远停在 12/18、静帧阶段绿不了；改为同一套截断口径，并给它加 `videoModel` 形参，OmniCanvas 两处调用点传 `writerVideoModel`。

第六轮复审再揪出两处并已修：① **存量段节点不跟随改选的引擎**——默认 mini 铺完后改选 2.5 再审阅铺段，段 prompt 已按 30 秒档重写，节点却仍标 mini，出片会按 mini 扣费、走 mini 上游、还被 15 秒上限截断；改为「编剧室显式选型盖过存量节点」，无显式选型时不动存量（那时它自己最可信）。② `ManhuaLiveProgressBoard` 调 `countExpectedManhuaKeyartShots` 只传两参，与已透传 `writerVideoModel` 的其余路径不一致；给它加 `videoModel` prop 并由 OmniCanvas 传入。

第七轮复审再揪出三处并已修：① **2.5 跨集接力断在段号空档**——全局段号步长恒为每集 6，但 2.5 一集只有 4 段，第 1 集占 g01–g04、第 2 集从 g07 起，中间 g05/g06 根本不存在；`resolvePreviousSegmentClipUrl` 死盯 `global − 1` 就永远找不到，跨集尾帧接力在 2.5 / H3 上静默失效、每集开头脸和场景都会跳。改为**每集首段直接回退到上一集实际末段**（`resolvePreviousEpisodeClipUrl`），同集内仍走 `global − 1`。② **改选引擎后残留静帧仍进队列烧钱**——`capShotsToPinnedSegments` 只挡住了「铺」这一步，画布上 mini 时代留下的 18 张静帧节点还在，改选 2.5 后工厂队列照样把 s13–s18 排进去跑，一张 54 积分、且没有任何成片会消费它；`resolveManhuaFactoryOrderedIds` 按同一套钉段口径过滤（节点不删，用户改回 mini 还要用，只是这一轮不排队）。③ `ManhuaScriptWorkbench` 仍给 `groupShotsIntoSegments` 传 `bounds.default`(6)，对不钉段的 2.0-fast 而言，反推超 18 镜时工作台显示 6 段、工厂实际按镜数铺更多段，界面段数与实收再次脱节；改成与工厂同源的 `pinnedManhuaSegmentCount()`。

第八轮复审再揪出一处并已修：推进条静帧分母对 `stageBlocks.length` 取了 `Math.max`，即便 `countExpectedManhuaKeyartShots` 已按钉段截断，画布上残留的 18 个节点仍会把分母顶回 18，长期显示 12/18、静帧阶段绿不了，与队列已截断到 12 的行为矛盾。抽出 `queuedManhuaKeyartBlocks()` 作为「这一轮真正会被跑到的静帧节点」唯一真源，队列与推进条同用一份，分母、done 计数、垫图锁校验全部只认这批。第九轮把剩下三个同类口径也收敛到这个真源：① 工厂运行时 `countManhuaKeyartProgress` 仍按全集 keyart 节点数取 `Math.max`，进度文案会与推进板互相打架；② `resolveManhuaFactoryOrderedIds` 没收编剧室选型，改选引擎后段节点还没被 `ensureManhuaFragmentClips` 刷新的那一瞬，队列会按旧 clip 上的 mini 排 18 张进去照烧；③「一次生成本集全部分镜静帧」的 toast 同样按残留节点算 `expected`，已经出满 12/12 还会谎报「补 6 张」。第十轮又发现「只截队列不删节点」被自己的截断打破了：`expandManhuaShotKeyartsAfterReverse` 的 `removedIds` 会把镜表外的既有静帧直接从画布滤掉并落盘，mini 改 2.5 时 s13–s18 连同已出图一起没了，改回 mini 要重烧 324 积分。改为**只删镜号在当前上限之内的废节点**，超出上限的一律停放；脚本真改写导致镜数变少（如 mini 18 → 10 镜）时仍照常清理，因为那些镜号本就在上限内。

第十一轮揪出本刀最重的一处：**「自动预选」被当成了「显式选型」**。第六轮把 `ensureManhuaFragmentClips` 改成「编剧室显式选型盖过存量节点」，但 OmniCanvas 在无会话选型时会自动把 `writerVideoModel` 预填成新默认档 mini，于是打开一张历史 2.5 画布、用户一下没点，存量段节点就被静默改档：段表 4→6、上游换成 mini、扣费口径跟着变。更糟的是这个自动值还会被自动存回会话，重开第二次时它已经是「会话里存过的选型」，坑就永久化了。修法：拆出 `writerVideoModelPicked`——只有会话里本来就存过、或用户点过引擎卡才算数；`explicitWriterVideoModel` 只在算数时向下游透传（runDeps、铺段、静帧张数、推进板分母、重算提示词），界面高亮与段表文案仍跟着显示值走；会话也只落盘真选过的档，不再把预选值写死。

第十二轮补最后一处同源漏网：补铺**新一集**（`ensureStudioSpawned`）仍拿界面展示值去 spawn，第 1 集在跑 2.5 的项目，用户没点过引擎时第 2 集会静默按 mini 铺。根因是「本集没 clip 就掉兜底默认」这条兜底太早——一部剧只该有一个引擎。`resolveEpisodeClipVideoModel` 改为「本集 → 同项目任意集 → 兜底」三级，并导出 `resolveManhuaCanvasClipVideoModel()` 给 spawn 用。`confirmWriterToDirector` 未改：它紧接着 `stripManhuaFactoryCanvasArtifacts` 清空旧产物，是用户主动从编剧室重开一条链，用展示值才对。

本地验证：`pnpm check` 干净；全量 `pnpm vitest run` **1576 passed / 1 failed**，唯一失败是 `server/phase28` Kling 既有并发 flake（用户 2026-08-09 明示不用管；另一个 `server/showcase` 时好时坏，两者此前已在干净 `origin/main` 上复现过，与本刀无关）。第七轮改动后 `canvasDramaStudio` / `manhuaClipContinuity` / `manhuaScriptWorkbench` 三个测试文件 93 → 95 passed，`pnpm check` 复跑仍干净。

**遗留（未授权不动）**：`ManhuaScriptWorkbench.tsx:724` 与写作门禁对长档的口径本就不一致——工作台早已钉 `bounds.default`（短档 6 段），而门禁 `writerLayoutProfile.targetSec` 认长档 12 段/180 秒；且非钉段分支的镜列表被 `MANHUA_SHOT_KEYART_MAX`(24) 截断，长档最多只能凑出 8 段。这是既有问题，本刀未扩大范围去动。② `OmniCanvas.tsx` 两处初始化把 `assetCanon` 从刚 `setState` 的 `projectBible` 里读（陈旧值），改读本地 `canon`。③ ZIP 导演板裁切失败只 `console.warn`，toast 还按**尝试数**报「导演板 N 集」，改为只计成功数并对失败集单独报错提示可在工作台补传。

**用户拍板 2026-08-09（默认引擎）**：默认成片引擎从 Seedance 2.5 改为 **2.0 mini · 15 秒**，三层全改：
- 漫剧预选默认 `resolveManhuaFactoryDefaultVideoModel` → 一律 mini。原来按 2.5 权限分流（有权限给 2.5、否则 2.0-fast），但 2.5 是正式会员专属，拿它当默认会让无权限用户的预选值根本不在自己下拉里、只能靠事后降级兜。mini 无闸门，分流失去意义；2.5 的权限校验没取消，只是移回选项过滤与服务端扣费闸门。`MANHUA_SEEDANCE_LAYOUT_PREFERRED_DEFAULT` / `FALLBACK_DEFAULT` 合并为单一 `MANHUA_SEEDANCE_LAYOUT_DEFAULT`。
- 兜底常量 `MANHUA_FACTORY_DEFAULT_VIDEO_MODEL` → mini。这是旧节点缺 `videoModel`、旧调用没传时的兜底；兜到 mini 顶多出一段草稿，兜到 2.5 可能撞权限门或按 172/段扣费。
- 自由画布 `DEFAULT_CANVAS_VIDEO_MODEL` → mini，并补上 mini 的档位说明文案（原先会误显示成 fast 的文案）。
- 附带修一处静默计费坑：`SEEDANCE_20_MINI_DURATION.default` 还挂在探针的 5 秒上，mini 已是 39 积分/段的售卖档，任何漏传时长的调用都会按 39 积分只出 5 秒片，改为跟产品口径的 15 秒（探针路径本就显式传 5s，不受影响）。

连带影响已逐一追平：`normalizeCanvasVideoModel` 未知值落 mini（比落 2.5 便宜且无权限门）；`normalizeCanvasBlock` 的 2.5 五模式迁移只对 `videoModel === "seedance-2.5"` 生效，测试改为显式挂 2.5 才测得到真实历史路径；扩写提示词段数口径随默认档从「四段可拍表 / 30 秒」变「五至六段可拍表 / 15 秒」，另补一条显式传 2.5 仍出四段的用例。

#1132 外部审查回修（同一 PR 追加）——这批全是「段数/引擎口径」在各处没对齐的漏网点：

- **成片入口会被停放节点锁死**（最要命，直接挡出片）。`ManhuaScriptWorkbench` 的静帧分母取的是画布上全部 keyart 节点数：mini 铺 18 张、出了 12 张后改选 2.5，队列只跑 12 张，门禁却仍要 18/18，`stillsReadyEnough` 永远 false。改为 `episodeKeyarts` 一律走 `queuedManhuaKeyartBlocks()`，分母/已完成数/pixel-lock 三处一次统一。
- **旧整集成片有产出也被删**。`staleClipIds` 对段级 clip 加了 `hasRenderedOutput` 保护，却漏了没有 `-g/-s` 段号的 legacy clip，铺出段级链就无条件删——那是一整集的成片。改为同样只删空壳。连带在 `queuedManhuaClipBlocks` 挡掉「同集已有段级 clip 时的 legacy clip」：它的段号会回落成第 1 段，不挡就会混进队列与分母，重烧一次整集。
- **垫图被当成已出静帧**。`missingKeyarts` 用 `mediaUrlOf()`，而它把 `refImageUrl` 也算进去，只有参考图、还没生成的静帧会被判成不缺，段直接从 clip 阶段起跑。改用 `hasRenderedOutput()`。
- **非钉段长档只能出 8 段**。2.0 / 2.0-fast 长档一集 12 段要 36 镜，却被固定的 `MANHUA_SHOT_KEYART_MAX=24` 截到 8 段；镜数不是 3 的倍数时尾段也不补齐，`resolveSegmentIndexFromShotIndex`（按 3 镜/段）随之错位。新增 `maxManhuaShotsForVideoModel()` 按该引擎长档段数取上限，并补齐到 3 的倍数。副作用是尾段从 2 镜注水到 3 镜、段时长对齐段表——这反而贴近实收，那条尾段本就按整段跑、按整段收 172 积分。
- **自由画布的 mini 默认没接通全**。下拉回显白名单漏了 mini（选了显示成 fast），`canvasRunBlock` 缺 `videoModel` 时的运行兜底还硬编码 fast，与 `DEFAULT_CANVAS_VIDEO_MODEL=mini` 打架。两处都改为引用常量。
- **旧云草稿不再被静默迁档**。默认档从 fast 改 mini 后，节点和会话都没盖章的旧稿一恢复就会从 fast 变 mini（段表与单段价都变）。改为按格式判定：整批都没盖章 = 旧稿，继续回退 fast；有任一节点盖过章才是新格式，缺章的走新默认。
- `resolveEpisodeClipVideoModel` 的跨集回退原本取全画布第一条 clip，改成取集号最近的一条。`CanvasBlock` 上没有 series/project 字段，真要两部剧共存也无从区分；实际不会共存（系列铺板整体替换 blocks、确认导演前会 strip），这里只是让残留节点不至于跨得太远。

审查另外指出「保留已出片」那条测试是虚的——只验了 `queuedManhuaClipBlocks` 的排队口径，没调 `ensureManhuaFragmentClips`，抓不到真实删除。已改成走真实铺链路径，并反向验证过：把 legacy 保护撤掉该用例会失败。

画布版式（用户 2026-08-09 拍板）：新增 `client/src/lib/manhuaCanvasLayout.ts` 统一排版。最左一竖条按资产类型上下堆三块——人物、服装道具组（服装并入道具）、场景，块内同类直排；往右依次是「静帧+导演版」「成片提示词」「出片」。多集可折叠，折叠的集只占一个节点高度。

之前画布乱是因为**三套排位互相覆盖**：铺板时一集排成一行（`canvasDramaStudio.ts:837` 起，多集往下叠行）、`packAssetSheetPositions` 把角色和场景各挤成一行、`layoutManhuaEpisodeReadableChain` 再按集重排一遍。而且前者只认角色和场景，**道具压根没进排位函数**，留在生成时的原始坐标上。现在 `packAssetSheetPositions` 已删，readableChain 因为还兼着盖 @资产 标签所以留着照跑，但坐标一律以 `layoutManhuaCanvasBlocks` 这最后一道为准。

拼接不需要新开发：`shared/manhuaFinalAssemble.ts:108-112` 检测到多段就按集号、再按段号排序接起来，四段拼成 120 秒，首段带静帧封面；传 `episodeIndexes` 可只拼指定集。

顺带修两条测试假绿/假红：`trendStore.splitGzip` 的 `rm` 与被测代码迟到的异步写撞车抛 `ENOTEMPTY`（加重试）；`canvasDramaStudio` 的静帧渐进 publish 顺序断言要求「第一个完成的必须是 s02」，但画布里还有不带段号的初始静帧节点，机器一忙 `setTimeout` 失准它就会插到最前（改为只比段级静帧的相对先后）。

未纳入本 PR（既有缺陷，非本次引入）：mini/2.5 异步任务缺跨请求跨实例幂等（POST 重试会重复扣费，`inflight` 只是进程内 Set）；`paidJobLedger` 退款先写 refunded 再调 `refundCredits`，两步之间崩溃会永久漏退。两条都要动计费，单独开刀。

**下一步（验链路② 起）**：② 平台「扩写」真跑 → 过确认编剧门禁 → 导演版；③ 关键帧排布；④ 画布 @ 锁定图/声/视频参考；⑤ 视频生成真跑验 provider。②–⑤ 都需登录态。

---

## 2026-08-14

**视频号本机采集韧性修复**：内容抽查由 20%/50%/80% 扩为 10%/30%/50%/70%/90% 五点；“约视频时长十分之一”统一增加 2 秒 OCR/窗口调度容差，服务端按视频时长重算上限，客户端不能抬高预算。采集器重启会按新口径救回旧隔离记录，每次心跳只串行补传一条；单条界面、评论、上传或搜索入口异常只延后当前动作，不再终止整晚采集。每 10 条检查一次达标率，低于 40% 立即从推荐流切搜索或轮换下一条七天热词；顶栏放大镜按实测动态窗口相对位置点击并由 OCR 复核输入框。评论 UI 噪音不进入分析，候选耗尽时优先复用最近七天的 AI/漫剧真实候选。未改模型、计费及正式批处理门槛。

**视频号搜索与 OCR 实链补强**：搜索词池改为轮完 Fly 上抖音/B站/小红书最近七天全部候选，不再只取每个类目前三条；本机最近 50 个已搜词沉底，心跳续租不再把扩展词池覆盖回单一旧任务，单词失败立即换下一词。搜索框兼容无占位文字、回车停在联想词和旧词清空失败三种微信状态，输入后必须 OCR 反向确认；纯短剧/漫剧作品继续拦截，制作教程可采。Swift 控制与 OCR 启动时串行预编译一次，五点截图再单次批量 OCR。真实验证：148 秒视频五点抽查 14.556 秒（预算 16.8 秒）；“AI拥抱自由，找准普通人搞钱方向”打开非短剧内容，10/206/10/10 判不达标且模型调用 0；“AI漫剧教程”打开制作教程，490/1121/235/249，抽 12 条评论，19.693 秒完成（226 秒视频预算 24.6 秒），Fly 正式累计 37→38。上传总超时覆盖到响应正文，未获 `persisted=true` 仍保留本机待传文件。

**部署后实跑**：推荐流首轮 30 条只命中 1 条（3.3%，未达到 40% 目标），该条 10 条评论、模型调用 0、正式累计 38→39；发现推荐流切搜索时首词输入确认失败会在十条后重试同词，已改为失败后索引立即前进到下一条七天新词。

**视频号小时吞吐修复（静态验收通过，待部署实跑）**：切换判定改用至少两项互动指标加标题/作者的稳定身份，不再用播放画面与字幕 OCR；稳定身份和 observationId 在任何拖动、评论、封面、上传前执行本机七天持久去重，监督器重启继续生效。视频时长前置为搜索卡片真实时长或播放器末端真实时钟，切到下一条后强制清空，禁止跨视频复用与估算。搜索词只收最近七天标题抽出的 2–12 字主题，每个词真实检查 10 条、低于 40% 才轮换，搜索标签状态跨重启保存且最多新增两个（连推荐页总计最多三个）。Fly 持久层新增首次写入时间和重复 ingest 小时事件，采集器按 `newlyQualifiedPersisted` 统计真实小时新增，并输出 15/30/60 分钟看门狗与完整失败漏斗；60 分钟少于 50 条自动停止。目标测试 51/51、TypeScript 和 Vite 生产构建均通过；真实 5/20/60 分钟链路仍须部署后验证，模型调用保持 0。

**#1213 部署后第一道实跑 + 封面选秀口径回修（第二 PR 待推）**：#1213 已合并并部署到 Fly v1843（映像 `sha-ca3e434e`）。首轮真实 5 条在方向键被播放器焦点吞掉后停机；实测相对滚轮 `-6` 可稳定切下一条，已替换方向键并继续以稳定身份断言。第二轮 5 条完成 1 条真实正式入库，Fly 44→45，`newlyQualifiedPersisted=true`、16 条真实评论、`modelCalls=0`、最近一小时重复 0、pending 0；VPN 下 seek 黑屏会先有界等待 650ms 再只截一张，进度条首拍失败也只允许移动到轨道后重拍一次。另查明“Terra High 封面选秀”原实现错误地让四个平台共抢全局 30 个候选、只输出全局 10 张；已改为每个所选平台各送 20 张真实封面给 Terra 排名，每平台 1–10 展示图/标题/作者/高 CTR 原因，11–20 只展示排名/标题/作者，模型漏项或伪造 ID 时由服务端按真实互动预排补齐。未运行付费 Terra；TypeScript、60 个目标测试、Vite 构建及两平台静态渲染（各 10 图 + 11–20 元数据）均通过，待第二 PR 部署后再续跑 20/60 分钟。

**视频号 P0 账号安全回修（待单 PR 部署）**：确认 #1213 的本机 v1 seen 在昂贵处理前落盘，导致“开始处理”被误当作“处理完成”，后续异常分支又滑走并由常驻监督器自动重启。v2 状态机只允许 Fly `persisted=true` 或明确本地不达标进入终态；旧 v1 seen 一律迁为 `retryable_failed`，启动前须从 Fly `persistedAt` 同步七天权威身份。时长、五点画面、评论、上传或播放器状态任一异常均原地停机且不滑走，常驻池取消无限自动重启；连续三条重复也停机，避免高速刷屏。严格 videoIdentity 只用于跨视频去重，seek 连续性改用至少两项互动指标的 3% 容差。五点截图本地按清晰度、曝光、信息量和加载黑屏惩罚选代表画面，镜像后带 `representative_frame` 与进度点进入现有每平台 20 个视觉候选；采集阶段模型调用仍为 0。当前 TypeScript、55 个目标测试、Vite 构建和 diff check 已通过；未部署、未做新版本真实抓取。

**视频号无人值守安全自愈补充**：#1217 部署后有界 1 条真实探针完成，Fly 身份同步 2 条，`scanned=1 / qualified=0`，未开评论区、无安全错误。为避免夜间异常依赖人工重启，采集失败后改为进程内自动守在原视频：已有 pending 只指数退避重传，完全不再操作微信；未生成 pending 时只被动截图，连续两张互动指标证明仍为同一视频后才重试完整采集，失败等待从 5 秒递增到最多 5 分钟。连续重复三条不再退出或继续滑，改为自动轮换七天搜索源。本机 LaunchAgent 与 Codex/GPT 解耦，旧启动脚本的无条件 `while true` 已删除，临时退出由 launchd 重启；网页关采集、小时低于 50 或有界探针不重启。启动器以 `caffeinate` 防自动休眠；**屏幕必须保持解锁且微信窗口可见，锁屏后 OCR 不可用**。

**视频号九项长期运行安全门禁（新口径覆盖上一段小时停机描述）**：正常达标视频仍固定拖动 10%/30%/50%/70%/90% 五点；四项互动指标必须由连续两张截图一致确认，漏掉评论数或单次 OCR 异常时不判定、不点击评论、不滑动。初始画面一旦出现“广告/廣告”立即本地无效；评论入口只接受右下评论槽位，真实评论只从右侧评论抽屉、标题下方和输入框上方提取，左侧视频字幕不能冒充评论。VPN 转圈/黑屏时只回到候选进度补拍一次，五点结果完成后评论或上传恢复复用缓存，不再重拖整套；完整五点最多两次，之后仅被动恢复。下一条切换同时检查标题/作者和互动指标容差，同一热视频的小幅自然增长不算切换成功。搜索只允许一个脚本搜索标签（加推荐页总计最多两个），辅助页关闭同步扣减状态，OCR 未确认输入框时禁止兜底坐标盲输。60 分钟低于 50 会结束该低效统计窗、输出漏斗、刷新七天候选并自动换源开启新窗，不再永久停到早上；网页关闭采集（包括恢复期间关闭）不会被 launchd 反复拉起。采集链模型调用保持 0；锁屏仍不可 OCR。

**头像禁区硬门禁**：视频号独立窗底部左侧头像/作者区（相对坐标 `x<=0.42 && y>=0.86`）由 Swift 控制层统一拒绝任何 click 与 drag 端点，所有上层调用都无法绕过；任一采集失败进入退避前，鼠标必须停到窗口左侧黑色安全边。禁止依赖 OCR 或调用方自觉来避免点头像。

## 2026-08-17

**视频号双窗启动校准修复（本地已实现，未部署）**：本机日志确认历史版本虽然能分别保存左右窗坐标，但正常子进程轮换使用的 `--reuse-search-calibration` 可能跨越网页停采/开采继续复用旧文件。校准文件现写入服务端 `controlRevision`；仅同一控制版本内的二十分钟轮换允许复用，网页每次暂停再开启后左右窗都会按屏幕位置逐一弹出十字校准。正式采集新增恰好两个不同 windowId 的覆盖门，任一窗未完成就不进入采集。暂停只停止继续操作微信；独立 raw worker 保持原行为，继续 OCR、去重、上传和入库暂停前已落盘的数据。目标测试 91/91 通过，`tsc --noEmit --incremental false` 通过，尚未重启本机采集器做真实双窗点击验收。

**漫剧批准模板 owner 查看与优化（本地已实现并静态验证，未部署）**：`/platform` 的「模板库（已批准 · 编剧室可选）」为 `OWNER_OPEN_ID` 本人增加完整模板查看抽屉、四模型选择、用户提示词、原稿/优化稿逐字段 Diff、高亮变更及原因；其他 admin/supervisor 与监管会话都不能读取完整库、原始 GCS 清单或优化修订。优化只在用户二次确认后调用一次模型并写 `proposals/`，不自动重试；批准修订会先把旧版写入 `archive/`，再以原 id/publicCode 替换 `approved/`，因此 `/canvas` 仍只消费匿名 `listApprovedPublic` 且公开句柄不变。DeepSeek V4 Pro 0813 固定 High、65536、JSON、`require_parameters=true`，不发送 temperature/top_p；原有分类清洗 Medium 未改。同步修复 `canvasVideoTask` 并发写同一任务时临时文件名碰撞的 rename 竞态，原失败用例连续复跑 10 次通过。`pnpm check`、`pnpm build`、49 项相关测试及全量 2059 项测试通过（7 项按配置跳过）。未执行真实模型调用、GCS 写入、登录态 UI 点击、部署或远程操作。

## 2026-08-25

**原生视频精读面板真值热修（本地已实现，待部署验收）**：线上已配置原生精读开关与 owner 身份，服务端 owner 能力查询返回允许；`/platform` 仍显示旧学习口径的直接原因是页面调用学习元数据时未传原生模式，且 owner 权限异常时会静默回落旧抽帧任务。现改为 owner 的抖音学习区展示原生精读说明、自由批次范围与计划预演按钮；原生候选在权限未确认、查询失败或 owner 不匹配时关闭式停止，只有明确非候选素材才允许走旧链。原生精读请求、入库 provenance、面板徽标与发车确认统一使用共享真值 `qwen3.8-max / Qwen 3.8 Max`，权限读取中不再短暂显示旧抽帧 Terra。历史结果按 `pipelineMode` 明示来源。相关 52 项测试、TypeScript 构建与 Vite 生产构建通过；全量测试 2724 项中 2718 通过、4 跳过，2 项照片镜像测试在全量并发中异常，隔离复跑 4/4 通过，与本刀无调用关系。未做本次前端线上验收，也未发起模型请求。

**原生精读真跑暴露的长请求与轮询抖动修复（本地验证，待旁路真跑）**：08:15 的正确合集任务展开 72 集后，第 1 集 0–539 秒段在约 143 秒被本地 `socket idle=120s` 提前切断，两个段均无结构并被入库门禁拒收；现把非流式请求空闲时限收口为 10 分钟，总时限仍为 30 分钟。面板跳动的相邻根因是任务轮询 callback 依赖整颗 tRPC query 对象，render 后 effect 会立即重启；同时每次无变化 GET 都写入新 Job 数组。现改为 ref 持有待审刷新函数、轮询 callback 只依赖稳定值，完全相同的 Job 快照复用旧引用。81 项目标测试、全量 2734 项、TypeScript、服务端构建、Vite 生产构建与 diff check 通过；尚未做 Fly 旁路真实模型调用，不能据此宣称线上链路已通。

**原生精读旧占位隔离与失败刷新复位（本地验证，待线上真跑）**：面板“学习 N 集”现先排除已入库卡与残留 claim，再选足 N 集；以现网 claim 1、2 为例，选择 10 集会形成 ep003–ep012，确认门只拒绝执行清单与 claim 真正重叠，逐集模型调用前的原子 claim 不变。失败详情仍在当前会话与服务端任务记录可查，但刷新不再自动恢复失败焦点、结果与续学来源；执行中同一 jobId 与成功待续状态仍恢复。目标 80 项、全量 2740 项、TypeScript、服务端构建、Vite 生产构建与 diff check 通过；未调用模型、未部署，仍须在 Fly/GCS 健康时由真实面板动作验收。

**新加坡套餐视频输入探针与生产切换（本地与真实探针已验，线上面板待验）**：Fly 内使用 `DASHSCOPE_SG_PLAN_KEY` 配新加坡 Token Plan 固定 OpenAI 端点，GCS 4 秒红→蓝视频实测返回 200 / stop（372/90 tokens）；用户给的抖音搜索页经 `modal_id` 归一与前置解析后，151 秒 CDN 直读再测返回 200 / stop（10,122/2,340 tokens），模型准确覆盖开头、中段、结尾。普通新加坡业务空间地址配套餐 key 实测 401 / 0 token。执行器现改为：完整单段 `≤1000s` 直接读 CDN，多段长片才 ffmpeg 切片暂存 GCS 并在 finally 删除，取消 OSS 中转；生产默认只认新加坡套餐，缺 key 关闭式停止，不回落北京或官方按量。分片按 `fps=2 × 2000帧 = 1000s` 的时间契约，不按受编码影响的文件大小；90MB 仅作传输门禁。历史 46 分钟成功案是 fps=0.5 粗读，18 分钟整片只做过解析判断，不能冒充当前精读整片实测。目标 84 项、全量 2743 项、TypeScript、服务端构建与 Vite 生产构建均通过；仍须部署后从真实面板动作验证任务、回执、待审卡与临时对象清理。

## 如何更新本文件

合完 PR 或用户改口径后，在**当日**下追加表格行；下一自然日新开 `## YYYY-MM-DD`。  
大方向变更同步改 `manhua-factory-brief.md` §2–3。

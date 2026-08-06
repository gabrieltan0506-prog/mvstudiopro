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

---

## 如何更新本文件

合完 PR 或用户改口径后，在**当日**下追加表格行；下一自然日新开 `## YYYY-MM-DD`。  
大方向变更同步改 `manhua-factory-brief.md` §2–3。

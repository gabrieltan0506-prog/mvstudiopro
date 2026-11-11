# 公开接口审计清单（2026-11-11，只读，未改代码）

范围：`server/routers.ts` 31 个 `publicProcedure`、`server/routers/*.ts` 与 `server/_core/systemRouter.ts` 里另外 23 个，以及 Express 挂载的 `api/*.ts` HTTP 入口和 `server/_core/index.ts` 里的直挂路由。
基线：`origin/main` aa8b125（行号以本分支为准；`api/google.ts`、`api/jobs.ts` 行号是本分支报错脱敏改动之后的）。

**全局事实**
- tRPC 没有全局限流：`server/rate-limit.ts` 里定义了 `generalApiLimit` / `authLimit` / `checkoutLimit`，但全仓只有 `stripe-webhook.ts` 用了 `webhookLimit`，其余都没挂。下表「限流」一列只记录接口自己做的限流。
- `publicProcedure = t.procedure`（`server/_core/trpc.ts:12`），不认人；部分接口在内部自己查 `ctx.user`，表里按实际行为记录。

列说明：**匿名** = 未登录能否调用；**花钱** = 是否调模型或其他付费上游（邮件 / 渲染 / 检索）；**写/签/读他人** = 是否写数据、签上传地址、读别人的数据。

---

## 一、匿名可花钱（高风险优先）

| # | 入口 | 匿名 | 花钱 | 写/签/读他人 | 限流 | 风险 | 建议 | 依据 |
|---|---|---|---|---|---|---|---|---|
| 1 | `GET/POST /api/google?op=geminiScript` | 能 | 是：Vertex Gemini 文本，**调用方能用 `b.model` 指定模型**（缺省 `gemini-3.1-pro-preview`），失败还会同请求换模型重试 | 否 | 无 | **高** | 加登录 + 服务端锁定模型 + 限流（canvas 调用方本来就要求登录） | `api/google.ts:942-1033` 无 viewer 检查；同文件 `nanoImage` 在 `:521` 有监管闸门，这里没有 |
| 2 | `mvAnalysis.getGrowthSnapshot`（query） | 能 | 是：`interactivePlatform` 缺省为 false 时跑个性化 LLM + 平台看板 LLM，两次调用都不扣费 | 否 | 无 | **高** | 加登录；LLM 段改为扣费或只给已付费用户 | `server/routers.ts:3790`；`:3897` 个性化 → `:2551 invokeLLM`；`:3975` → `buildPlatformDashboard :865` → `:1094 invokePlatformStructuredCopyLlm` |
| 3 | `mvAnalysis.getPlatformDashboard`（mutation） | 能 | 是：`buildPlatformDashboard` LLM，不扣费 | 否 | 无 | **高** | 加登录 + 扣费（同 Stage 2 正式路径） | `server/routers.ts:9375`、`:9382` 起；全段没有 `ctx.user` 判断 |
| 4 | `mvAnalysis.getPlatformContent`（mutation） | 能 | 是：`buildPlatformContent` LLM，不扣费（正式路径 `enqueuePlatformContentJob` 要登录且扣费） | 登录时写蓝图快照 | 无 | **高** | 加登录 + 扣费，或只留监管调试 | `server/routers.ts:11004`、`:11059`；正式路径在 `:9555` |
| 5 | `ambient.dashboardNews` / `ambient.hybridDashboard` | 能 | 是：Gemini + 联网检索（grounding 按次计费） | 否 | 只有缓存：按经纬度取 2 位小数做缓存键、30 分钟 TTL，**换坐标就能绕过缓存**，缓存 Map 不设上限 | 无 | **高** | 缓存键去掉坐标或粗化到城市级 + 按 IP 限流；或加登录 | `server/routers.ts:3142`、`:3153`；`server/services/hybridDashboardEngine.ts:514-516`、`:629`、`:58` |
| 6 | `customerService.sendMessage` | 能 | 是：`invokeLLM`，每次最多带 20 条历史 | 写进程内会话 Map（不设上限） | 无 | **高** | 按 IP/会话限流 + 会话数上限；或要求登录。另外系统提示词里写了 Suno V4、Kling、NBP 等模型名，模型可能原样复述给用户（前台泄漏） | `server/routers/customerService.ts:144`、`:170`；提示词在 `:100-110` |
| 7 | `mvAnalysis.downloadPlatformPdf` / `downloadAnalysisPdf` | 能 | 是：把任意 HTML（≥100 字）转发给 pdf-worker 用无头浏览器渲染（按时长计费）；HTML 里的外链资源由渲染端去取，有 SSRF 面 | 否 | 无 | **高** | 加登录 + 限流；pdf-worker 侧禁止外链或加白名单；报错别回 pdf-worker 原文 | `server/routers.ts:4279`、`:4315`（`token` 字段没有校验） |
| 8 | `POST /api/export`（storyboard-pdf / storyboard-docx / analysis-page-pdf） | 能 | 是：服务端生成文档；**`previewImageUrls` 用 axios 拉任意地址**（SSRF） | **匿名写存储**（storagePut），并回传地址；`isPaidUser` 由客户端传，可以去水印 | 无 | **高** | 加登录 + 限流；图片地址只收本站域名 / 本人对象；水印按服务端会员身份判断 | `api/export.ts:13-75`；`server/storyboard-export.ts:120`、`:329`、`:394`、`:639`；挂载点 `server/_core/index.ts:230` |
| 9 | `mvAnalysis.exportGrowthTrendsCsv`（mutation） | 能 | 是：用 Resend 发带附件的邮件，**收件人可以随便传** | **写磁盘**（导出 CSV）；把整库趋势数据发给任意邮箱；不传邮箱时回显内部报表邮箱 | 无 | **高** | 改成 adminProcedure | `server/routers.ts:11681-11718` |
| 10 | `/api/diag/providers`（GET） | 能 | 有网络开销：每次请求都对各上游做 GET 探活（不烧生成费） | 读：回传供应商与通道路由表、监管邮箱（打码） | 无 | 中 | 改成只给监管；同时消除前台的供应商名泄漏 | `server/_core/index.ts:972-1005`；`server/services/provider-diagnostics.ts:66` |
| 11 | `customerService.escalate` / `submitContactForm` | 能 | 发通知（notifyOwner） | 否 | 无 | 中 | 按 IP 限流；失败文案里有个人 gmail 地址，建议换成客服邮箱 | `server/routers/customerService.ts:219`、`:284`、`:320-328` |
| 12 | `inviteApply.submit` | 能 | 发 SMTP 邮件给管理员 | 否 | 无 | 中 | 限流；HTML 邮件里拼接用户输入时没有转义（`purpose` / `contact` / `name`），要先转义 | `server/routers/inviteApply.ts:9-40` |
| 13 | `education.inquiry` | 能 | 发邮件 | 否 | 有，但按「输入的邮箱」计数，换个邮箱就能绕过 | 低 | 改成按 IP 计数 | `server/routers/education.ts:14-24`、`:36` |
| 14 | `emailOtp.sendCode` | 能 | 发验证邮件 | 写进程内 OTP 表 | 有，但按邮箱计数，换邮箱可绕过 | 低 | 加按 IP 的总量限流 | `server/routers/emailOtp.ts:33`、`:64-100` |

## 二、匿名可写

| # | 入口 | 匿名 | 花钱 | 写/签/读他人 | 限流 | 风险 | 建议 | 依据 |
|---|---|---|---|---|---|---|---|---|
| 15 | `guestbook.submit` | 能 | 否 | 写库（姓名 / 邮箱 / 电话 / 公司 / 内容） | 无 | 中 | 限流 + 验证码 | `server/routers.ts:13152` |
| 16 | `mvReviews.submit` | 能 | 否 | 写库（昵称、评分、评论，任意 mvId） | 无 | 中 | 加登录或限流 | `server/routers.ts:3084` |
| 17 | `payment.handleStripeWebhook` | 能 | 否 | **不验签就能改交易状态**（completed / failed）。目前按 `userId=0` 查交易，实际命中不了，属于潜伏风险 | 无 | 中 | 删掉（正式 webhook 在 `server/stripe-webhook.ts`，验签且限流），或改成 adminProcedure | `server/routers/payment.ts:93-140`；`server/db-extended.ts:266-269` |
| 18 | `betaCode.generate` / `betaCode.listMine` | 能进入 | 否 | 鉴权前先执行 `ensureBetaTables`（建表 DDL）；实际生成要求监管 | — | 低 | 改成 protectedProcedure，DDL 放到鉴权之后 | `server/routers/betaCode.ts:83-110`、`:216-235` |

## 三、匿名可读他人数据

| # | 入口 | 匿名 | 花钱 | 写/签/读他人 | 限流 | 风险 | 建议 | 依据 |
|---|---|---|---|---|---|---|---|---|
| 19 | `guestbook.list` | 能 | 否 | **读他人隐私**：`select()` 全字段，包括邮箱、电话、公司、留言 | 无 | **高** | 改成 adminProcedure，或只回传 name / subject | `server/routers.ts:13177`；`server/db.ts:522-530`；表结构 `drizzle/schema.ts:46-55` |
| 20 | `customerService.getHistory` | 能 | 否 | 拿到 sessionId 就能读该会话全部聊天；sessionId 由客户端自定 | 无 | 中 | sessionId 改由服务端签发并绑定 cookie | `server/routers/customerService.ts:337` |
| 21 | `mvAnalysis.getGrowthSystemStatus` | 能 | 否 | 读内部运维信息：报表邮箱环境变量、SMTP 状态、抖音凭证健康、各平台 lastError、磁盘容量 | 无 | 中 | 改成 adminProcedure（同功能的 HTTP 版 `/api/getGrowthSystemStatus` 已经只放 admin / supervisor） | `server/routers.ts:11197-11430`；HTTP 版在 `server/_core/index.ts:1018` |
| 22 | `beta.leaderboard` | 能 | 否 | 回传邀请人 userId + 用户名 | 无 | 低 | 去掉 userId | `server/routers/beta.ts:470` |
| 23 | `showcase.getAll` / `showcase.getComments` | 能 | 否 | 回传作者 / 评论者用户名（展示用途，属预期） | 无 | 低 | 保持公开 | `server/routers/showcase.ts:23`、`:266` |
| 24 | `community.getComments` | 能 | 否 | 读进程内评论，带 userId | 无 | 低 | 保持公开（可去掉 userId） | `server/routers.ts:13606`；`server/db.ts:788` |
| 25 | `GET /api/jobs/:id`（`userId === "public"` 的任务） | 能 | 否 | 只读公开任务；其他任务做了归属校验 | 无 | 低 | 保持现状 | `server/_core/index.ts:899-930` |

## 四、交接疑点逐条核实

| 疑点 | 结论 | 依据 |
|---|---|---|
| 客服公开接口匿名调模型 | **属实**，见 #6 | `customerService.ts:144`、`:170` |
| PDF 匿名渲染 | **属实**，见 #7（另有 `/api/export` #8 同类问题） | `routers.ts:4279`、`:4315` |
| `/api/upload` 写公共前缀 | 部分属实：已经要求登录（`upload.ts:33`），但对象落在全站共用的 `uploads/<nanoid>.<ext>`，没有用户前缀，单文件上限 600MB；文件注释说前端已无调用方。风险**中低**，建议下线或改落 `uploads/u<uid>/` | `server/upload.ts:9-35`、`:77-92` |
| `analyzeVideo` | 要登录，素材只收本人前缀（`gcsUri` / `fileKey` / `fileUrl` 都校验了），但 **mutation 内不扣费**，登录后可以免费调分析模型。风险**中** | `server/routers.ts:3519-3580` |
| `analyzeGrowthCampImages` | 同上：要登录、校验本人前缀，**不扣费**（注释写着「积分在 Job 内扣除；此 mutation 仅供兼容/调试」），另外接受 `fileBase64` 内联。风险**中**，建议改成只给监管 | `server/routers.ts:3413-3465` |
| `synthesizeGrowthCampAnalyses` | 要登录，**不扣费**，直接调 LLM。风险**中**，建议同上 | `server/routers.ts:3467-3489` |
| `getVideoUploadSignedUrl` | 已收口：要登录，对象名由服务端生成（用户前缀 + UUID），大小上限签进链接。风险**低**，可保持 | `server/routers.ts:3491-3517` |
| `reapStaleNeonJobs` | 内部已校验 admin 或有效监管会话，匿名会被拒（FORBIDDEN）。风险**低**，建议改成 adminProcedure 统一口径 | `server/routers.ts:13341-13351` |
| `generateShareLink` | 纯计算（videoUrl 做 base64url 后截断）并回显，不读不写。**无**风险；分享 ID 可以反推出 videoUrl，属预期 | `server/routers.ts:13645-13656` |
| `getComments`（两处） | 只读、展示用途。**低**，见 #23、#24 | 同上 |

## 五、其余公开入口（风险低或无）

| 入口 | 匿名 | 花钱 | 写/读他人 | 风险 | 建议 | 依据 |
|---|---|---|---|---|---|---|
| `auth.me` / `auth.logout` | 能 | 否 | 只涉及本人 | 无 | 保持 | `routers.ts:3056-3057` |
| `system.health` | 能 | 否 | 否 | 无 | 保持 | `server/_core/systemRouter.ts:6` |
| `emailAuth.register` / `emailAuth.login` | 能 | 否 | 注册写库 | 中（登录没有失败次数限制，可以撞库） | 加按 IP + 账号的失败限流 | `server/routers/emailAuth.ts:24`、`:68` |
| `emailOtp.verifyAndLogin` | 能 | 否 | 否 | 低（每码最多试 5 次） | 保持 | `server/routers/emailOtp.ts:105`、`:129` |
| `mvReviews.list` / `mvReviews.stats` | 能 | 否 | 读公开评论 | 低 | 保持 | `routers.ts:3104`、`:3111` |
| `ambient.dashboardLive` | 能 | 天气 / 路况第三方接口（有响应缓存） | 否 | 低 | 加限流 | `routers.ts:3121`；`hybridDashboardEngine.ts:674-680` |
| `mvAnalysis.getPlatformSkillMasterInfo` | 能 | 否 | 静态常量 | 无 | 保持 | `routers.ts:6336` |
| `mvAnalysis.listPlatformOfficialCampaigns` | 能 | 否 | 读官方活动 | 无 | 保持 | `routers.ts:6342` |
| `mvAnalysis.getGrowthMonotonicStatus` / `getHotTopicsByWindow` | 能 | 否 | 读趋势汇总 | 低 | 保持（核心资产，可考虑加登录） | `routers.ts:11529`、`:11572` |
| `audioLab.status` / `veo.status` | 能 | 否 | 只回布尔值 | 无 | 保持 | `routers.ts:13386`、`:13677` |
| `manhuaAssetShare.listCommunity` | 能 | 否 | 读社区公开素材 | 低 | 保持 | `server/routers/manhuaAssetShare.ts:242` |
| `showcase.getActiveNotice` | 能 | 否 | 否 | 无 | 保持 | `server/routers/showcase.ts:330` |
| `payment.getPaymentPackages` / `stripe.getPlans` | 能 | 否 | 静态价目 | 无 | 保持 | `payment.ts:344`；`stripe.ts:29` |
| `/api/jobs?op=envStatus` | 能 | 否 | 回传各密钥「是否配置」的布尔值 | 低（暴露了供应商名） | 改成只给监管 | `api/jobs.ts:2453`；`server/vercel-api-core/env.ts:12` |
| `/api/jobs` 其余 op | 都要登录，部分只给监管或内部网关（`legacyJobsOpAccess` 表 + 各 op 自己判断） | — | — | 低 | 保持 | `api/jobs.ts:2423-2441`；`shared/internalMediaEndpointPolicy.ts` |
| `/api/google` 其余 op | `materialReadUrl` / `transcribeAudio` / 两个扫描 / 两个签名上传 / 三个看图 op 都要登录；`nanoImage`、`vertexTranslate`、`upscaleImage` 只给监管；Veo / Omni 统一回 410 | — | — | 低 | 保持 | `api/google.ts:478`、`:507`、`:521`、`:532`、`:584-673`、`:747`、`:771`、`:835`、`:887`、`:1035` |
| `/api/blob-put-image` | 要登录 | — | 写本人数据 | 低 | 保持 | `api/blob-put-image.ts:36-38` |
| `/api/kling-image` | 只给监管 | — | — | 低 | 保持 | `api/kling-image.ts:49-51` |
| `/api/canvas-media/*`、`/api/manhua-previs-media/*`、`/api/manhua-audio-media`、`/api/blog-media/:file` | 要登录（前三个另做归属校验） | 否 | — | 低 | 保持 | `server/_core/index.ts:567-695` |
| `/api/jobs/manhua-learn` 系列 | 要登录 + 监管 | — | — | 低 | 保持 | `server/_core/index.ts:696-898` |

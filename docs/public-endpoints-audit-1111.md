# 公开接口审计清单（2026-11-11）与收口结果

范围：`server/routers.ts` 31 个 `publicProcedure`、`server/routers/*.ts` 与 `server/_core/systemRouter.ts` 另 23 个、Express 挂载的 `api/*.ts` HTTP 入口、`server/_core/index.ts` 直挂路由。
基线：`origin/main` aa8b125。「依据」列行号为**收口前**位置；「处理结果」列行号为本分支收口后位置。

## 收口用的通用设施

- **用量闸门** `server/_core/usageLimits.ts`：每分钟限流 + 北京时间自然日上限（按用户 / IP / 会话等主体，任一超限即拒、被拒不占额度）+ 全站日总量；数值集中在 `USAGE_LIMITS`，可用 `USAGE_LIMIT_<NAME>_PER_MIN` / `_PER_DAY` / `_GLOBAL_PER_DAY` 覆盖（设 0 = 不限）。tRPC 侧用 `withUsageLimit(spec)` 中间件（`server/_core/trpc.ts`），HTTP 侧直接调 `consumeUsage`。
  **局限**：进程内存计数，多机时实际上限 ≈ 数值 × 机器数，重启清零；预留 `setUsageCounterStore` 换持久层。
- **自有资源白名单** `server/services/ownedResourceUrl.ts`：本站主机 + 自有 GCS / S3 桶 + 由令牌推出的自有 Blob 主机 + `OWNED_MEDIA_HOSTS`；只收 https 默认端口，IP 字面量 / localhost 一律拒。
- **PDF HTML 净化** `server/services/pdfHtmlSanitize.ts`：大小上限、删脚本 / 框架 / 外链、注入 CSP。
- **报错脱敏** `shared/upstreamErrorForClient.ts`（上一轮）。

| 闸门 | 每分钟 | 每日（每主体） | 全站日总量 | 主体 |
|---|---|---|---|---|
| geminiScript | 10 | 200 | 5000 | 用户 + IP |
| growthSnapshot | 4 | 60 | 3000 | 用户 + IP |
| platformDashboard | 3 | 40 | 2000 | 用户 + IP |
| platformContent | 3 | 30 | 1500 | 用户 + IP |
| ambientNews（新闻 / hybrid） | 6 | 120 | 2000 | 用户 + IP |
| ambientLive | 12 | 400 | — | 用户 + IP |
| customerServiceChat | 6 | 60 | 3000 | 用户 + IP + 会话 |
| contactNotify（转人工 / 联络表单 / 趋势导出） | 2 | 10 | 500 | 用户 + IP |
| pdfRender | 4 | 80 | 4000 | 用户 + IP |
| storyboardExport | 4 | 60 | 3000 | 用户 + IP |
| growthCampAnalyze | 3 | 30 | 1500 | 用户 + IP |
| serverUpload | 20 | 300 | — | 用户 + IP |
| guestbookSubmit（留言 / MV 评论） | 3 | 20 | 1000 | IP |
| visitorInquiry（邀请码申请 / 教育咨询） | 2 | 10 | 500 | IP |
| otpSend | 3 | 30 | 3000 | IP |
| accountRegister | 3 | 20 | — | IP |
| passwordLogin | 10 | 100 | — | IP 与邮箱各自 |

---

## 一、匿名可花钱

| # | 入口 | 原状（依据） | 风险 | 处理结果 |
|---|---|---|---|---|
| 1 | `/api/google?op=geminiScript` | 匿名可调，调用方可指定模型（含 Pro）（`api/google.ts:942-1033`） | 高 | **已堵**：须登录（取令牌与任何上游调用之前 401）+ geminiScript 闸门 + 提示词 >12 万字 413；模型改由 `geminiModelConfig` 新领域 `geminiScript` 解析（`GEMINI_SCRIPT_MODEL` → `VERTEX_GEMINI_MODEL` → 领域缺省 `gemini-3.1-pro-preview`，与原前端传入值一致），调用方 `model` 忽略。同文件其余 op 已核对：都要登录或只给监管，无调用方指定模型的问题。前台 `runGeminiScript` 不再传模型、超限不重试 |
| 2 | `mvAnalysis.getGrowthSnapshot` | 匿名可调，非交互模式跑两次 LLM，不扣费（`routers.ts:3790`） | 高 | **已堵**：须登录 + growthSnapshot 闸门（`routers.ts:3814`）。前台调用点 PlatformPage:4761、MVAnalysis:1832 都在登录页。**计价未定**（见报告） |
| 3 | `mvAnalysis.getPlatformDashboard` | 匿名调 LLM，不扣费（`routers.ts:9375`） | 高 | **已堵**：须登录 + platformDashboard 闸门（`routers.ts:9409`）；前台 PlatformPage:6606 在登录页。**计价未定** |
| 4 | `mvAnalysis.getPlatformContent` | 匿名调 LLM，不扣费（`routers.ts:11004`） | 高 | **已堵**：前台无调用点（正式路径 `enqueuePlatformContentJob` 要登录且扣费）→ 只给管理员 / 监管 + 闸门（`routers.ts:11040`） |
| 5 | `ambient.dashboardNews` / `hybridDashboard`（及 `dashboardLive`） | 匿名调带联网检索的模型；缓存键按两位小数坐标，可绕过（`routers.ts:3142`；`hybridDashboardEngine.ts:514`） | 高 | **已堵**：唯一前台调用点是成长营工作台 WorkAmbientPanel / GlobalMascotAssistant（MVAnalysis:3343，页面须登录）→ 须登录 + 闸门。坐标先量化到 0.5°（约城市级）再做缓存键并送模型；时区只收合法 IANA；新闻同键并发只打一次上游；缓存上限 500 条；`weatherCity` / `trafficLocation` 自由文本只给监管 |
| 6 | `customerService.sendMessage` | 匿名调模型、无限流（`customerService.ts:144`） | 高 | **已堵**：全仓前台无调用点（CustomerServiceChat 走 community 路由），没有匿名场景 → 须登录 + 闸门（用户 + IP + 会话）；消息 ≤1000 字；模型固定 `invokeLLM` flash 档、maxTokens 1024；会话绑定发起人；失败只回固定文案。系统提示词去掉 Nano Banana / NBP / Trellis / Forge / Kling / Omni Video / Suno，并加「不透露模型与供应商」规则 |
| 7 | `mvAnalysis.downloadPlatformPdf` / `downloadAnalysisPdf` | 匿名提交任意 HTML 给渲染端（SSRF）（`routers.ts:4279`、`:4315`） | 高 | **已堵**：须登录 + pdfRender 闸门；HTML 先净化（≤8MB，超限 PAYLOAD_TOO_LARGE，MyReportsPage 会自动改走异步队列；删脚本 / 框架 / 对象 / base / meta refresh / 导入类 link / on* / javascript:；外链只留白名单；注入 CSP）；渲染端失败只回固定文案。pdf-worker 本身未改 |
| 8 | `POST /api/export` | 匿名，服务端代取任意图片地址，写存储，客户端可去水印（`api/export.ts:13-75`） | 高 | **已堵**：须登录 + storyboardExport 闸门；图片只留白名单（站外的略过不代取，回 `skippedImages`），代取时再判一次、跳转逐跳复核、单图 ≤25MB；水印只按 `resolveWatermark`（付费 / 监管 / 已审核订单免水印，管理员免水印），客户端 `isPaidUser` 忽略；场次 / 图片 / 文本设上限；报错脱敏 |
| 9 | `mvAnalysis.exportGrowthTrendsCsv` | 匿名写盘、发到任意邮箱、回显内部邮箱（`routers.ts:11681`） | 高 | **已堵**：只给管理员 / 监管 + 闸门；收件人固定为当前管理员的登记邮箱（入参忽略，未登记则拒）；响应不带任何邮箱或服务器路径 |
| 10 | `/api/diag/providers` | 匿名触发上游探活，回传供应商 / 路由表（`index.ts:972`） | 中 | **已堵**：只给管理员 / 监管（index.ts 与未挂载的 app.ts 两处） |
| 11 | `customerService.escalate` / `submitContactForm` | 匿名发通知；失败文案含个人邮箱 | 中 | **已堵**：须登录 + contactNotify 闸门；失败文案改用 `SUPPORT_CONTACT_EMAIL`（support@mvstudiopro.com，与前台现有写法一致） |
| 12 | `inviteApply.submit` | 匿名发邮件，无限流，HTML 未转义 | 中 | **保留公开并加限制**：首页 HomeInviteApply（Home.tsx:55）是访客入口 → 按 IP 的 visitorInquiry 闸门；邮件 HTML 中用户输入已转义 |
| 13 | `education.inquiry` | 按「输入的邮箱」限流，可绕过 | 低 | **保留公开并加限制**：首页 HomeEducation（Home.tsx:42）访客入口 → 原有按邮箱限流保留，另加按 IP 的 visitorInquiry 闸门 |
| 14 | `emailOtp.sendCode` | 按邮箱限流，可换邮箱绕过 | 低 | **保留公开并加限制**：登录前入口，加按 IP 的 otpSend 闸门 |

## 二、匿名可写

| # | 入口 | 原状 | 风险 | 处理结果 |
|---|---|---|---|---|
| 15 | `guestbook.submit` | 匿名写库，无限流（`routers.ts:13152`） | 中 | **保留公开并加限制**（按指示）：按 IP 的 guestbookSubmit 闸门；字段长度上限保持不变（姓名 100、邮箱 320、电话 30、公司 200、主题 255、内容 5000）。注：组件 GuestbookSection 目前没有挂载到任何页面 |
| 16 | `mvReviews.submit` | 匿名写库，无限流（`routers.ts:3084`） | 中 | **保留公开并加限制**：按 IP 的 guestbookSubmit 闸门 |
| 17 | `payment.handleStripeWebhook` | 不验签可改交易状态（目前查询命中不了，属潜伏风险）（`payment.ts:93`） | 中 | **已堵**：只给管理员。正式 webhook 在 `server/stripe-webhook.ts`，已验签且限流；前台无调用点 |
| 18 | `betaCode.generate` / `listMine` | 鉴权前先执行建表 DDL | 低 | **已堵**：须登录，未登录不碰库 |
| — | `/api/upload`、`/api/upload-image` | 已要求登录，但写全站共用前缀（`upload.ts:90-92`） | 中低 | **已堵**：落本人前缀 `uploads/u<uid>/`、`idol-3d/u<uid>/`；四个直收入口加 serverUpload 闸门，超限时 429 且不读请求体；旧对象按 URL 照常可读 |

## 三、匿名可读他人数据

| # | 入口 | 原状 | 风险 | 处理结果 |
|---|---|---|---|---|
| 19 | `guestbook.list` | 匿名读全部留言人的邮箱 / 电话 / 公司（`routers.ts:13177`） | 高 | **已堵**：只给管理员 / 监管（`routers.ts:13227`） |
| 20 | `customerService.getHistory` | 拿到 sessionId 即可读别人的聊天 | 中 | **已堵**：须登录；会话绑定发起人，别人读到的是空记录 |
| 21 | `mvAnalysis.getGrowthSystemStatus` | 匿名读内部运维信息（`routers.ts:11197`） | 中 | **已堵**：须登录；非监管只回 `currentSupportActivities`（MVAnalysis 分析中的轮播用），报表邮箱 / SMTP / 凭证健康 / lastError / 磁盘只给监管（`routers.ts:11236`） |
| 22 | `beta.leaderboard` | 回传邀请人 userId + 用户名 | 低 | **未处理**：Invite 与 AdminBeta 页面拿 userId 做列表 key，改动要连同前台一起改；用户名本来就是排行榜要展示的内容。建议后续前台改用 rank 作 key，再对普通用户去掉 userId |
| 23 | `showcase.getAll` / `getComments` | 展示作者 / 评论者名字（预期行为） | 低 | 保持公开 |
| 24 | `community.getComments` | 进程内评论，带 userId | 低 | 保持公开 |
| 25 | `GET /api/jobs/:id`（userId=public） | 只读公开任务 | 低 | 保持现状 |

## 四、需登录但不扣费（会被白嫖）

| 入口 | 处理结果 |
|---|---|
| `analyzeVideo` / `analyzeGrowthCampImages` / `synthesizeGrowthCampAnalyses` | **加限制**：改为 protectedProcedure + growthCampAnalyze 闸门。三者里前台只调用 `synthesizeGrowthCampAnalyses`（MVAnalysis:1825）；仍不扣费，**是否计价、扣多少由站长定** |

## 五、其余公开入口（风险低或无，未改）

`auth.me` / `logout`、`system.health`、`emailOtp.verifyAndLogin`（每个验证码最多试 5 次）、`mvReviews.list` / `stats`、`getPlatformSkillMasterInfo`、`listPlatformOfficialCampaigns`、`getGrowthMonotonicStatus` / `getHotTopicsByWindow`（只读趋势汇总）、`audioLab.status` / `veo.status`、`manhuaAssetShare.listCommunity`、`showcase.getActiveNotice`、`payment.getPaymentPackages` / `stripe.getPlans`。

另外几项的处理：`emailAuth.register` / `login` 加了 IP / 邮箱闸门（中风险，**已堵**）；`/api/jobs?op=envStatus` 只给监管（**已堵**，前台只有监管调试面板调用）；`/api/jobs` 其余 op、`/api/google` 其余 op、`/api/blob-put-image`、`/api/kling-image`、各媒体代理路由、`/api/jobs/manhua-learn` 系列原本就有鉴权，未改。

## 六、未处理 / 遗留

- **异步 PDF 导出**（`queuePdfFromHtml` → pdf_export 任务）：要求登录，HTML 快照放在本人前缀下，但渲染前**没有**经过本轮的 HTML 净化。按指示 pdf-worker 链「非必要不动」，所以没改。建议在入队或任务里复用 `sanitizePdfHtml`。
- **计价**：getGrowthSnapshot（非交互模式两次 LLM）、getPlatformDashboard、三个成长营同步分析入口目前都只有闸门、不扣费，等站长定价。
- **多机部署**：闸门是单进程内存计数，扩到多机前要换持久层。

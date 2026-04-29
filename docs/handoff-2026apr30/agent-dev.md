# Agent Dev — 企业私有化智能体（AaaS）实施交接

**任务来源**: 用户产品决策（2026-04-30）
**目标**: 在 mvstudiopro 上线「企业专属智能体定制」高客单 SaaS 服务
**实施 agent**: 新 Cursor 窗口（独立会话），父 agent 留作 reviewer
**预估工时**: 4-6 天（拆 6 个 PR）

---

## 一、商业策略（用户调整后版本）

用户原始白皮书提议初装 ¥50K-200K，**用户调整为引入「试用版」¥15K** 作为低门槛验证 MVP，避免企业客户一上来就被高价吓跑。

### 三层金字塔定价

| 档位 | 价格 | 内容 | 周期 |
|------|------|------|------|
| **Trial 试用版** | **¥15,000** | 1 个 Agent / 知识库 ≤ 50 MB / 共享算力通道 / 仅基础部署 | **30 天** |
| **Pro 正式版** | ¥50,000 - ¥200,000 | 多 Agent / 知识库无上限 / 专属隔离 GCS bucket / 包定制爬虫 / 内部系统接入 | **永久使用** |
| **Retainer 战略伴跑年费** | 初装费的 20% / 年 | 算法迭代 / Prompt 微调 / 专属算力承诺 / 季度复盘 | **逐年续约** |

### 升级路径设计

- 试用版客户**满意时无缝升级 Pro**：
  - 试用版的 systemCommand + 知识库**保留**，不重新上传
  - 试用费 ¥15K **可抵扣** Pro 部署费的 50%（相当于折扣券）
  - 技术上：试用版数据库 schema 跟 Pro 完全一致，只是多个 `tier: "trial" | "pro"` 字段控制限额
- 试用版**到期未升级**：
  - Agent 自动停用（status='expired'）
  - 知识库保留 90 天后软删除
  - 通过邮件提示用户决策

### 商业话术调整

避免用户原稿"黑金感"过重（"指挥 Claude Code"、"頂級工廠"、"兵工廠"等过于霸道）。
重新定位:

> 「企业专属智能体 — 把您的销冠 SOP、客诉手册、战败分析喂给一个永远在线的战略大脑，30 天试用 ¥15,000，不满意不升级。」

务实、可量化、低门槛。**不要堆砌"絕對護城河"、"頂級工廠"、"量產數字大腦"**。

---

## 二、技术架构（融入现有系统，不要孤立写）

用户原始代码用 `new aiClient.generateContent(...)` 是孤立写法，**禁止照搬**。本项目所有 Gemini 调用走**已有的 fetch HTTP API key 模式**（不依赖 SDK），所有付费走 paidJobLedger，所有文件走 GCS。

### 必须复用的现有组件

| 复用点 | 现有文件 | 用途 |
|--------|---------|------|
| Gemini 客户端 | `server/services/deepResearchService.ts` line 220+ `generateContent` 直连 API key 模式 | 智能体推演调用 |
| GCS 上传 | 仓库内 `storagePut(...)` 在多处使用（`server/routers/nanoBanana.ts`、`deepResearchService.ts`、`server/upload.ts`）| 知识库文档存储 |
| PDF 解析 | `server/growth/analyzeDocument.ts` | 知识库文档抽取文本 |
| 付费任务 | `server/services/paidJobLedger.ts` `holdCredits` / `refundCredits` / `appendAuditEntry` | ¥15K 试用 + ¥50K 正式都是付费任务 |
| 维护模式闸门 | `server/services/maintenanceMode.ts` `assertMaintenanceOff()` | 部署期间禁新订单 |
| 用户作品库 | `userCreations` 表 (`drizzle/schema-creations.ts`) | 智能体调用记录用 `type: 'enterprise_agent_session'` 写这里 |

### 新增组件清单

```
新增文件:
├── drizzle/schema-enterprise-agents.ts        ← 表结构（迁移）
├── server/routers/enterpriseAgents.ts         ← tRPC mutations / queries
├── server/services/enterpriseAgentService.ts  ← 核心业务逻辑（部署 / 调用 / 限额）
├── server/services/knowledgeBaseParser.ts     ← PDF/TXT 抽取 + 切分
├── client/src/pages/EnterpriseAgentManager.tsx     ← 企业管理后台（用户原稿改造）
├── client/src/pages/EnterpriseAgentPlayground.tsx  ← 客户跑推演的 UI
└── client/src/components/HomeEnterpriseAgentCard.tsx  ← 首页产品卡片
```

### Drizzle Schema 草图

`drizzle/schema-enterprise-agents.ts`：

```ts
export const enterpriseAgents = pgTable("enterprise_agents", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),  // 企业账号（管理员）
  organizationName: varchar("organization_name", { length: 200 }),
  agentName: varchar("agent_name", { length: 100 }).notNull(),
  systemCommand: text("system_command").notNull(),  // 灵魂指令
  tier: varchar("tier", { length: 20 }).notNull(),  // 'trial' | 'pro'
  status: varchar("status", { length: 20 }).notNull().default("active"),  // active|expired|deleted
  trialUntil: timestamp("trial_until"),  // 仅 trial：到期日
  knowledgeBaseQuotaMb: integer("kb_quota_mb").notNull().default(50),
  knowledgeBaseUsedMb: integer("kb_used_mb").notNull().default(0),
  callsThisMonth: integer("calls_this_month").notNull().default(0),
  callsQuotaMonthly: integer("calls_quota_monthly").notNull().default(100),
  paidJobLedgerEntryId: integer("paid_job_id"),  // 关联 paidJobLedger
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const enterpriseAgentKnowledgeBase = pgTable("enterprise_agent_kb", {
  id: serial("id").primaryKey(),
  agentId: integer("agent_id").notNull(),
  filename: varchar("filename", { length: 300 }).notNull(),
  gcsKey: varchar("gcs_key", { length: 500 }).notNull(),  // GCS 路径
  fileSizeBytes: integer("file_size_bytes").notNull(),
  contentTextHash: varchar("content_hash", { length: 64 }),  // SHA-256，避免重复
  extractedTextPreview: text("extracted_text_preview"),  // 头 500 字预览（admin 验证用）
  uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
});

export const enterpriseAgentSessions = pgTable("enterprise_agent_sessions", {
  id: serial("id").primaryKey(),
  agentId: integer("agent_id").notNull(),
  userQuery: text("user_query").notNull(),
  responseMarkdown: text("response_markdown"),
  promptTokens: integer("prompt_tokens"),
  outputTokens: integer("output_tokens"),
  modelUsed: varchar("model_used", { length: 60 }),  // gemini-3.1-pro
  durationMs: integer("duration_ms"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

### 推演调用核心逻辑

`server/services/enterpriseAgentService.ts` 关键函数（伪代码）：

```ts
export async function executeAgentQuery(params: {
  agentId: number;
  userQuery: string;
}): Promise<{ markdown: string; tokensUsed: number }> {
  const agent = await getAgentById(params.agentId);

  if (agent.status !== "active") throw new Error("Agent expired or disabled");
  if (agent.trialUntil && agent.trialUntil < new Date()) {
    await markAgentExpired(agent.id);
    throw new Error("Trial expired, please upgrade");
  }
  if (agent.callsThisMonth >= agent.callsQuotaMonthly) {
    throw new Error("Monthly quota exhausted");
  }

  const knowledgeChunks = await loadAndConcatKnowledgeBase(agent.id);  // 拼成 contextData 字符串

  const apiKey = process.env.GEMINI_API_KEY!;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro:generateContent?key=${apiKey}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{
          text: `[智能体灵魂]:\n${agent.systemCommand}\n\n[企业私有知识库]:\n${knowledgeChunks}\n\n严格基于上述知识与灵魂执行推演，80% 篇幅聚焦高客单转化路径。`
        }]
      },
      contents: [{ role: "user", parts: [{ text: params.userQuery }] }],
      generationConfig: { temperature: 0.7, topP: 0.95, topK: 40, maxOutputTokens: 8192 },
    }),
  });
  const json = await resp.json();
  const markdown = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  const tokensUsed = json?.usageMetadata?.totalTokenCount ?? 0;

  await db.insert(enterpriseAgentSessions).values({
    agentId: agent.id,
    userQuery: params.userQuery,
    responseMarkdown: markdown,
    outputTokens: json?.usageMetadata?.candidatesTokenCount,
    promptTokens: json?.usageMetadata?.promptTokenCount,
    modelUsed: "gemini-3.1-pro",
  });
  await db.update(enterpriseAgents).set({
    callsThisMonth: agent.callsThisMonth + 1,
  }).where(eq(enterpriseAgents.id, agent.id));

  return { markdown, tokensUsed };
}
```

### 知识库解析约束

- 单文件 ≤ 5 MB（Gemini 上下文虽然 1M+，但 prompt 注入 15-20 万字最实用）
- 试用版总和 ≤ 50 MB / Pro 无上限
- 用 `pdf-parse` 抽 PDF 文本，TXT 直接读
- 解析后**不重新加密存**（GCS 默认 AES-256 加密足够）
- 切分策略：每段 ~2000 token，按段落 / heading 边界切，避免句中切断
- 拼 contextData 时按文件名 + chunk index 加 marker，便于 LLM 引用

### 安全 / 合规

- **不承诺「绝对零保留」**（不现实）。承诺 **「企业隔离存储 + 用户主动一键删除」**
- GCS bucket 按 `userId` 前缀隔离：`gs://mvstudio-enterprise/${userId}/agents/${agentId}/...`
- 每次 LLM 调用写 audit log（写 `enterpriseAgentSessions`）
- Admin 后台提供 **"导出全部数据"** 按钮（GDPR-friendly）
- **不要**对文档做客户端加密（增加复杂度，GCS 已加密）

---

## 三、UI 设计调整

用户原稿 `bg-[#0c061e]` 黑底 + `#B8860B` 黑金风**跟现有首页 spring-mint（薄荷绿 + 樱桃粉）严重冲突**，不能照搬。

### 首页产品卡片调整

`client/src/components/HomeEnterpriseAgentCard.tsx` 用「商务白底 + 香槟金边 + 海军蓝字」（参考 `business-bright` 主题）：

```tsx
<div className="rounded-2xl bg-white border-2 border-[#C9A858]/40 p-6 md:p-8 shadow-xl">
  <div className="flex items-center gap-2 mb-3">
    <span className="px-2 py-0.5 bg-[#1F3A5F] text-[#C9A858] text-[10px] font-bold rounded uppercase tracking-widest">
      Enterprise · 企業專屬
    </span>
    <span className="px-2 py-0.5 bg-[#FB7185]/10 text-[#FB7185] text-[10px] font-bold rounded">
      ¥15,000 起 · 30 天试用
    </span>
  </div>
  <h3 className="text-2xl md:text-3xl font-black text-[#0F1B2D] mb-2">
    企业专属智能体定制
  </h3>
  <p className="text-sm md:text-base text-[#55657A] leading-relaxed mb-5">
    把您的销冠 SOP、客诉手册、战败分析喂给一个永远在线的战略大脑。
    30 天 ¥15,000 试用，不满意不升级正式版。
  </p>
  <ul className="space-y-2 mb-6 text-sm text-[#0F1B2D]">
    <li>✓ 私有化知识库 (PDF / TXT 上传，企业隔离存储)</li>
    <li>✓ Gemini 3.1 Pro 顶配算力推演</li>
    <li>✓ 30 天 / 100 次调用 / 50 MB 知识库</li>
    <li>✓ 满意可抵扣 50% Pro 部署费</li>
  </ul>
  <Button className="w-full bg-gradient-to-r from-[#1F3A5F] to-[#2D4A6F] text-[#C9A858] font-black text-base py-6 rounded-xl">
    开始 30 天试用 →
  </Button>
</div>
```

### 管理后台 (EnterpriseAgentManager.tsx)

可保留用户原稿的"黑金感"作为 admin 后台**内部页面**风格（不在首页见客）。但要：

- 替换硬编码 `#0c061e` / `#B8860B` 改用 Tailwind className 便于响应式
- 表单字段加 react-hook-form 校验（systemCommand ≥ 50 字、agentName 唯一）
- 上传组件用 `react-dropzone` 拖拽 + 文件大小校验
- 提交按钮关联 tRPC `enterpriseAgents.deploy` mutation 而不是 raw fetch

---

## 四、PR 拆解（6 个独立 PR）

| PR | 范围 | 工时 |
|----|------|------|
| **A** | drizzle schema + migration（不上线，dev only）| 0.5 天 |
| **B** | 后端 service + tRPC router（含 executeAgentQuery 逻辑）| 1.5 天 |
| **C** | 知识库上传 + 解析（multer / pdf-parse / GCS）| 1 天 |
| **D** | 客户管理后台 EnterpriseAgentManager UI | 1 天 |
| **E** | 客户 Playground 页面（聊天框 + 历史 sessions）| 1 天 |
| **F** | 首页产品卡片 + Pricing 页加企业方案 + 营销文案 | 0.5 天 |

每个 PR 独立 typecheck + 父 agent review + 合并。F 是最末端门面，A 是最底层基础。

---

## 五、新 agent 必读现有代码（30 秒）

按顺序读：

1. **`docs/handoff-2026apr30/handsoffproject.md`** — 项目 30 秒上手 + 工作流硬约束
2. **`docs/handoff-2026apr30/errors.md`** — 23 条踩坑教训（特别是 stacked PR / worktree / inline style 这些）
3. **`server/services/deepResearchService.ts`** line 200-280 — Gemini API 调用模式（直连 fetch，不用 SDK）
4. **`server/services/paidJobLedger.ts`** — 整个文件，理解 `holdCredits` / `refundCredits` / `appendAuditEntry`
5. **`server/services/maintenanceMode.ts`** — 整个文件（短），理解 `assertMaintenanceOff()`
6. **`server/growth/analyzeDocument.ts`** — PDF 解析参考实现
7. **`server/upload.ts`** — GCS 上传管线参考
8. **`drizzle/schema-creations.ts`** — Schema 写法参考（`userCreations` 是同模式）
9. **`server/routers/creations.ts`**（如果 PR #332 已合）或 `server/routers.ts` 的 deepResearch 部分 — tRPC mutation 写法参考
10. **`client/src/pages/Pricing.tsx`** — 现有 Pricing 卡片样式（要在这页加企业方案 tier）
11. **`client/src/pages/HomePage.tsx`** — 现有首页结构（要加 HomeEnterpriseAgentCard）

不要超出这 11 个文件的 deep read。其他文件按需 grep。

---

## 六、跟现有功能集成点

1. **paidJobLedger 必关联**：`enterpriseAgents.deploy` mutation 必须在事务里调 `holdCredits` 锁定 ¥15K 试用费 / ¥50K-200K 正式费。失败要 `refundCredits`。**不要**自己写新的扣费逻辑。
2. **maintenanceMode 必接**：`enterpriseAgents.deploy` 入口必调 `assertMaintenanceOff()` 拦截维护模式。
3. **userCreations 沿用**：每次 Agent 调用结果（markdown response）写 `userCreations`（type='enterprise_agent_session'）让客户在「我的作品」里能看到。
4. **关键**：试用版 ¥15K **同样走 paidJobLedger**——不要因为是「试用」就跳过付费流。这样退款 / 审计 / 维护模式拦截全部沿用。

---

## 七、风险点 / 边界

### 红线（绝对不要做）

- **不要部署**（用户决定）
- **不要碰** `paidJobLedger.ts` / `maintenanceMode.ts` / `pdfTemplate.ts` 主题色
- **不要在主 worktree 工作** — 用 `git worktree add /tmp/mvs-enterprise-agent -b feat/enterprise-agent origin/main`
- **不要照搬用户原稿代码** — 用 `new aiClient.generateContent` 是错的，必须改成项目现有 fetch 模式
- **不要承诺「绝对零保留」** — 改成「隔离存储 + 一键删除」

### 黄线（要审慎）

- 添加 npm 依赖（`pdf-parse` / `multer` / `react-dropzone` 等）— 加之前**先问用户**
- Drizzle migration 是 destructive（生产已有数据）— migration SQL 必须用户审过才能合
- ¥15K 试用费如果用户改主意改价格，记得 commit 里抽出 const 常量便于以后改
- 知识库 50 MB 限额 — 配置成 env var (`ENTERPRISE_TRIAL_KB_MB=50`) 便于以后调

### 绿线（鼓励）

- 用 react-hook-form + zod 做表单校验（项目其他地方已用）
- 上传 UI 用现有 shadcn 组件（Dialog / Sheet）保持视觉一致
- 中文 commit + PR description

---

## 八、新 agent 开场白（用户复制粘贴用）

```
我要你接手 mvstudiopro 的「企业专属智能体（AaaS）」实施。

第一步：
cd /Users/tangenjie/.codex/worktrees/974b/mvstudiopro
git fetch origin && git checkout main && git pull origin main

第二步：完整读 docs/handoff-2026apr30/agent-dev.md，并连带读：
- handsoffproject.md（项目上手 + 边界）
- errors.md（23 条踩坑）

第三步：回我「已读完，理解执行流程」并简述：
- 你打算第一个 PR 做哪部分（建议从 PR A: drizzle schema 开始）
- 你计划在哪个 worktree 工作
- 你预估这个 PR 工时

我（用户）拍板放行后再开工。

工作流硬约束：
1. 必须用 git worktree add /tmp/mvs-enterprise-agent 独立工作
2. 6 个 PR 按 A→B→C→D→E→F 顺序，每个独立提交
3. 推 PR 前必跑 npm run check 0 错
4. 推完 PR 把 PR 号告诉我，我让父 agent (另一个 Cursor 窗口) 审 diff，pass 才允许合并 + 部署
5. 中文 commit / 中文 PR
6. 绝不部署 / 绝不 force push / 绝不碰 paidJobLedger 与 maintenanceMode

关键调整 vs 用户原稿：
- 试用版 ¥15K（不是 ¥50K-200K）
- 用项目现有 fetch + paidJobLedger 模式（不是 raw new aiClient）
- 首页卡片改商务白底 + 香槟金边（不是黑金风，跟 spring-mint 主题冲突）
- 不承诺「绝对零保留」，承诺「隔离存储 + 一键删除」

你的目标：4-6 天内交付 6 个 PR，每个 PR 独立可上线。
```

---

## 九、超时不可达成的话

如果新 agent 卡在某个 PR 超过 1 天（例如 PR B 后端逻辑），可以：

1. 缩减 scope：MVP 第一版**不做** RAG 切分，直接把所有知识库文档拼接成一个巨长 contextData（Gemini 1M 上下文够用，50 MB 文本完全装得下）
2. 缩减 scope：MVP 第一版**不做** 客户端 Playground 独立页面，复用 `GodViewPage.tsx` 的输入框 + 输出渲染流（"伪装成"一个新的 deepResearch productType）

但**红线不能缩**：付费走 paidJobLedger / 知识库存 GCS / 维护模式闸门一个不能少。

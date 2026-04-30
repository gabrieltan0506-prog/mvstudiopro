/**
 * 企业专属智能体（AaaS）— 后端核心服务
 *
 * 范围：本文件**只**含「数据库 + Gemini 调用 + paidJobLedger 集成」业务逻辑。
 *      tRPC router / 知识库上传 / UI 全部不在本文件范围（见 PR-3 / PR-4 / PR-5 / PR-6）。
 *
 * ── 商业规则（与 docs/handoff-2026apr30/agent-dev.md 对齐）──────────────────
 *  - Trial: ¥15,000 / 30 天 / 100 次调用 / 50 MB 知识库
 *  - Pro:   ¥50,000-200,000 / 永久使用 / 配额放大
 *  - 试用费 / 部署费走线下付款（Stripe / 对公转账），积分体系 (user.credits)
 *    不参与扣费。但仍**经由 paidJobLedger 注册 hold**，让维护模式 / SIGTERM
 *    reaper / 部署闸门能感知到这是个活跃付费任务。
 *
 * ── 跟现有体系的集成点 ──────────────────────────────────────────────────────
 *  - paidJobLedger.registerActiveJob(...) — 创建 agent 时锁定 hold
 *      jobId 格式：`enterpriseAgent_${agentId}_trial_${ts}`
 *      creditsBilled: 0 （admin 模式：refundCreditsOnFailure 不会调 refundCredits）
 *      action: "企业Agent试用部署·¥15,000/30天" — 出现在 audit log
 *  - paidJobLedger.refundCreditsOnFailure(..., "user_cancelled_no_refund", ...)
 *      —— 试用过期 / 主动 expireAgent 时把 hold 标 settled（不退款，跟现有
 *      用户主动取消语义一致）
 *  - assertMaintenanceOff(...) — createAgent 必须先调，部署期间禁止新部署
 *
 * ── PR-2 范围 ─────────────────────────────────────────────────────────────
 *  ✅ createAgent / executeAgentQuery / expireAgent / softDeleteAgent
 *  ✅ 纯逻辑工具：周期重置 / agent 状态校验 / systemInstruction 拼装 / Gemini 响应解析
 *  ❌ tRPC router 暴露（PR-3）
 *  ❌ 知识库上传 + pdf-parse + GCS（PR-3）
 *  ❌ 任何 UI（PR-4 / PR-5 / PR-6）
 *
 * ── PR-2 知识库占位说明 ─────────────────────────────────────────────────────
 *  本 PR 调 executeAgentQuery 时**会**查 enterprise_agent_kb 表，把已有条目的
 *  `extractedTextPreview`（500 字预览）拼进 systemInstruction。但 PR-3 完成
 *  之前 kb 表本来就为空 → 实际效果是「systemInstruction 仅含 systemCommand」，
 *  跟没有知识库的 agent 一样能跑通调用链路。PR-3 会扩 schema 加完整 chunk 字段
 *  并把这里的 preview 替换成完整文本。
 */

import { and, asc, eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import {
  enterpriseAgentKnowledgeBase,
  enterpriseAgentSessions,
  enterpriseAgents,
  type EnterpriseAgent,
} from "../../drizzle/schema";

// ─── 业务常量 ──────────────────────────────────────────────────────────────

/** paidJobLedger.taskType — Trial 部署 + Trial 期间所有调用都用同一 taskType */
export const ENTERPRISE_AGENT_TASK_TYPE = "enterpriseAgentTrial" as const;

/** 试用配额：30 天 / 100 次调用 / 50 MB 知识库 */
export const TRIAL_DURATION_DAYS = 30;
export const TRIAL_CALLS_QUOTA = 100;
export const TRIAL_KB_QUOTA_MB = 50;

/** 配额周期天数（Trial 一次性 30 天即过期；Pro 复用同字段做月度循环重置） */
export const QUOTA_PERIOD_DAYS = 30;

/** 试用费名义价（仅用于 audit log 文案，**不**进 user.credits 扣费链路） */
export const TRIAL_PRICE_CNY = 15_000;

/** Gemini 模型（与 routers.ts 主编 AI 助手 / 竞品调研保持一致） */
export const ENTERPRISE_AGENT_GEMINI_MODEL = "gemini-3-pro-preview";

/** 调用 Gemini 时的 fetch 超时（毫秒），与 routers.ts AI 助手保持一致 */
const GEMINI_FETCH_TIMEOUT_MS = 120_000;

// ─── 错误码（router 层会把这些映射成 TRPCError） ────────────────────────────

export class EnterpriseAgentError extends Error {
  constructor(
    public readonly code:
      | "AGENT_NOT_FOUND"
      | "AGENT_NOT_ACTIVE"
      | "TRIAL_EXPIRED"
      | "QUOTA_EXHAUSTED"
      | "DATABASE_UNAVAILABLE"
      | "MISSING_GEMINI_API_KEY"
      | "GEMINI_API_ERROR"
      | "GEMINI_EMPTY_RESPONSE",
    message: string,
    public readonly meta?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "EnterpriseAgentError";
  }
}

// ============================================================================
// 纯逻辑工具（无副作用，便于单元测试）
// ============================================================================

/** 生成 paidJobLedger jobId — 格式与文档约定一致：enterpriseAgent_${id}_trial_${ts} */
export function formatTrialJobId(agentId: number, ts: number = Date.now()): string {
  return `enterpriseAgent_${agentId}_trial_${ts}`;
}

/** Trial 试用到期时间 = 创建时间 + 30 天 */
export function computeTrialUntil(createdAt: Date): Date {
  return new Date(createdAt.getTime() + TRIAL_DURATION_DAYS * 24 * 3_600_000);
}

/** 是否到达配额周期重置点（now > periodStart + QUOTA_PERIOD_DAYS） */
export function shouldResetQuota(
  now: Date,
  quotaPeriodStart: Date,
  periodDays: number = QUOTA_PERIOD_DAYS,
): boolean {
  const elapsedMs = now.getTime() - quotaPeriodStart.getTime();
  return elapsedMs > periodDays * 24 * 3_600_000;
}

/** Trial agent 是否已过 trialUntil */
export function isAgentTrialExpired(agent: Pick<EnterpriseAgent, "tier" | "trialUntil">, now: Date): boolean {
  if (agent.tier !== "trial") return false;
  if (!agent.trialUntil) return false;
  return now.getTime() > agent.trialUntil.getTime();
}

/**
 * 执行调用前的状态闸门 — 顺序与 docs/handoff-2026apr30/errors.md 第 22 条一致：
 *   1. status === 'active'（保护已 expired / deleted 的 agent）
 *   2. trialUntil 校验（trial 才看）
 *   3. 配额校验（最后一道，避免 trial 过期还误报"配额耗尽"）
 *
 * @returns null = 通过；EnterpriseAgentError = 该错误抛给 caller
 */
export function assertAgentExecutable(
  agent: Pick<EnterpriseAgent, "status" | "tier" | "trialUntil" | "callsThisPeriod" | "callsQuotaPeriod">,
  now: Date,
): EnterpriseAgentError | null {
  if (agent.status !== "active") {
    return new EnterpriseAgentError(
      "AGENT_NOT_ACTIVE",
      `Agent 当前状态为 ${agent.status}，无法调用`,
      { status: agent.status },
    );
  }
  if (isAgentTrialExpired(agent, now)) {
    return new EnterpriseAgentError(
      "TRIAL_EXPIRED",
      "试用版已到期，请升级正式版后继续使用",
      { trialUntil: agent.trialUntil?.toISOString() },
    );
  }
  if (agent.callsThisPeriod >= agent.callsQuotaPeriod) {
    return new EnterpriseAgentError(
      "QUOTA_EXHAUSTED",
      `当前周期调用次数已达上限（${agent.callsQuotaPeriod} 次），请升级或等待周期重置`,
      { callsThisPeriod: agent.callsThisPeriod, callsQuotaPeriod: agent.callsQuotaPeriod },
    );
  }
  return null;
}

/** 把多份知识库片段拼成一段 contextData，按文件名加 marker 便于 LLM 引用。 */
export function composeKnowledgeContext(
  chunks: ReadonlyArray<{ filename: string; text: string | null | undefined }>,
): string {
  if (!chunks.length) return "";
  const usable = chunks.filter((c) => c.text && c.text.trim().length > 0);
  if (!usable.length) return "";
  return usable
    .map((c, i) => `── 文档 ${i + 1}：${c.filename} ──\n${c.text!.trim()}`)
    .join("\n\n");
}

/**
 * 拼装 Gemini systemInstruction —— 把灵魂指令 + 知识库 + 推演执行约束三段串起来。
 * 知识库为空时只输出灵魂指令 + 执行约束（PR-3 接进来知识库后自然完整）。
 */
export function buildSystemInstruction(systemCommand: string, knowledgeContext: string): string {
  const head = `[智能体灵魂]\n${systemCommand.trim()}`;
  const knowledge = knowledgeContext.trim()
    ? `\n\n[企业私有知识库]\n${knowledgeContext.trim()}`
    : "";
  const tail = `\n\n[执行约束]\n严格基于上述灵魂与知识库执行推演；引用具体数据时标注来源（文档名）；不要编造未提供的数字；输出 markdown 格式。`;
  return `${head}${knowledge}${tail}`;
}

/** 解析 Gemini :generateContent 响应 — 抽 markdown text + token usage */
export function parseGeminiResponse(json: unknown): {
  markdown: string;
  promptTokens?: number;
  outputTokens?: number;
} {
  const j = json as any;
  const parts = j?.candidates?.[0]?.content?.parts;
  const markdown = Array.isArray(parts)
    ? String(parts.find((p: any) => typeof p?.text === "string")?.text ?? "").trim()
    : "";
  const promptTokens = Number.isFinite(j?.usageMetadata?.promptTokenCount)
    ? Number(j.usageMetadata.promptTokenCount)
    : undefined;
  const outputTokens = Number.isFinite(j?.usageMetadata?.candidatesTokenCount)
    ? Number(j.usageMetadata.candidatesTokenCount)
    : undefined;
  return { markdown, promptTokens, outputTokens };
}

// ============================================================================
// Gemini 调用（直连 generativelanguage.googleapis.com，与 deepResearchService /
// routers.ts 主编 AI 助手保持同一套机制；不依赖 SDK）
// ============================================================================

/**
 * 调用 Gemini 3 Pro Preview。失败抛 EnterpriseAgentError。
 * 显式注入 fetch 便于单元测试 mock；默认 globalThis.fetch。
 */
export async function callGeminiForAgent(opts: {
  systemInstruction: string;
  userQuery: string;
  apiKey?: string;
  model?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): Promise<{ markdown: string; promptTokens?: number; outputTokens?: number }> {
  const apiKey = (opts.apiKey ?? process.env.GEMINI_API_KEY ?? "").trim();
  if (!apiKey) {
    throw new EnterpriseAgentError("MISSING_GEMINI_API_KEY", "missing_GEMINI_API_KEY");
  }
  const model = opts.model ?? ENTERPRISE_AGENT_GEMINI_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: opts.systemInstruction }] },
      contents: [{ role: "user", parts: [{ text: opts.userQuery }] }],
      generationConfig: {
        temperature: 0.7,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 8192,
      },
    }),
    signal: opts.signal ?? AbortSignal.timeout(GEMINI_FETCH_TIMEOUT_MS),
  });
  const json: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new EnterpriseAgentError(
      "GEMINI_API_ERROR",
      `gemini_api_http_${res.status}`,
      { status: res.status, body: JSON.stringify(json).slice(0, 300) },
    );
  }
  const parsed = parseGeminiResponse(json);
  if (!parsed.markdown) {
    throw new EnterpriseAgentError(
      "GEMINI_EMPTY_RESPONSE",
      "Gemini 未返回正文",
      { snippet: JSON.stringify(json).slice(0, 300) },
    );
  }
  return parsed;
}

// ============================================================================
// 数据库 CRUD（业务编排）
// ============================================================================

/**
 * 创建 agent（默认 tier='trial'）。
 *
 * 流程：
 *   1. **router 层先调** `assertMaintenanceOff(...)` —— PR-3 在 router mutation
 *      第一行调，本服务函数**不**重复调，避免单测要 mock 文件系统。
 *   2. db.insert(enterpriseAgents) —— 拿到 agentId
 *   3. paidJobLedger.registerActiveJob(jobId, taskType, ...)
 *   4. db.update(enterpriseAgents) 把 paidJobLedgerJobId 写回
 *
 * 为什么先 insert 再 register：jobId 包含 agentId（serial PK），必须先拿到 id。
 * 万一第 3 步失败：第 2 步已落库的 agent 会被孤立，但 status='active' 没影响 ——
 * 调用层可以重试 register。这比反过来"先 register 再 insert"风险更小（后者
 * 失败会留下 hold 文件孤儿）。
 */
export async function createAgent(input: {
  userId: number;
  agentName: string;
  systemCommand: string;
  organizationName?: string;
  tier?: "trial" | "pro";
  /** 注入 paidJobLedger.registerActiveJob 便于单元测试；默认走真实模块 */
  registerActiveJob?: (input: {
    jobId: string;
    taskType: string;
    userId: number;
    creditsBilled: number;
    action: string;
    externalApiCostHint?: string;
    metadata?: Record<string, unknown>;
  }) => Promise<void>;
  /** 时间注入便于测试 */
  now?: Date;
}): Promise<EnterpriseAgent> {
  const db = await getDb();
  if (!db) {
    throw new EnterpriseAgentError("DATABASE_UNAVAILABLE", "数据库不可用");
  }

  const tier = input.tier ?? "trial";
  const now = input.now ?? new Date();
  const trialUntil = tier === "trial" ? computeTrialUntil(now) : null;

  // ── Step 1: 落库 agent，先拿 id ─────────────────────────────────
  const [inserted] = await db
    .insert(enterpriseAgents)
    .values({
      userId: input.userId,
      organizationName: input.organizationName ?? null,
      agentName: input.agentName,
      systemCommand: input.systemCommand,
      tier,
      status: "active",
      trialUntil,
      knowledgeBaseQuotaMb: TRIAL_KB_QUOTA_MB,
      knowledgeBaseUsedMb: 0,
      callsThisPeriod: 0,
      callsQuotaPeriod: TRIAL_CALLS_QUOTA,
      quotaPeriodStart: now,
      paidJobLedgerJobId: null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  if (!inserted) {
    throw new EnterpriseAgentError("DATABASE_UNAVAILABLE", "agent 写入失败：未返回行");
  }

  // ── Step 2: 注册 paidJobLedger hold（admin 模式 creditsBilled=0） ───
  const jobId = formatTrialJobId(inserted.id, now.getTime());
  const registerFn =
    input.registerActiveJob ??
    (async (i) => {
      const m = await import("./paidJobLedger");
      await m.registerActiveJob({
        jobId: i.jobId,
        taskType: i.taskType as any,
        userId: i.userId,
        creditsBilled: i.creditsBilled,
        action: i.action,
        externalApiCostHint: i.externalApiCostHint,
        metadata: i.metadata,
      });
    });

  try {
    await registerFn({
      jobId,
      taskType: ENTERPRISE_AGENT_TASK_TYPE,
      userId: input.userId,
      creditsBilled: 0,
      action:
        tier === "trial"
          ? `企业Agent试用部署·¥${TRIAL_PRICE_CNY.toLocaleString("en-US")}/30天`
          : "企业Agent正式部署·线下定制",
      externalApiCostHint: `Gemini ${ENTERPRISE_AGENT_GEMINI_MODEL} · 知识库 ≤ ${TRIAL_KB_QUOTA_MB}MB`,
      metadata: {
        agentId: inserted.id,
        agentName: inserted.agentName,
        tier,
        trialUntil: trialUntil?.toISOString(),
      },
    });
  } catch (err) {
    // 注册失败不回滚 agent —— 调用层可调 attachLedgerHold(agentId) 重试
    console.warn(
      `[enterpriseAgent] registerActiveJob failed for agentId=${inserted.id} jobId=${jobId}: ${(err as Error)?.message}`,
    );
  }

  // ── Step 3: 把 jobId 写回 agent 行 ──────────────────────────────
  const [updated] = await db
    .update(enterpriseAgents)
    .set({ paidJobLedgerJobId: jobId, updatedAt: now })
    .where(eq(enterpriseAgents.id, inserted.id))
    .returning();

  return updated ?? { ...inserted, paidJobLedgerJobId: jobId };
}

/** 单查 agent — 不存在返回 null（router 层负责映射成 NOT_FOUND） */
export async function getAgentById(agentId: number): Promise<EnterpriseAgent | null> {
  const db = await getDb();
  if (!db) {
    throw new EnterpriseAgentError("DATABASE_UNAVAILABLE", "数据库不可用");
  }
  const rows = await db
    .select()
    .from(enterpriseAgents)
    .where(eq(enterpriseAgents.id, agentId))
    .limit(1);
  return rows[0] ?? null;
}

/** 列出指定用户的所有 agent（管理后台 / playground 入口用） */
export async function listAgentsByUser(userId: number): Promise<EnterpriseAgent[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(enterpriseAgents)
    .where(eq(enterpriseAgents.userId, userId))
    .orderBy(asc(enterpriseAgents.createdAt));
}

/**
 * 执行一次 Agent 推演调用。
 *
 * 流程：
 *   1. 查 agent；不存在 → AGENT_NOT_FOUND
 *   2. 检测周期重置（now > quotaPeriodStart + 30d → reset callsThisPeriod=0）
 *   3. assertAgentExecutable —— status / trial / 配额三步顺序闸门
 *   4. 加载 KB（PR-2 用 extractedTextPreview，PR-3 升级完整文本）
 *   5. 调 Gemini
 *   6. 写 enterpriseAgentSessions 审计日志
 *   7. callsThisPeriod += 1
 *
 * 注意：本函数**不**调 paidJobLedger.registerActiveJob —— 单次调用是 hold 周期内
 * 的子操作，不需要 per-call ledger。但 Gemini 失败仍会写一条 sessions 行
 * （responseMarkdown=null）便于 admin 后台问题排查。
 */
export async function executeAgentQuery(input: {
  agentId: number;
  userQuery: string;
  /** Gemini API key 注入，便于测试；默认 process.env.GEMINI_API_KEY */
  apiKey?: string;
  /** fetch 注入，便于测试 */
  fetchImpl?: typeof fetch;
  /** 时间注入 */
  now?: Date;
}): Promise<{
  markdown: string;
  promptTokens?: number;
  outputTokens?: number;
  durationMs: number;
  sessionId: number;
}> {
  const db = await getDb();
  if (!db) {
    throw new EnterpriseAgentError("DATABASE_UNAVAILABLE", "数据库不可用");
  }

  const now = input.now ?? new Date();

  // ── 1. 查 agent ──────────────────────────────────────────────
  const agent = await getAgentById(input.agentId);
  if (!agent) {
    throw new EnterpriseAgentError("AGENT_NOT_FOUND", `agent ${input.agentId} 不存在`);
  }

  // ── 2. 周期重置（在闸门校验之前，否则配额耗尽 + 周期已重置会误判） ──
  let effectiveCallsThisPeriod = agent.callsThisPeriod;
  let effectiveQuotaStart = agent.quotaPeriodStart;
  if (shouldResetQuota(now, agent.quotaPeriodStart)) {
    await db
      .update(enterpriseAgents)
      .set({ callsThisPeriod: 0, quotaPeriodStart: now, updatedAt: now })
      .where(eq(enterpriseAgents.id, agent.id));
    effectiveCallsThisPeriod = 0;
    effectiveQuotaStart = now;
  }

  // ── 3. 状态闸门 ──────────────────────────────────────────────
  const gateError = assertAgentExecutable(
    {
      status: agent.status,
      tier: agent.tier,
      trialUntil: agent.trialUntil,
      callsThisPeriod: effectiveCallsThisPeriod,
      callsQuotaPeriod: agent.callsQuotaPeriod,
    },
    now,
  );
  if (gateError) throw gateError;

  // ── 4. 加载知识库（PR-2 占位：用 preview，PR-3 升级完整文本） ──
  const kbRows = await db
    .select({
      filename: enterpriseAgentKnowledgeBase.filename,
      preview: enterpriseAgentKnowledgeBase.extractedTextPreview,
    })
    .from(enterpriseAgentKnowledgeBase)
    .where(eq(enterpriseAgentKnowledgeBase.agentId, agent.id))
    .orderBy(asc(enterpriseAgentKnowledgeBase.uploadedAt));
  const knowledgeContext = composeKnowledgeContext(
    kbRows.map((r) => ({ filename: r.filename, text: r.preview })),
  );
  const systemInstruction = buildSystemInstruction(agent.systemCommand, knowledgeContext);

  // ── 5. 调 Gemini ─────────────────────────────────────────────
  const startedAt = Date.now();
  let geminiOk = false;
  let markdown = "";
  let promptTokens: number | undefined;
  let outputTokens: number | undefined;
  let geminiError: EnterpriseAgentError | null = null;

  try {
    const r = await callGeminiForAgent({
      systemInstruction,
      userQuery: input.userQuery,
      apiKey: input.apiKey,
      fetchImpl: input.fetchImpl,
    });
    markdown = r.markdown;
    promptTokens = r.promptTokens;
    outputTokens = r.outputTokens;
    geminiOk = true;
  } catch (err) {
    geminiError = err instanceof EnterpriseAgentError
      ? err
      : new EnterpriseAgentError("GEMINI_API_ERROR", String((err as Error)?.message ?? err));
  }
  const durationMs = Date.now() - startedAt;

  // ── 6. 写 sessions 审计日志（成功 + 失败都写，便于 admin 排查） ──
  const [session] = await db
    .insert(enterpriseAgentSessions)
    .values({
      agentId: agent.id,
      userQuery: input.userQuery,
      responseMarkdown: geminiOk ? markdown : null,
      promptTokens: promptTokens ?? null,
      outputTokens: outputTokens ?? null,
      modelUsed: ENTERPRISE_AGENT_GEMINI_MODEL,
      durationMs,
      createdAt: now,
    })
    .returning({ id: enterpriseAgentSessions.id });

  if (!geminiOk) {
    throw geminiError!;
  }

  // ── 7. 累计配额（成功才计） ─────────────────────────────────
  await db
    .update(enterpriseAgents)
    .set({
      callsThisPeriod: sql`${enterpriseAgents.callsThisPeriod} + 1`,
      updatedAt: now,
    })
    .where(eq(enterpriseAgents.id, agent.id));

  return {
    markdown,
    promptTokens,
    outputTokens,
    durationMs,
    sessionId: session?.id ?? 0,
  };
}

/**
 * 试用过期 / 主动停用：把 agent 标 expired + 通过 paidJobLedger 把对应 hold 标 settled
 * （走 user_cancelled_no_refund 分支，不退款，与商业规则一致）。
 *
 * 幂等：已经 expired 的 agent 重复调用是 no-op。
 */
export async function expireAgent(input: {
  agentId: number;
  reason?: string;
  /** 注入退分函数便于测试 */
  refundCreditsOnFailure?: (
    jobId: string,
    taskType: string,
    reason: "user_cancelled_no_refund",
    detail?: string,
  ) => Promise<unknown>;
  now?: Date;
}): Promise<{ ok: boolean; alreadyExpired: boolean }> {
  const db = await getDb();
  if (!db) {
    throw new EnterpriseAgentError("DATABASE_UNAVAILABLE", "数据库不可用");
  }
  const now = input.now ?? new Date();

  const agent = await getAgentById(input.agentId);
  if (!agent) {
    throw new EnterpriseAgentError("AGENT_NOT_FOUND", `agent ${input.agentId} 不存在`);
  }
  if (agent.status === "expired" || agent.status === "deleted") {
    return { ok: true, alreadyExpired: true };
  }

  await db
    .update(enterpriseAgents)
    .set({ status: "expired", updatedAt: now })
    .where(
      and(eq(enterpriseAgents.id, agent.id), eq(enterpriseAgents.status, "active")),
    );

  if (agent.paidJobLedgerJobId) {
    const refundFn =
      input.refundCreditsOnFailure ??
      (async (jobId, taskType, reason, detail) => {
        const m = await import("./paidJobLedger");
        return m.refundCreditsOnFailure(jobId, taskType as any, reason, detail);
      });
    try {
      await refundFn(
        agent.paidJobLedgerJobId,
        ENTERPRISE_AGENT_TASK_TYPE,
        "user_cancelled_no_refund",
        input.reason ?? "试用 30 天到期未升级",
      );
    } catch (err) {
      // hold 标记失败不影响 agent 已 expired 的事实；仅打 warn
      console.warn(
        `[enterpriseAgent] expireAgent: refundCreditsOnFailure failed for ${agent.paidJobLedgerJobId}: ${(err as Error)?.message}`,
      );
    }
  }

  return { ok: true, alreadyExpired: false };
}

/**
 * 软删除 agent —— 设 status='deleted'。
 * 与硬删不同：保留所有 db 行 + KB 文件 + sessions，便于 90 天合规期内取证。
 * 90 天后由独立清理脚本（不在本 PR 范围）做硬清理。
 */
export async function softDeleteAgent(input: {
  agentId: number;
  by: "user" | "admin";
  now?: Date;
}): Promise<{ ok: boolean; alreadyDeleted: boolean }> {
  const db = await getDb();
  if (!db) {
    throw new EnterpriseAgentError("DATABASE_UNAVAILABLE", "数据库不可用");
  }
  const now = input.now ?? new Date();

  const agent = await getAgentById(input.agentId);
  if (!agent) {
    throw new EnterpriseAgentError("AGENT_NOT_FOUND", `agent ${input.agentId} 不存在`);
  }
  if (agent.status === "deleted") {
    return { ok: true, alreadyDeleted: true };
  }

  await db
    .update(enterpriseAgents)
    .set({ status: "deleted", updatedAt: now })
    .where(eq(enterpriseAgents.id, agent.id));

  console.log(
    `[enterpriseAgent] 🗑 soft-deleted agentId=${agent.id} userId=${agent.userId} by=${input.by}`,
  );

  return { ok: true, alreadyDeleted: false };
}

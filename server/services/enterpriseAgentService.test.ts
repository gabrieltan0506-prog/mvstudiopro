import { beforeEach, describe, expect, it, vi } from "vitest";

// 模块级 mock：让 softDeleteAgent 能调通 db 链路。
// 纯逻辑工具测试不调 getDb，不受影响。
vi.mock("../db", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "../db";
import {
  ENTERPRISE_AGENT_GEMINI_MODEL,
  EnterpriseAgentError,
  QUOTA_PERIOD_DAYS,
  TRIAL_CALLS_QUOTA,
  TRIAL_DURATION_DAYS,
  assertAgentExecutable,
  buildSystemInstruction,
  callGeminiForAgent,
  composeKnowledgeContext,
  computeTrialUntil,
  formatTrialJobId,
  isAgentTrialExpired,
  parseGeminiResponse,
  shouldResetQuota,
  softDeleteAgent,
} from "./enterpriseAgentService";

// ─── jobId 格式 ──────────────────────────────────────────────────────────────

describe("formatTrialJobId", () => {
  it("生成 enterpriseAgent_${id}_trial_${ts} 格式（与文档约定一致）", () => {
    expect(formatTrialJobId(42, 1234567890)).toBe("enterpriseAgent_42_trial_1234567890");
  });

  it("不传 ts 时使用当前时间戳", () => {
    const before = Date.now();
    const job = formatTrialJobId(7);
    const after = Date.now();
    const m = job.match(/^enterpriseAgent_7_trial_(\d+)$/);
    expect(m).not.toBeNull();
    const ts = Number(m![1]);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});

// ─── 30 天试用到期 ───────────────────────────────────────────────────────────

describe("computeTrialUntil", () => {
  it("30 天后到期", () => {
    const start = new Date("2026-04-30T00:00:00Z");
    const expected = new Date("2026-05-30T00:00:00Z");
    expect(computeTrialUntil(start).toISOString()).toBe(expected.toISOString());
  });

  it("跨月跨年正确计算（2 月）", () => {
    const start = new Date("2026-02-15T08:00:00Z");
    const out = computeTrialUntil(start);
    // 30 天后是 3 月 17 日
    expect(out.toISOString()).toBe("2026-03-17T08:00:00.000Z");
  });

  it("常量 TRIAL_DURATION_DAYS 与文档一致", () => {
    expect(TRIAL_DURATION_DAYS).toBe(30);
    expect(TRIAL_CALLS_QUOTA).toBe(100);
    expect(QUOTA_PERIOD_DAYS).toBe(30);
  });
});

// ─── 30 天周期重置判定 ───────────────────────────────────────────────────────

describe("shouldResetQuota", () => {
  const start = new Date("2026-04-01T00:00:00Z");

  it("周期内：返回 false", () => {
    expect(shouldResetQuota(new Date("2026-04-15T00:00:00Z"), start)).toBe(false);
  });

  it("恰好 30 天边界：返回 false（不重置）", () => {
    expect(shouldResetQuota(new Date("2026-05-01T00:00:00Z"), start)).toBe(false);
  });

  it("周期外（30 天 + 1 秒）：返回 true", () => {
    expect(shouldResetQuota(new Date("2026-05-01T00:00:01Z"), start)).toBe(true);
  });

  it("自定义 periodDays 参数生效", () => {
    expect(shouldResetQuota(new Date("2026-04-08T00:00:01Z"), start, 7)).toBe(true);
    expect(shouldResetQuota(new Date("2026-04-07T23:59:59Z"), start, 7)).toBe(false);
  });
});

// ─── trial 过期判定 ──────────────────────────────────────────────────────────

describe("isAgentTrialExpired", () => {
  const trialUntil = new Date("2026-05-30T00:00:00Z");

  it("trial agent 在到期前：未过期", () => {
    expect(
      isAgentTrialExpired({ tier: "trial", trialUntil }, new Date("2026-05-29T23:59:59Z")),
    ).toBe(false);
  });

  it("trial agent 过 trialUntil：过期", () => {
    expect(
      isAgentTrialExpired({ tier: "trial", trialUntil }, new Date("2026-05-30T00:00:01Z")),
    ).toBe(true);
  });

  it("pro agent 永远不过期（即使 trialUntil 有值）", () => {
    expect(
      isAgentTrialExpired({ tier: "pro", trialUntil }, new Date("2027-01-01T00:00:00Z")),
    ).toBe(false);
  });

  it("trialUntil 为 null：返回 false（防御 pro agent 漏配）", () => {
    expect(
      isAgentTrialExpired({ tier: "trial", trialUntil: null }, new Date()),
    ).toBe(false);
  });
});

// ─── 状态闸门顺序（errors.md #22 配额校验顺序） ─────────────────────────────

describe("assertAgentExecutable — 三步顺序闸门", () => {
  const baseAgent = {
    status: "active" as const,
    tier: "trial" as const,
    trialUntil: new Date("2026-05-30T00:00:00Z"),
    callsThisPeriod: 5,
    callsQuotaPeriod: 100,
  };
  const okNow = new Date("2026-05-15T00:00:00Z");
  const expiredNow = new Date("2026-06-01T00:00:00Z");

  it("active + 未过期 + 配额内：返回 null（通过）", () => {
    expect(assertAgentExecutable(baseAgent, okNow)).toBeNull();
  });

  it("status=expired：先报 AGENT_NOT_ACTIVE（顺序最高）", () => {
    const e = assertAgentExecutable({ ...baseAgent, status: "expired" }, okNow);
    expect(e).toBeInstanceOf(EnterpriseAgentError);
    expect(e!.code).toBe("AGENT_NOT_ACTIVE");
  });

  it("status=deleted：报 AGENT_NOT_ACTIVE（不会泄漏 trial 信息）", () => {
    const e = assertAgentExecutable({ ...baseAgent, status: "deleted" }, expiredNow);
    expect(e!.code).toBe("AGENT_NOT_ACTIVE");
  });

  it("active 但 trialUntil 已过：报 TRIAL_EXPIRED（顺序中间）", () => {
    const e = assertAgentExecutable(baseAgent, expiredNow);
    expect(e!.code).toBe("TRIAL_EXPIRED");
  });

  it("配额耗尽（callsThisPeriod === quota）：报 QUOTA_EXHAUSTED（顺序最低）", () => {
    const e = assertAgentExecutable({ ...baseAgent, callsThisPeriod: 100 }, okNow);
    expect(e!.code).toBe("QUOTA_EXHAUSTED");
  });

  it("配额超额（>quota，理论不应发生但防御）：仍报 QUOTA_EXHAUSTED", () => {
    const e = assertAgentExecutable({ ...baseAgent, callsThisPeriod: 999 }, okNow);
    expect(e!.code).toBe("QUOTA_EXHAUSTED");
  });

  it("trial 过期 AND 配额耗尽：先报 TRIAL_EXPIRED（不会先报配额）", () => {
    const e = assertAgentExecutable(
      { ...baseAgent, callsThisPeriod: 100 },
      expiredNow,
    );
    expect(e!.code).toBe("TRIAL_EXPIRED");
  });
});

// ─── 知识库拼装 ──────────────────────────────────────────────────────────────

describe("composeKnowledgeContext", () => {
  it("空数组：返回空字符串", () => {
    expect(composeKnowledgeContext([])).toBe("");
  });

  it("所有 text 为 null/undefined/空白：返回空字符串", () => {
    expect(
      composeKnowledgeContext([
        { filename: "a.pdf", text: null },
        { filename: "b.txt", text: "" },
        { filename: "c.pdf", text: "  \n\t  " },
      ]),
    ).toBe("");
  });

  it("正常拼装：每段加文件名 marker，按顺序", () => {
    const out = composeKnowledgeContext([
      { filename: "销冠SOP.pdf", text: "客户首次接触必须 30 秒讲清价值。" },
      { filename: "战败分析.txt", text: "丢单 80% 因报价后 24 小时无跟进。" },
    ]);
    expect(out).toContain("── 文档 1：销冠SOP.pdf ──");
    expect(out).toContain("客户首次接触必须 30 秒讲清价值。");
    expect(out).toContain("── 文档 2：战败分析.txt ──");
    expect(out).toContain("丢单 80% 因报价后 24 小时无跟进。");
    expect(out.indexOf("文档 1")).toBeLessThan(out.indexOf("文档 2"));
  });

  it("空 text 与有效 text 混合：空的被过滤，编号按有效项重排", () => {
    const out = composeKnowledgeContext([
      { filename: "empty.pdf", text: "" },
      { filename: "real.pdf", text: "有效内容" },
    ]);
    expect(out).toContain("── 文档 1：real.pdf ──");
    expect(out).not.toContain("empty.pdf");
  });
});

// ─── systemInstruction 拼装 ──────────────────────────────────────────────────

describe("buildSystemInstruction", () => {
  it("无知识库：仅含灵魂 + 执行约束", () => {
    const out = buildSystemInstruction("你是销冠教练", "");
    expect(out).toContain("[智能体灵魂]");
    expect(out).toContain("你是销冠教练");
    expect(out).not.toContain("[企业私有知识库]");
    expect(out).toContain("[执行约束]");
  });

  it("含知识库：三段都有", () => {
    const out = buildSystemInstruction("灵魂指令", "知识库内容片段");
    expect(out).toContain("[智能体灵魂]");
    expect(out).toContain("灵魂指令");
    expect(out).toContain("[企业私有知识库]");
    expect(out).toContain("知识库内容片段");
    expect(out).toContain("[执行约束]");
    // 顺序：灵魂 → 知识库 → 约束
    expect(out.indexOf("[智能体灵魂]")).toBeLessThan(out.indexOf("[企业私有知识库]"));
    expect(out.indexOf("[企业私有知识库]")).toBeLessThan(out.indexOf("[执行约束]"));
  });

  it("约束里强调不要编造 + 标注来源", () => {
    const out = buildSystemInstruction("x", "y");
    expect(out).toMatch(/编造|来源|引用/);
  });
});

// ─── Gemini 响应解析 ─────────────────────────────────────────────────────────

describe("parseGeminiResponse", () => {
  it("正常响应：抽 markdown + tokens", () => {
    const r = parseGeminiResponse({
      candidates: [{ content: { parts: [{ text: "## 推演结果\n首要建议..." }] } }],
      usageMetadata: { promptTokenCount: 1234, candidatesTokenCount: 567 },
    });
    expect(r.markdown).toContain("推演结果");
    expect(r.promptTokens).toBe(1234);
    expect(r.outputTokens).toBe(567);
  });

  it("缺少 usageMetadata：tokens 为 undefined", () => {
    const r = parseGeminiResponse({
      candidates: [{ content: { parts: [{ text: "回答" }] } }],
    });
    expect(r.markdown).toBe("回答");
    expect(r.promptTokens).toBeUndefined();
    expect(r.outputTokens).toBeUndefined();
  });

  it("空响应：markdown 为空字符串", () => {
    expect(parseGeminiResponse({}).markdown).toBe("");
    expect(parseGeminiResponse({ candidates: [] }).markdown).toBe("");
    expect(
      parseGeminiResponse({ candidates: [{ content: { parts: [] } }] }).markdown,
    ).toBe("");
  });

  it("parts 含 inlineData 等非文本：跳过取第一段 text", () => {
    const r = parseGeminiResponse({
      candidates: [
        {
          content: {
            parts: [
              { inlineData: { data: "ignored" } },
              { text: "真正的回答" },
            ],
          },
        },
      ],
    });
    expect(r.markdown).toBe("真正的回答");
  });

  it("非数字 token：返回 undefined（防御）", () => {
    const r = parseGeminiResponse({
      candidates: [{ content: { parts: [{ text: "x" }] } }],
      usageMetadata: { promptTokenCount: "abc", candidatesTokenCount: NaN },
    });
    expect(r.promptTokens).toBeUndefined();
    expect(r.outputTokens).toBeUndefined();
  });
});

// ─── Gemini 调用（mock fetch） ───────────────────────────────────────────────

describe("callGeminiForAgent — mock fetch", () => {
  it("缺少 API key：抛 MISSING_GEMINI_API_KEY", async () => {
    await expect(
      callGeminiForAgent({ systemInstruction: "x", userQuery: "y", apiKey: "" }),
    ).rejects.toMatchObject({
      name: "EnterpriseAgentError",
      code: "MISSING_GEMINI_API_KEY",
    });
  });

  it("HTTP 4xx：抛 GEMINI_API_ERROR + meta 含 status", async () => {
    const fakeFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "bad request" } }), {
        status: 400,
      }),
    );
    await expect(
      callGeminiForAgent({
        systemInstruction: "x",
        userQuery: "y",
        apiKey: "fake",
        fetchImpl: fakeFetch as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: "GEMINI_API_ERROR" });
    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });

  it("空 markdown：抛 GEMINI_EMPTY_RESPONSE", async () => {
    const fakeFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ candidates: [] }), { status: 200 }),
    );
    await expect(
      callGeminiForAgent({
        systemInstruction: "x",
        userQuery: "y",
        apiKey: "fake",
        fetchImpl: fakeFetch as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: "GEMINI_EMPTY_RESPONSE" });
  });

  it("正常 200：返回 markdown + tokens；URL 含模型名", async () => {
    const fakeFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "## ok" }] } }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 },
        }),
        { status: 200 },
      ),
    );
    const out = await callGeminiForAgent({
      systemInstruction: "灵魂",
      userQuery: "如何提升复购率？",
      apiKey: "test-key",
      fetchImpl: fakeFetch as unknown as typeof fetch,
    });
    expect(out.markdown).toBe("## ok");
    expect(out.promptTokens).toBe(10);
    expect(out.outputTokens).toBe(20);
    const calledUrl = String(fakeFetch.mock.calls[0]![0]);
    expect(calledUrl).toContain(ENTERPRISE_AGENT_GEMINI_MODEL);
    expect(calledUrl).toContain("key=test-key");
  });

  it("请求 body 包含 systemInstruction 与 user query", async () => {
    const fakeFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }),
        { status: 200 },
      ),
    );
    await callGeminiForAgent({
      systemInstruction: "灵魂指令-XYZ",
      userQuery: "用户提问-ABC",
      apiKey: "k",
      fetchImpl: fakeFetch as unknown as typeof fetch,
    });
    const init = fakeFetch.mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(body.systemInstruction.parts[0].text).toBe("灵魂指令-XYZ");
    expect(body.contents[0].parts[0].text).toBe("用户提问-ABC");
    expect(body.generationConfig.maxOutputTokens).toBeGreaterThanOrEqual(8192);
  });
});

// ─── softDeleteAgent — refund 注入调用（与 expireAgent 对齐） ─────────────────
//
// 思路：mock `../db.getDb` 返回最小可用的 drizzle stub（只覆盖 select/update
// 链路），验证 softDeleteAgent 在不同分支下是否正确调用注入的退分函数。
// 不测真实 db 行为；那是 PR-3 端到端集成测试的职责。

describe("softDeleteAgent — refund 注入", () => {
  const baseAgent = {
    id: 7,
    userId: 42,
    organizationName: null,
    agentName: "销冠教练",
    systemCommand: "...",
    tier: "trial" as const,
    status: "active" as const,
    trialUntil: new Date("2026-05-30T00:00:00Z"),
    knowledgeBaseQuotaMb: 50,
    knowledgeBaseUsedMb: 0,
    callsThisPeriod: 3,
    callsQuotaPeriod: 100,
    quotaPeriodStart: new Date("2026-04-30T00:00:00Z"),
    paidJobLedgerJobId: "enterpriseAgent_7_trial_1714435200000",
    createdAt: new Date("2026-04-30T00:00:00Z"),
    updatedAt: new Date("2026-04-30T00:00:00Z"),
  };

  /** 构造一个最小 drizzle stub：select 返回指定 agent 行，update 直接 resolve */
  function makeDbStub(selectResult: unknown[]) {
    return {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve(selectResult),
          }),
        }),
      }),
      update: () => ({
        set: () => ({
          where: () => Promise.resolve(undefined),
        }),
      }),
    };
  }

  beforeEach(() => {
    vi.mocked(getDb).mockReset();
  });

  it("agent 存在 + paidJobLedgerJobId 存在 → 调注入的 refundCreditsOnFailure", async () => {
    vi.mocked(getDb).mockResolvedValue(makeDbStub([baseAgent]) as any);
    const refundSpy = vi.fn().mockResolvedValue({ refunded: false, status: "settled" });

    const out = await softDeleteAgent({
      agentId: 7,
      by: "admin",
      refundCreditsOnFailure: refundSpy,
    });

    expect(out).toEqual({ ok: true, alreadyDeleted: false });
    expect(refundSpy).toHaveBeenCalledTimes(1);
    expect(refundSpy).toHaveBeenCalledWith(
      "enterpriseAgent_7_trial_1714435200000",
      "enterpriseAgentTrial",
      "user_cancelled_no_refund",
      expect.stringContaining("软删除"),
    );
    // by="admin" 时文案含"管理员"
    expect(String(refundSpy.mock.calls[0]![3])).toContain("管理员");
  });

  it("by=user 时退分文案不含\"管理员\"", async () => {
    vi.mocked(getDb).mockResolvedValue(makeDbStub([baseAgent]) as any);
    const refundSpy = vi.fn().mockResolvedValue({});

    await softDeleteAgent({ agentId: 7, by: "user", refundCreditsOnFailure: refundSpy });

    expect(String(refundSpy.mock.calls[0]![3])).toContain("软删除");
    expect(String(refundSpy.mock.calls[0]![3])).not.toContain("管理员");
  });

  it("paidJobLedgerJobId 为 null → 跳过退分（不调注入函数）", async () => {
    vi.mocked(getDb).mockResolvedValue(
      makeDbStub([{ ...baseAgent, paidJobLedgerJobId: null }]) as any,
    );
    const refundSpy = vi.fn();

    const out = await softDeleteAgent({
      agentId: 7,
      by: "user",
      refundCreditsOnFailure: refundSpy,
    });

    expect(out.ok).toBe(true);
    expect(refundSpy).not.toHaveBeenCalled();
  });

  it("已经 status='deleted' → 提前返回 alreadyDeleted=true，不调退分", async () => {
    vi.mocked(getDb).mockResolvedValue(
      makeDbStub([{ ...baseAgent, status: "deleted" }]) as any,
    );
    const refundSpy = vi.fn();

    const out = await softDeleteAgent({
      agentId: 7,
      by: "admin",
      refundCreditsOnFailure: refundSpy,
    });

    expect(out).toEqual({ ok: true, alreadyDeleted: true });
    expect(refundSpy).not.toHaveBeenCalled();
  });

  it("退分函数抛错：不影响 softDeleteAgent 返回成功（hold 标记失败仅 warn）", async () => {
    vi.mocked(getDb).mockResolvedValue(makeDbStub([baseAgent]) as any);
    const refundSpy = vi.fn().mockRejectedValue(new Error("ledger write fail"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const out = await softDeleteAgent({
      agentId: 7,
      by: "user",
      refundCreditsOnFailure: refundSpy,
    });

    expect(out).toEqual({ ok: true, alreadyDeleted: false });
    expect(warnSpy).toHaveBeenCalled();
    expect(String(warnSpy.mock.calls[0]![0])).toContain("softDelete");
    warnSpy.mockRestore();
  });

  it("agent 不存在 → 抛 AGENT_NOT_FOUND，不调退分", async () => {
    vi.mocked(getDb).mockResolvedValue(makeDbStub([]) as any);
    const refundSpy = vi.fn();

    await expect(
      softDeleteAgent({ agentId: 999, by: "user", refundCreditsOnFailure: refundSpy }),
    ).rejects.toMatchObject({ code: "AGENT_NOT_FOUND" });
    expect(refundSpy).not.toHaveBeenCalled();
  });
});

// ─── EnterpriseAgentError ────────────────────────────────────────────────────

describe("EnterpriseAgentError", () => {
  it("含 code + message + meta", () => {
    const e = new EnterpriseAgentError("TRIAL_EXPIRED", "expired", { foo: 1 });
    expect(e.name).toBe("EnterpriseAgentError");
    expect(e.code).toBe("TRIAL_EXPIRED");
    expect(e.message).toBe("expired");
    expect(e.meta).toEqual({ foo: 1 });
    expect(e).toBeInstanceOf(Error);
  });
});

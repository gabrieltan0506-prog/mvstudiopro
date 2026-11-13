import { describe, expect, it, vi } from "vitest";
import {
  buildGeminiDecisionRequest,
  geminiDecisionEndpoint,
  GEMINI_DECISION_DEFAULT_URL,
  parseGeminiDecisionResponse,
  runGeminiDecision,
  type GeminiDecisionQuestion,
} from "./geminiDecisionGateway";

const questions: GeminiDecisionQuestion[] = [
  { id: "q1", instructions: "第一题", options: [{ id: "yes", description: "是" }, { id: "no", description: "否" }] },
  { id: "q2", instructions: "第二题", options: [{ id: "a", description: "甲" }, { id: "b", description: "乙" }, { id: "c", description: "丙" }] },
];

describe("buildGeminiDecisionRequest", () => {
  it("只发 model / input / questions 三个字段，题目为 choice + criteria", () => {
    const body = buildGeminiDecisionRequest({ model: "gemini-decision-1", input: "正文", questions });
    expect(Object.keys(body).sort()).toEqual(["input", "model", "questions"]);
    expect(body.model).toBe("gemini-decision-1");
    expect(body.questions.q1).toEqual({ type: "choice", instructions: "第一题", criteria: { yes: "是", no: "否" } });
    expect(Object.keys(body.questions.q2)).toEqual(["type", "instructions", "criteria"]);
  });

  it("拒绝空输入、base64 媒体、非法或重复 id、少于两个选项", () => {
    expect(() => buildGeminiDecisionRequest({ model: "m", input: " ", questions })).toThrow();
    expect(() => buildGeminiDecisionRequest({ model: "m", input: "data:image/png;base64,AAAA", questions })).toThrow(/base64/);
    expect(() => buildGeminiDecisionRequest({ model: "m", input: "x", questions: [{ ...questions[0], id: "第一" }] })).toThrow();
    expect(() => buildGeminiDecisionRequest({ model: "m", input: "x", questions: [questions[0], questions[0]] })).toThrow(/重复/);
    expect(() => buildGeminiDecisionRequest({ model: "m", input: "x", questions: [{ id: "q", instructions: "i", options: [{ id: "a", description: "甲" }] }] })).toThrow();
    expect(() => buildGeminiDecisionRequest({ model: "m", input: "x", questions: [] })).toThrow();
  });
});

describe("parseGeminiDecisionResponse", () => {
  it("标准形状：choice / probabilities / confidence / usage", () => {
    const parsed = parseGeminiDecisionResponse({
      answers: {
        q1: { choice: "yes", probabilities: { yes: 0.8, no: 0.2 }, confidence: 0.8 },
        q2: { choice: "b", probabilities: { a: 0.1, b: 0.7, c: 0.2 }, confidence: 0.7 },
      },
      usage: { total_input_tokens: 2_000_000 },
    }, questions);
    expect(parsed.answers.q1).toEqual({ choice: "yes", unknownChoice: false, probabilities: { yes: 0.8, no: 0.2 }, confidence: 0.8 });
    expect(parsed.missing).toEqual([]);
    expect(parsed.totalInputTokens).toBe(2_000_000);
    expect(parsed.costUsd).toBeCloseTo(0.2);
  });

  it("宽容：缺概率/置信度、数组形 answers 与概率、对象形 choice、未知选项、缺题", () => {
    const parsed = parseGeminiDecisionResponse({
      answers: [
        { id: "q1", choice: { id: "no" }, probabilities: [{ choice: "yes", probability: 0.3 }, { option: "no", p: "0.7" }] },
      ],
    }, questions);
    expect(parsed.answers.q1).toEqual({ choice: "no", unknownChoice: false, probabilities: { yes: 0.3, no: 0.7 }, confidence: null });
    expect(parsed.missing).toEqual(["q2"]);
    expect(parsed.totalInputTokens).toBeNull();
    expect(parsed.costUsd).toBeNull();

    const odd = parseGeminiDecisionResponse({ answers: { q1: "maybe", q2: { choice: "c", confidence: 85 } } }, questions);
    expect(odd.answers.q1).toMatchObject({ choice: null, unknownChoice: true, rawChoice: "maybe", probabilities: null });
    expect(odd.answers.q2).toMatchObject({ choice: "c", confidence: 0.85 });
  });

  it("根不是对象时抛错（由网关转为 unavailable）", () => {
    expect(() => parseGeminiDecisionResponse(null, questions)).toThrow();
    expect(() => parseGeminiDecisionResponse([1], questions)).toThrow();
  });
});

function memorySave() {
  const saved: Array<[string, any]> = [];
  return { saved, save: async (name: string, value: unknown) => { saved.push([name, JSON.parse(JSON.stringify(value))]); } };
}
const okBody = JSON.stringify({ answers: { q1: { choice: "yes", confidence: 0.9 }, q2: { choice: "a" } }, usage: { total_input_tokens: 1000 } });
const response = (status: number, text: string) => ({ status, headers: { get: () => "application/json" }, text: async () => text }) as unknown as Response;

describe("runGeminiDecision", () => {
  it("成功：Bearer 鉴权、原始回包在 parsed 之前落盘", async () => {
    const { saved, save } = memorySave();
    const fetchImpl = vi.fn(async () => response(200, okBody));
    const result = await runGeminiDecision({ input: "x", questions, label: "t", save, env: {}, fetchImpl: fetchImpl as any, apiKey: () => "test-key" });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.answers.q1.choice).toBe("yes");
      expect(result.model).toBe("gemini-decision-1");
    }
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(GEMINI_DECISION_DEFAULT_URL);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
    expect(Object.keys(JSON.parse(String(init.body))).sort()).toEqual(["input", "model", "questions"]);
    expect(saved.map(([n]) => n)).toEqual(["request", "raw-1", "parsed"]);
    expect(saved[1][1].text).toBe(okBody);
  });

  it("5xx 重试一次后成功；两次原始回包都保留", async () => {
    const { saved, save } = memorySave();
    const fetchImpl = vi.fn().mockResolvedValueOnce(response(503, "busy")).mockResolvedValueOnce(response(200, okBody));
    const result = await runGeminiDecision({ input: "x", questions, label: "t", save, env: {}, fetchImpl, apiKey: () => "k", sleep: async () => undefined });
    expect(result.status).toBe("ok");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(saved.map(([n]) => n)).toEqual(["request", "raw-1", "raw-2", "parsed"]);
  });

  it("400 不重试；网络错误、写坏、缺密钥都返回 unavailable 不抛错", async () => {
    const m1 = memorySave();
    const bad = vi.fn(async () => response(400, '{"error":"unknown field"}'));
    const r1 = await runGeminiDecision({ input: "x", questions, label: "t", save: m1.save, env: {}, fetchImpl: bad as any, apiKey: () => "k" });
    expect(r1).toMatchObject({ status: "unavailable", reason: "http_400", attempts: 1 });
    expect(m1.saved.map(([n]) => n)).toEqual(["request", "raw-1", "failure"]);

    const m2 = memorySave();
    const boom = vi.fn(async () => { throw new Error("reset"); });
    const r2 = await runGeminiDecision({ input: "x", questions, label: "t", save: m2.save, env: {}, fetchImpl: boom as any, apiKey: () => "k", sleep: async () => undefined });
    expect(r2).toMatchObject({ status: "unavailable", attempts: 2 });

    const m3 = memorySave();
    const junk = vi.fn(async () => response(200, "not json"));
    const r3 = await runGeminiDecision({ input: "x", questions, label: "t", save: m3.save, env: {}, fetchImpl: junk as any, apiKey: () => "k", sleep: async () => undefined });
    expect(r3).toMatchObject({ status: "unavailable", reason: "invalid_json" });
    expect(m3.saved.filter(([n]) => n.startsWith("raw-")).map(([, v]) => v.text)).toEqual(["not json", "not json"]);

    const m4 = memorySave();
    const never = vi.fn();
    const r4 = await runGeminiDecision({ input: "x", questions, label: "t", save: m4.save, env: {}, fetchImpl: never as any, apiKey: () => "" });
    expect(r4).toMatchObject({ status: "unavailable", reason: "missing_key" });
    expect(never).not.toHaveBeenCalled();
  });

  it("证据落盘失败：不解析，返回 unavailable", async () => {
    const save = vi.fn(async (name: string) => { if (name === "raw-1") throw new Error("gcs down"); });
    const fetchImpl = vi.fn(async () => response(200, okBody));
    const result = await runGeminiDecision({ input: "x", questions, label: "t", save, env: {}, fetchImpl: fetchImpl as any, apiKey: () => "k" });
    expect(result.status).toBe("unavailable");
    expect(save.mock.calls.map(([n]) => n)).not.toContain("parsed");
  });

  it("端点可由 env 覆盖，仅接受 https", () => {
    expect(geminiDecisionEndpoint({})).toBe(GEMINI_DECISION_DEFAULT_URL);
    expect(geminiDecisionEndpoint({ GEMINI_DECISION_API_URL: "https://x.example/v1beta/decisions" })).toBe("https://x.example/v1beta/decisions");
    expect(geminiDecisionEndpoint({ GEMINI_DECISION_API_URL: "http://x" })).toBe(GEMINI_DECISION_DEFAULT_URL);
  });
});

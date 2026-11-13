import { describe, expect, it, vi } from "vitest";
import {
  buildNovelAdaptationDecisionInput,
  NOVEL_ADAPTATION_DECISION_QUESTIONS,
  novelAdaptationDecisionCheckEnabled,
  runNovelAdaptationDecisionCheck,
} from "./novelAdaptationDecisionCheck";
import { buildGeminiDecisionRequest, type GeminiDecisionResult } from "./geminiDecisionGateway";

const source = { label: "底本", text: "底本人物与世界规则。".repeat(20) };
const novel = { title: "改编", text: "正文".repeat(300), adaptationNotes: "保留核心事件，新增母女冲突。", model: "m", sourceSha256: "a".repeat(64), templateSha256: "b".repeat(64) };

describe("novelAdaptationDecisionCheck", () => {
  it("缺省关闭；三题可构成合法请求；input 含底本、正文与改编说明", () => {
    expect(novelAdaptationDecisionCheckEnabled({})).toBe(false);
    expect(novelAdaptationDecisionCheckEnabled({ NOVEL_ADAPTATION_DECISION_CHECK: "1" })).toBe(true);
    const input = buildNovelAdaptationDecisionInput({ source, novel });
    expect(input).toContain(source.text);
    expect(input).toContain(novel.text);
    expect(input).toContain(novel.adaptationNotes);
    const body = buildGeminiDecisionRequest({ model: "gemini-decision-1", input, questions: NOVEL_ADAPTATION_DECISION_QUESTIONS });
    expect(Object.keys(body.questions)).toEqual(["opening_hook", "protagonist", "core_setting"]);
  });

  it("关闭时零调用；开启时返回参考结果并落汇总证据", async () => {
    const decide = vi.fn(async (): Promise<GeminiDecisionResult> => ({
      status: "ok", model: "gemini-decision-1", attempts: 1, elapsedMs: 1, missing: ["core_setting"], totalInputTokens: 10, costUsd: 0.000001,
      answers: { opening_hook: { choice: "weak", unknownChoice: false, probabilities: { clear: 0.2, weak: 0.7, none: 0.1 }, confidence: 0.7 }, protagonist: { choice: "complete", unknownChoice: false, probabilities: null, confidence: null } },
    }));
    expect(await runNovelAdaptationDecisionCheck({ source, novel, requestId: "u:r" }, { env: {}, decide: decide as any })).toBeNull();
    expect(decide).not.toHaveBeenCalled();
    const saved: string[] = [];
    const save = Object.assign(async (name: string) => { saved.push(name); }, { prefix: "gemini-decision/novel-adaptation/x" });
    const result = await runNovelAdaptationDecisionCheck({ source, novel, requestId: "u:r" }, { env: { NOVEL_ADAPTATION_DECISION_CHECK: "1" }, decide: decide as any, save });
    expect(result).toMatchObject({ advisory: true, status: "ok", evidencePrefix: "gemini-decision/novel-adaptation/x" });
    expect(result!.answers.opening_hook).toEqual({ choice: "weak", confidence: 0.7, probabilities: { clear: 0.2, weak: 0.7, none: 0.1 } });
    expect(result!.answers.core_setting).toBeNull();
    expect(saved).toEqual(["summary"]);
  });

  it("判定不可用或内部异常都不抛错", async () => {
    const env = { NOVEL_ADAPTATION_DECISION_CHECK: "1" };
    const save = Object.assign(async () => undefined, {});
    const down = vi.fn(async (): Promise<GeminiDecisionResult> => ({ status: "unavailable", reason: "timeout_45000ms", attempts: 2, elapsedMs: 1 }));
    expect(await runNovelAdaptationDecisionCheck({ source, novel, requestId: "r" }, { env, decide: down as any, save })).toMatchObject({ status: "unavailable", reason: "timeout_45000ms" });
    const boom = vi.fn(async () => { throw new Error("x"); });
    expect(await runNovelAdaptationDecisionCheck({ source, novel, requestId: "r" }, { env, decide: boom as any, save })).toBeNull();
  });
});

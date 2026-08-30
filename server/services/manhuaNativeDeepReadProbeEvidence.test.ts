import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { extractNativeProbeModelJson, reconcileNativeProbeSegment, reconcileNativeProbeParsedAttempt, nativeProbeHasThoughtLeak, measureNativeProbeConcurrency } from "./manhuaNativeDeepReadProbeEvidence.js";

const model = { shots: [{ startSec: 0, endSec: 10, actionZh: "转身" }], subtitles: [] };
function fixture() {
  const raw = {
    seriesKey: "probe_test", sourceDigest: "a".repeat(64), episodeIndex: 1, segmentIndex: 0,
    callId: "call-1", attemptNumber: 1,
    requestFingerprint: "b".repeat(64), responseText: JSON.stringify({ candidates: [{
      finishReason: "STOP", content: { parts: [{ text: JSON.stringify(model) }] },
    }] }),
  };
  return {
    seriesKey: raw.seriesKey, sourceDigest: raw.sourceDigest, segmentIndex: 0, startSec: 0, endSec: 10,
    entry: { ...raw, fingerprint: raw.requestFingerprint, startSec: 0, endSec: 10,
      rawAttemptEvidenceObjectName: "raw/attempt-1.json", raw: structuredClone(model) as Record<string, unknown> },
    rawFacts: [{ objectName: "raw/attempt-1.json", payload: raw }],
  };
}
describe("探针按真实对象和完整内容对账", () => {
  it("每发独立解析稿按raw指针、正文与哈希对账，不能拿通过稿数量冒充", () => {
    const raw = fixture().rawFacts[0]!;
    const body = Buffer.from(JSON.stringify(model));
    const rawBody = Buffer.from(raw.payload.responseText);
    const parsed = { objectName: "parsed/attempt1.json", payload: {
      ...raw.payload, rawAttemptEvidenceObjectName: raw.objectName, parsed: structuredClone(model),
      parsedBytes: body.byteLength, parsedSha256: createHash("sha256").update(body).digest("hex"),
      rawResponseBytes: rawBody.byteLength, rawResponseSha256: createHash("sha256").update(rawBody).digest("hex"),
    } };
    expect(reconcileNativeProbeParsedAttempt(raw, [parsed]).status).toBe("matched");
    expect(reconcileNativeProbeParsedAttempt(raw, []).status).toBe("failed");
    parsed.payload.parsed.shots[0]!.actionZh = "改写";
    expect(reconcileNativeProbeParsedAttempt(raw, [parsed]).status).toBe("failed");
  });
  it("转义信封中的thought标记不能被外层JSON正则漏掉", () => {
    const responseText = JSON.stringify({ candidates: [{ content: { parts: [{ text: "思考", thought: true }] } }] });
    expect(nativeProbeHasThoughtLeak({ responseText })).toBe(true);
    expect(nativeProbeHasThoughtLeak(fixture().rawFacts[0]!.payload)).toBe(false);
  });
  it("同毫秒顺序结束再开始，不得虚增并发", () => {
    const rows = [
      { callId: "a", status: "started" }, { callId: "a", status: "completed" },
      { callId: "b", status: "started" }, { callId: "b", status: "completed" },
    ].map((row) => ({ ...row, stage: "visual_model", observedAtMs: 1 }));
    expect(measureNativeProbeConcurrency(rows)).toEqual({ peak: 1, callCount: 2, errorsZh: [] });
    expect(measureNativeProbeConcurrency([...rows, rows[3]!]).errorsZh).toHaveLength(1);
    expect(measureNativeProbeConcurrency(rows.slice(0, 3)).errorsZh).toHaveLength(1);
  });
  it("相同来源与内容通过，运行器诊断不改模型正文", () => {
    const input = fixture();
    input.entry.raw.advisories = [{ code: "test" }];
    expect(reconcileNativeProbeSegment(input).equal).toBe(true);
  });
  it("镜头数量相同但动作被改写不能通过", () => {
    const input = fixture();
    input.entry.raw.shots = [{ ...model.shots[0], actionZh: "挥手" }];
    expect(reconcileNativeProbeSegment(input)).toMatchObject({ equal: false, reasonZh: expect.stringContaining("内容不一致") });
  });
  it.each(["seriesKey", "sourceDigest", "segmentIndex", "startSec", "endSec", "episodeIndex", "fingerprint"])("拒绝错位身份 %s", (key) => {
    const input = fixture();
    (input.entry as Record<string, unknown>)[key] = "wrong";
    expect(reconcileNativeProbeSegment(input).equal).toBe(false);
  });
  it("不能用另一发数量相同的 raw 替代指定对象", () => {
    const input = fixture();
    input.rawFacts[0]!.objectName = "raw/attempt-2.json";
    expect(reconcileNativeProbeSegment(input).equal).toBe(false);
  });
  it("重复指针与缺失指针都拒绝", () => {
    const input = fixture();
    input.rawFacts.push(input.rawFacts[0]!);
    expect(reconcileNativeProbeSegment(input).equal).toBe(false);
    input.rawFacts = [];
    expect(reconcileNativeProbeSegment(input).equal).toBe(false);
  });
  it("拼接所有非thought正文，不混入思考分片", () => {
    const responseText = JSON.stringify({ candidates: [{ content: { parts: [
      { text: "内部内容", thought: true }, { text: '{"shots":' }, { text: "[]}" },
    ] } }] });
    expect(extractNativeProbeModelJson({ responseText })).toEqual({ shots: [] });
  });
  it("MAX_TOKENS前缀使用生产解析器，普通STOP坏JSON仍失败", () => {
    const candidate = { finishReason: "MAX_TOKENS", content: { parts: [{ text: '{"shots":[{"startSec":0,"endSec":10},{"startSec":' }] } };
    expect(extractNativeProbeModelJson({ responseText: JSON.stringify({ candidates: [candidate] }) })).toEqual({ shots: [{ startSec: 0, endSec: 10 }] });
    candidate.finishReason = "STOP";
    expect(() => extractNativeProbeModelJson({ responseText: JSON.stringify({ candidates: [candidate] }) })).toThrow();
  });
});

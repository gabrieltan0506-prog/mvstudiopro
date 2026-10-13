import { SubmitRejectedError } from "./submitOutcomeErrors";
import { describe, expect, it, vi } from "vitest";
import { assertWavespeedVoiceOutputUrl, synthesizeWavespeedVoice, WavespeedVoicePendingError, type WavespeedVoiceDeps } from "./wavespeedVoice";

const voice = `wsqwen_${"a".repeat(48)}`;
const input = { input: "别怕，有我在。我们会一起找到回家的路。", voice, operationId: "dlg-test", ownerUserId: 7,
  voiceDesign: { labelZh: "阿菁", description: "年轻女性，清亮而温柔的声音" } };
function harness() {
  const rows = new Map<string, { digest: string; output: any; updatedAt: Date }>();
  const deps: WavespeedVoiceDeps = {
    load: vi.fn(async id => rows.get(id) || null),
    claim: vi.fn(async (id, user, digest) => { if (rows.has(id)) return false; rows.set(id, { digest, output: { stage: "submitting" }, updatedAt: new Date() }); return true; }),
    save: vi.fn(async (id, user, output) => { const row = rows.get(id)!; if (!row.output.result) rows.set(id, { ...row, output }); }),
    reference: vi.fn(async () => ({ gcsUri: "gs://test-bucket/fixed-sample.wav", text: "固定参考文字" })),
    submit: vi.fn(async () => ({ predictionId: "test-prediction" })),
    poll: vi.fn(async () => ({ state: "completed" as const, sourceUrl: "https://d2h7xmz5gqybh9.cloudfront.net/test.wav" })),
    readAudio: vi.fn(async () => Buffer.from("test-audio")),
    inspect: vi.fn(async () => ({ accepted: true as const, durationSeconds: 5, voicedSeconds: 4, voicedRatio: .8, voiceRegions: [{ start: 0, end: 4 }] })),
    normalize: vi.fn(async () => ({ buffer: Buffer.from("test-canonical"), durationSec: 5 })),
    upload: vi.fn(async () => ({ gcsUri: "gs://test-bucket/persisted.wav" })) as any,
    sign: vi.fn(uri => `https://signed.invalid/${encodeURIComponent(uri)}`),
  };
  return { rows, deps };
}
describe("固定声样设计与克隆", () => {
  it("设计只提交一次，固定请求恢复原声样", async () => {
    const { deps } = harness();
    const first = await synthesizeWavespeedVoice(input, deps);
    const second = await synthesizeWavespeedVoice(input, deps);
    expect(first.generationId).toBe(second.generationId);
    expect(deps.submit).toHaveBeenCalledTimes(1);
    expect(deps.submit).toHaveBeenCalledWith("/api/v3/wavespeed-ai/qwen3-tts/voice-design", { text: input.input, voice_description: input.voiceDesign.description, language: "Chinese" }, "声线合成");
    expect(deps.reference).not.toHaveBeenCalled();
  });
  it("后续不同场景对白只使用同一已保存声样，不再设计", async () => {
    const { deps } = harness();
    const clone = { ...input, voiceDesign: undefined };
    await synthesizeWavespeedVoice(clone, deps);
    await synthesizeWavespeedVoice({ ...clone, input: "我在河边等你。", operationId: "dlg-second-scene" }, deps);
    expect(deps.reference).toHaveBeenCalledWith(7, voice);
    const calls = vi.mocked(deps.submit).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls.every(([path]) => path.endsWith("voice-clone"))).toBe(true);
    expect(calls[0][1].audio).toBe(calls[1][1].audio);
    expect(calls[1][1].reference_text).toBe("固定参考文字");
    expect(calls[1][1]).not.toHaveProperty("voice_description");
  });
  it("排队和转存失败恢复只查原prediction", async () => {
    const { deps } = harness();
    vi.mocked(deps.poll).mockResolvedValueOnce({ state: "running", status: "processing" });
    await expect(synthesizeWavespeedVoice(input, deps)).rejects.toBeInstanceOf(WavespeedVoicePendingError);
    vi.mocked(deps.upload).mockRejectedValueOnce(new Error("test upload unavailable"));
    await expect(synthesizeWavespeedVoice(input, deps)).rejects.toBeInstanceOf(WavespeedVoicePendingError);
    await expect(synthesizeWavespeedVoice(input, deps)).resolves.toMatchObject({ voice, generationId: "test-prediction" });
    expect(deps.submit).toHaveBeenCalledTimes(1);
    expect(vi.mocked(deps.poll).mock.calls.every(([id]) => id === "test-prediction")).toBe(true);
  });
  it("查询权限暂时异常只重查原单，不把已提交任务当作生成失败", async () => {
    const { deps } = harness();
    vi.mocked(deps.poll).mockResolvedValueOnce({ state: "failed", error: "Wan 3.0 查询被拒 HTTP 403(不可重试)" });
    await expect(synthesizeWavespeedVoice(input, deps)).rejects.toBeInstanceOf(WavespeedVoicePendingError);
    await expect(synthesizeWavespeedVoice(input, deps)).resolves.toMatchObject({ generationId: "test-prediction" });
    expect(deps.submit).toHaveBeenCalledTimes(1);
  });
  it("明确拒绝不重发，保存failed回执", async () => {
    const { deps, rows } = harness();
    vi.mocked(deps.submit).mockRejectedValue(new SubmitRejectedError("test rejection"));
    await expect(synthesizeWavespeedVoice(input, deps)).rejects.toThrow("明确拒绝");
    await expect(synthesizeWavespeedVoice(input, deps)).rejects.toThrow("未通过");
    expect(Array.from(rows.values())[0].output.stage).toBe("failed");
    expect(deps.submit).toHaveBeenCalledTimes(1);
  });
  it("提交结果未知后不重发", async () => {
    const { deps } = harness();
    vi.mocked(deps.submit).mockRejectedValue(new Error("test network unknown"));
    await expect(synthesizeWavespeedVoice(input, deps)).rejects.toThrow("待核对");
    await expect(synthesizeWavespeedVoice(input, deps)).rejects.toThrow("人工核对");
    expect(deps.submit).toHaveBeenCalledTimes(1);
    expect(deps.poll).not.toHaveBeenCalled();
  });
  it("同号修改声线描述或文字拒绝", async () => {
    const { deps } = harness();
    await synthesizeWavespeedVoice(input, deps);
    await expect(synthesizeWavespeedVoice({ ...input, input: "另一句台词" }, deps)).rejects.toThrow("不同内容");
    expect(deps.submit).toHaveBeenCalledTimes(1);
  });
  it("别人的声线在提交前拒绝", async () => {
    const { deps } = harness();
    vi.mocked(deps.reference).mockRejectedValue(new Error("不属于当前账号"));
    await expect(synthesizeWavespeedVoice({ ...input, voiceDesign: undefined }, deps)).rejects.toThrow("不属于");
    expect(deps.claim).not.toHaveBeenCalled();
    expect(deps.submit).not.toHaveBeenCalled();
  });
  it("短于3秒的设计声样不入库也不自动重建", async () => {
    const { deps } = harness();
    vi.mocked(deps.normalize).mockResolvedValue({ buffer: Buffer.from("test"), durationSec: 1 });
    await expect(synthesizeWavespeedVoice(input, deps)).rejects.toThrow("3–15秒");
    await expect(synthesizeWavespeedVoice(input, deps)).rejects.toThrow("未通过");
    expect(deps.upload).not.toHaveBeenCalled();
    expect(deps.submit).toHaveBeenCalledTimes(1);
  });
  it("8个并发调用只提交一个供应商任务", async () => {
    const { deps } = harness();
    await Promise.allSettled(Array.from({ length: 8 }, () => synthesizeWavespeedVoice(input, deps)));
    expect(deps.submit).toHaveBeenCalledTimes(1);
  });
  it.each(["http://wavespeed.ai/a", "https://evil.invalid/a", "https://wavespeed.ai.evil.invalid/a", "https://x@wavespeed.ai/a", "https://wavespeed.ai:8080/a"])("拒绝非供应商下载地址 %s", url => {
    expect(() => assertWavespeedVoiceOutputUrl(url)).toThrow();
  });
});

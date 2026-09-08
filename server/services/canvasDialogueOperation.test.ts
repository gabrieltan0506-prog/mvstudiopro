import { describe, expect, it, vi } from "vitest";
import { canvasDialogueInputSchema, canvasDialogueJobId, generateCanvasDialogue, getCanvasDialogue,
  type CanvasDialogueDeps, type CanvasDialogueInput, type CanvasDialogueRecord } from "./canvasDialogueOperation";

const input: CanvasDialogueInput = { billingRequestId: "12345678-1234-4123-8123-123456789abc",
  input: "[serious]别怕，站我身后。", voice: "longanlufeng", speakerZh: "墨屠", voiceStateZh: "变身后" };
const upstream = { gcsUri: "gs://test-bucket/original.mp3", audioUrl: "https://example.invalid/audio", bytes: 4312,
  voice: input.voice, provider: "openrouter" as const, generationId: "test-generation",
  voiceGate: { accepted: true as const, durationSeconds: 2.8, voicedSeconds: 2.1, voicedRatio: .75,
    voiceRegions: [{ start: .2, end: 2.3 }] } };
function harness() {
  const records = new Map<string, CanvasDialogueRecord>();
  const deps: CanvasDialogueDeps = {
    load: vi.fn(async (id, uid) => { const row = records.get(id); return row?.userId === String(uid) ? structuredClone(row) : null; }),
    claim: vi.fn(async row => { if (records.has(row.id)) return false; records.set(row.id, structuredClone(row)); return true; }),
    save: vi.fn(async (id, uid, output, succeeded) => {
      const row = records.get(id)!;
      if (row.userId !== String(uid)) throw new Error("wrong owner");
      if (row.status === "succeeded") return;
      records.set(id, { ...row, output: structuredClone(output), status: succeeded ? "succeeded" : row.status, updatedAt: new Date() });
    }),
    balance: vi.fn(async () => 100),
    synthesize: vi.fn(async () => upstream),
    mirror: vi.fn(async (source, uid, id) => ({ gcsUri: `gs://test-bucket/post-prod/${uid}/dialogue/${id}.mp3`,
      bytes: source.bytes, voice: source.voice, voiceGate: source.voiceGate, provider: source.provider })),
    charge: vi.fn(async () => {}),
    sign: vi.fn(uri => `https://example.invalid/preview?object=${encodeURIComponent(uri)}`),
  };
  return { records, deps };
}

describe("逐句配音持久操作", () => {
  it("一条真实输入独立生成、保留角色状态和验声，成功才结算", async () => {
    const { deps, records } = harness();
    const result = await generateCanvasDialogue(7, input, deps);
    expect(result.status).toBe("succeeded");
    expect(result.canResumeSettlement).toBe(false);
    expect(result.result?.bytes).toBe(4312);
    expect(result.result?.voiceGate.durationSeconds).toBe(2.8);
    expect(result.result?.gcsUri).toContain("post-prod/7/dialogue/");
    expect(result.voiceStateZh).toBe("变身后");
    expect(deps.synthesize).toHaveBeenCalledWith(expect.objectContaining({ input: input.input, voice: input.voice, ownerUserId: 7 }));
    expect(deps.synthesize).not.toHaveBeenCalledWith(expect.objectContaining({ input: expect.stringContaining("变身后") }));
    expect(deps.charge).toHaveBeenCalledWith(7, input.billingRequestId);
    expect(records.values().next().value?.output?.upstream?.gcsUri).toBe(upstream.gcsUri);
  });
  it("相同编号并发只抢占一次，不会重复合成", async () => {
    const { deps } = harness();
    await Promise.all(Array.from({ length: 8 }, () => generateCanvasDialogue(7, input, deps)));
    expect(deps.synthesize).toHaveBeenCalledTimes(1);
    const recovered = await generateCanvasDialogue(7, input, deps);
    expect(recovered.status).toBe("succeeded");
    expect(deps.synthesize).toHaveBeenCalledTimes(1);
  });
  it.each(["input", "voice", "speakerZh", "voiceStateZh"] as const)("同号修改 %s 必须冲突", async field => {
    const { deps } = harness();
    await generateCanvasDialogue(7, input, deps);
    await expect(generateCanvasDialogue(7, { ...input, [field]: "另一个值" }, deps)).rejects.toThrow("编号");
    expect(deps.synthesize).toHaveBeenCalledTimes(1);
  });
  it("未知上游结果不自动重发，也不声称未扣费", async () => {
    const { deps } = harness();
    deps.synthesize = vi.fn(async () => { throw new Error("network lost after started"); });
    const first = await generateCanvasDialogue(7, input, deps);
    const second = await generateCanvasDialogue(7, input, deps);
    expect(first.status).toBe("reconcile_manual");
    expect(second.status).toBe("reconcile_manual");
    expect(second.canResumeSettlement).toBe(false);
    expect(second.message).not.toContain("未扣费");
    expect(deps.synthesize).toHaveBeenCalledTimes(1);
    expect(deps.charge).not.toHaveBeenCalled();
  });
  it("验声拒收不复制、不结算", async () => {
    const { deps } = harness();
    deps.synthesize = vi.fn(async () => ({ ...upstream, voiceGate: { ...upstream.voiceGate, accepted: false as const, reason: "no_effective_voice" as const } }));
    expect((await generateCanvasDialogue(7, input, deps)).status).toBe("reconcile_manual");
    expect(deps.mirror).not.toHaveBeenCalled();
    expect(deps.charge).not.toHaveBeenCalled();
  });
  it("镜像失败后沿同一原音频恢复，不重烧", async () => {
    const { deps } = harness();
    const mirror = deps.mirror;
    deps.mirror = vi.fn().mockRejectedValueOnce(new Error("storage unavailable")).mockImplementation(mirror);
    const pending = await generateCanvasDialogue(7, input, deps);
    expect(pending.status).toBe("reconcile_manual");
    expect(pending.canResumeSettlement).toBe(true);
    expect((await getCanvasDialogue(7, input.billingRequestId, deps))?.canResumeSettlement).toBe(true);
    expect(deps.charge).not.toHaveBeenCalled();
    expect((await generateCanvasDialogue(7, input, deps)).status).toBe("succeeded");
    expect(deps.synthesize).toHaveBeenCalledTimes(1);
  });
  it("扣费结果未知仅使用同一结算键重查，不重新合成", async () => {
    const { deps } = harness();
    deps.charge = vi.fn().mockRejectedValueOnce(new Error("billing response lost")).mockResolvedValue(undefined);
    expect((await generateCanvasDialogue(7, input, deps)).status).toBe("reconcile_manual");
    expect((await generateCanvasDialogue(7, input, deps)).status).toBe("succeeded");
    expect(deps.synthesize).toHaveBeenCalledTimes(1);
    expect(deps.mirror).toHaveBeenCalledTimes(1);
    expect(deps.charge).toHaveBeenNthCalledWith(2, 7, input.billingRequestId);
  });
  it("回执写入失败只重试保存，不调用第二次上游", async () => {
    const { deps } = harness();
    const save = deps.save;
    deps.save = vi.fn().mockRejectedValueOnce(new Error("database unavailable")).mockImplementation(save);
    expect((await generateCanvasDialogue(7, input, deps)).status).toBe("succeeded");
    expect(deps.synthesize).toHaveBeenCalledTimes(1);
  });
  it("余额不足不能占位或调用上游", async () => {
    const { deps } = harness();
    deps.balance = vi.fn(async () => 2);
    await expect(generateCanvasDialogue(7, input, deps)).rejects.toThrow("3 积分");
    expect(deps.claim).not.toHaveBeenCalled();
    expect(deps.synthesize).not.toHaveBeenCalled();
  });
  it("跨用户相同确认号互不泄露，查询不执行合成", async () => {
    const { deps } = harness();
    await generateCanvasDialogue(7, input, deps);
    expect(await getCanvasDialogue(8, input.billingRequestId, deps)).toBeNull();
    expect((await getCanvasDialogue(7, input.billingRequestId, deps))?.result?.bytes).toBe(4312);
    expect(canvasDialogueJobId(7, input.billingRequestId)).not.toBe(canvasDialogueJobId(8, input.billingRequestId));
    expect(deps.synthesize).toHaveBeenCalledTimes(1);
  });
  it("空台词、超长状态与客户端额外URL在入口拒绝", () => {
    expect(canvasDialogueInputSchema.safeParse({ ...input, input: " " }).success).toBe(false);
    expect(canvasDialogueInputSchema.safeParse({ ...input, voiceStateZh: "字".repeat(201) }).success).toBe(false);
    expect(canvasDialogueInputSchema.safeParse({ ...input, audioUrl: "https://example.invalid" }).success).toBe(false);
  });
  it("未知表演控制在余额检查和上游调用前拒绝", async () => {
    const { deps } = harness();
    await expect(generateCanvasDialogue(7, { ...input, input: "[变得有气势]别怕。" }, deps)).rejects.toThrow("支持范围");
    expect(deps.balance).not.toHaveBeenCalled();
    expect(deps.synthesize).not.toHaveBeenCalled();
  });
  it("阶段名不朗读，两个阶段各自所选音色与表演原样进入真实合成调用", async () => {
    const { deps } = harness();
    await generateCanvasDialogue(7, { ...input, voiceStateZh: "变身前", voice: "longanlingxin", input: "[tired]别怕。" }, deps);
    await generateCanvasDialogue(7, { ...input, billingRequestId: "12345678-1234-4123-8123-123456789abd", voiceStateZh: "变身后", voice: "longanlufeng", input: "[serious][empathetic]别怕。" }, deps);
    expect(deps.synthesize).toHaveBeenNthCalledWith(1, expect.objectContaining({ voice: "longanlingxin", input: "[tired]别怕。" }));
    expect(deps.synthesize).toHaveBeenNthCalledWith(2, expect.objectContaining({ voice: "longanlufeng", input: "[serious][empathetic]别怕。" }));
  });
});

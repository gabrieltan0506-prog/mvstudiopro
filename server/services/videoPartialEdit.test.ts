import { describe, expect, it, vi } from "vitest";
import {
  queueVideoPartialEdit,
  quoteVideoPartialEdit,
  renderVideoPartialEdit,
  videoPartialEditTaskId,
  VIDEO_PARTIAL_EDIT_FAILED_MESSAGE,
  type VideoPartialEditQueueDeps,
  type VideoPartialEditRenderDeps,
} from "./videoPartialEdit";
import { videoPartialEditJobSchema } from "../../shared/videoEditPricing";

const USER = "42";
const REQ = "11111111-2222-4333-8444-555555555555";
const OWN = "gs://bucket/canvas/u42/clip.mp4";

function queueDeps(over: Partial<VideoPartialEditQueueDeps> = {}) {
  const rows = new Map<string, any>();
  const evidence = new Map<string, unknown>();
  const deps: VideoPartialEditQueueDeps & { rows: typeof rows; evidence: typeof evidence } = {
    rows, evidence,
    resolveSource: vi.fn(async (_u: string, s: string) => {
      if (s.includes("someone-else")) throw new Error("该素材未登记到你的账户");
      return s.startsWith("gs://") ? s : `gs://bucket/canvas/u42/${s.split("/").pop()}`;
    }),
    probeSource: vi.fn(async () => ({ durationSec: 20, width: 1280, height: 720, fps: 24, hasAudio: true })),
    load: vi.fn(async (id: string) => rows.get(id) ?? null),
    insert: vi.fn(async (id: string, userId: string, input: unknown) => { rows.set(id, { id, userId, type: "post_prod", status: "queued", input }); }),
    deduct: vi.fn(async (_u: number, amount: number) => ({ success: true, cost: amount, source: "personal" })),
    refund: vi.fn(async () => {}),
    writeEvidence: vi.fn(async (name: string, value: unknown) => { if (!evidence.has(name)) evidence.set(name, value); }),
    ...over,
  };
  return deps;
}
const request = (over: Record<string, unknown> = {}) => ({ sourceUrl: OWN, startSec: 10, endSec: 11, promptZh: "把杯子换成红色", requestId: REQ, expectedCredits: 60, ...over });

describe("报价与下单", () => {
  it("报价只读：不扣费、不建任务；<4s 自动扩展并按实际提交时长计价", async () => {
    const deps = queueDeps();
    const q = await quoteVideoPartialEdit(USER, false, { sourceUrl: OWN, startSec: 10, endSec: 11 }, deps);
    expect(q).toMatchObject({ startSec: 8.5, endSec: 12.5, segmentSec: 4, expanded: true, credits: 60 });
    expect(deps.deduct).not.toHaveBeenCalled();
    expect(deps.insert).not.toHaveBeenCalled();
  });
  it("归属核验：他人素材（原片或参考图）拒绝且不扣费", async () => {
    const deps = queueDeps();
    await expect(queueVideoPartialEdit(USER, false, request({ sourceUrl: "https://x/someone-else.mp4" }), deps)).rejects.toThrow("未登记");
    await expect(queueVideoPartialEdit(USER, false, request({ referenceImageUrls: ["gs://bucket/someone-else.png"] }), deps)).rejects.toThrow("未登记");
    expect(deps.deduct).not.toHaveBeenCalled();
  });
  it("价格与确认价不一致拒绝且不扣费", async () => {
    const deps = queueDeps();
    await expect(queueVideoPartialEdit(USER, false, request({ expectedCredits: 30 }), deps)).rejects.toThrow("价格已变化");
    expect(deps.deduct).not.toHaveBeenCalled();
  });
  it("预扣用 chargeKey=requestId 幂等；同 requestId 重试返回原任务不再扣", async () => {
    const deps = queueDeps();
    const first = await queueVideoPartialEdit(USER, false, request(), deps);
    expect(first).toMatchObject({ jobId: videoPartialEditTaskId(USER, REQ), credits: 60, segmentSec: 4, expanded: true });
    expect(deps.deduct).toHaveBeenCalledWith(42, 60, expect.stringContaining("视频局部修改"), `videoPartialEdit/42/${REQ}`);
    const again = await queueVideoPartialEdit(USER, false, request(), deps);
    expect(again.jobId).toBe(first.jobId);
    expect(deps.deduct).toHaveBeenCalledTimes(1);
    expect(Array.from(deps.evidence.keys()).some(k => k.endsWith("/request.json"))).toBe(true);
  });
  it("管理员免扣：报价 0", async () => {
    const deps = queueDeps();
    const r = await queueVideoPartialEdit(USER, true, request({ expectedCredits: 0 }), deps);
    expect(r.credits).toBe(0);
  });
  it("入库失败当场全额退款", async () => {
    const deps = queueDeps({ insert: vi.fn(async () => { throw new Error("db down"); }) });
    await expect(queueVideoPartialEdit(USER, false, request(), deps)).rejects.toThrow("积分已退回");
    expect(deps.refund).toHaveBeenCalledWith(42, 60, expect.any(String), `refund/videoPartialEdit/42/${REQ}`);
  });
});

function job(over: Record<string, unknown> = {}) {
  return videoPartialEditJobSchema.parse({
    action: "video_partial_edit", requestId: REQ,
    params: { videoUri: OWN, referenceImageUris: ["gs://bucket/canvas/u42/ref.png"], promptZh: "换背景", sourceDurationSec: 20, startSec: 8.5, endSec: 12.5,
      segmentSec: 4, expanded: true, width: 1280, height: 720, fps: 24, hasAudio: true, charge: { credits: 60, chargeKey: `videoPartialEdit/42/${REQ}`, source: "personal" }, ...over },
  });
}
function renderDeps(run: VideoPartialEditRenderDeps["runVideoEditWithFallback"]) {
  const evidence = new Map<string, unknown>();
  const deps: VideoPartialEditRenderDeps & { evidence: typeof evidence } = {
    evidence,
    runVideoEditWithFallback: vi.fn(run),
    cutSegment: vi.fn(async () => ({ url: "https://signed/segment.mp4", gcsUri: "gs://bucket/post-prod/42/seg.mp4", filePath: "/tmp/seg.mp4" })),
    restoreSegmentAudio: vi.fn(async () => ({ gcsUri: "gs://bucket/post-prod/42/edited.mp4", durationSec: 4 })),
    concat: vi.fn(async (params) => ({ gcsUri: "gs://bucket/post-prod/42/out.mp4", url: "https://signed/out.mp4", bytes: 1, durationSec: params.totalSec })),
    signRead: vi.fn((u: string) => `https://signed/${u.split("/").pop()}`),
    refund: vi.fn(async () => {}),
    writeEvidence: vi.fn(async (name: string, value: unknown) => { evidence.set(name, value); }),
  };
  return deps;
}

describe("worker：通道回落、拼回、退款", () => {
  it("BytePlus 真人拒绝 → EvoLink 接手；拒绝码与零扣费进 debug 和证据；拼回总时长不变", async () => {
    // 通道替身：模拟 R3 runVideoEditWithFallback 先拒后回落的回执形状
    const deps = renderDeps(async () => ({
      videoUrl: "https://signed/edited.mp4", channel: "evolink", providerTaskId: "task-1",
      attempts: [
        { channel: "byteplus", rawReceipt: { error: { code: "InputImageSensitiveContentDetected.PrivacyInformation" } }, parsed: { rejected: true }, rejectionCode: "InputImageSensitiveContentDetected.PrivacyInformation", upstreamCharged: false },
        { channel: "evolink", rawReceipt: { id: "task-1" }, parsed: { status: "completed" }, upstreamCharged: true },
      ],
    }));
    const out = await renderVideoPartialEdit(job(), USER, "vpe_x", new AbortController().signal, deps);
    expect(deps.runVideoEditWithFallback).toHaveBeenCalledWith(expect.objectContaining({ segmentUrl: "https://signed/segment.mp4", segmentSec: 4, aspectRatio: "16:9", referenceImageUrls: ["https://signed/ref.png"] }));
    expect(out.debug.channel).toBe("evolink");
    expect(out.debug.attempts[0]).toMatchObject({ channel: "byteplus", rejectionCode: "InputImageSensitiveContentDetected.PrivacyInformation", upstreamCharged: false });
    expect(out.durationSec).toBeCloseTo(20, 6);
    expect(out.originalUri).toBe(OWN);
    const concatParams = (deps.concat as any).mock.calls[0][0];
    expect(concatParams.clips).toEqual([OWN, "gs://bucket/post-prod/42/edited.mp4", OWN]);
    expect(concatParams.trims).toEqual([{ startSec: 0, endSec: 8.5 }, { startSec: 0, endSec: 4 }, { startSec: 12.5, endSec: 20 }]);
    const keys = Array.from(deps.evidence.keys());
    for (const k of ["attempt-1-byteplus-raw.json", "attempt-1-byteplus-parsed.json", "attempt-2-evolink-raw.json", "attempt-2-evolink-parsed.json", "result.json"])
      expect(keys.some(n => n.endsWith(k))).toBe(true);
    expect(deps.refund).not.toHaveBeenCalled();
  });
  it("两条通道都拒绝 → 全额退款、中性文案、回执留证", async () => {
    const deps = renderDeps(async () => {
      throw Object.assign(new Error("EvoLink rejected: content policy"), { kind: "rejected", attempts: [
        { channel: "byteplus", rawReceipt: { e: 1 }, parsed: {}, rejectionCode: "PrivacyInformation", upstreamCharged: false },
        { channel: "evolink", rawReceipt: { e: 2 }, parsed: {}, rejectionCode: "content_policy", upstreamCharged: false },
      ] });
    });
    await expect(renderVideoPartialEdit(job(), USER, "vpe_x", new AbortController().signal, deps)).rejects.toThrow(VIDEO_PARTIAL_EDIT_FAILED_MESSAGE);
    expect(VIDEO_PARTIAL_EDIT_FAILED_MESSAGE).not.toMatch(/evolink|byteplus|seedance/i);
    expect(deps.refund).toHaveBeenCalledWith(42, 60, expect.any(String), `refund/videoPartialEdit/42/${REQ}`);
    const keys = Array.from(deps.evidence.keys());
    expect(keys.filter(k => k.endsWith("-raw.json"))).toHaveLength(2);
    expect(keys.filter(k => k.endsWith("-parsed.json"))).toHaveLength(2);
    expect(keys.some(k => k.endsWith("/refund.json"))).toBe(true);
    expect(deps.concat).not.toHaveBeenCalled();
  });
  it("拼回失败也全额退款；管理员免扣单不发退款但留记录", async () => {
    const ok = async () => ({ videoUrl: "https://signed/e.mp4", channel: "byteplus", attempts: [] });
    const deps = renderDeps(ok);
    deps.concat = vi.fn(async () => { throw new Error("ffmpeg exit 1"); });
    await expect(renderVideoPartialEdit(job(), USER, "vpe_x", new AbortController().signal, deps)).rejects.toThrow(VIDEO_PARTIAL_EDIT_FAILED_MESSAGE);
    expect(deps.refund).toHaveBeenCalledTimes(1);
    const admin = renderDeps(ok);
    admin.concat = vi.fn(async () => { throw new Error("x"); });
    await expect(renderVideoPartialEdit(job({ charge: { credits: 0, chargeKey: "k", source: "admin" } }), USER, "vpe_y", new AbortController().signal, admin)).rejects.toThrow();
    expect(admin.refund).not.toHaveBeenCalled();
    expect((admin.evidence.get("post-prod/42/video-edit-evidence/vpe_y/refund.json") as any).refunded).toBe(false);
  });
  it("上游结果未知不自动退款（待核对），避免出片后变免费", async () => {
    const deps = renderDeps(async () => { throw Object.assign(new Error("timeout"), { kind: "unknown" }); });
    await expect(renderVideoPartialEdit(job(), USER, "vpe_x", new AbortController().signal, deps)).rejects.toThrow("待核对");
    expect(deps.refund).not.toHaveBeenCalled();
  });
  it("拼回后总时长偏离原片即判失败并退款", async () => {
    const deps = renderDeps(async () => ({ videoUrl: "https://signed/e.mp4", channel: "byteplus" }));
    deps.concat = vi.fn(async () => ({ gcsUri: "g", url: "u", bytes: 1, durationSec: 18 }));
    await expect(renderVideoPartialEdit(job(), USER, "vpe_x", new AbortController().signal, deps)).rejects.toThrow(VIDEO_PARTIAL_EDIT_FAILED_MESSAGE);
    expect(deps.refund).toHaveBeenCalled();
  });
});

describe("按 requestId 查任务（只读续查）", () => {
  it("同用户同 requestId 派生同一任务号：查到返回该任务；别人的 / 不存在的返回空；不扣费不入队", async () => {
    const { findVideoPartialEditJobByRequest } = await import("./videoPartialEdit");
    const deps = queueDeps();
    await queueVideoPartialEdit(USER, false, request(), deps);
    vi.mocked(deps.deduct).mockClear();
    const row = await findVideoPartialEditJobByRequest(USER, REQ, deps.load);
    expect(row?.id).toBe(videoPartialEditTaskId(USER, REQ));
    expect(await findVideoPartialEditJobByRequest("43", REQ, deps.load)).toBeNull();
    expect(await findVideoPartialEditJobByRequest(USER, "99999999-2222-4333-8444-555555555555", deps.load)).toBeNull();
    deps.rows.set(videoPartialEditTaskId(USER, REQ), { ...deps.rows.get(videoPartialEditTaskId(USER, REQ)), type: "media_work" });
    expect(await findVideoPartialEditJobByRequest(USER, REQ, deps.load)).toBeNull();
    expect(deps.deduct).not.toHaveBeenCalled();
    expect(deps.insert).toHaveBeenCalledTimes(1);
  });
});

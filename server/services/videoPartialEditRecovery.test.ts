import { describe, expect, it, vi } from "vitest";
import {
  recoverVideoPartialEditJob,
  recoverVideoPartialEditJobsOnce,
  resolveVideoPartialEditUpstream,
  VPE_RECOVERY_LEASE_MS,
  type VpeRecoveryDeps,
  type VpeRecoveryRow,
  type VpeRecoveryState,
  type VpeRecoveryStore,
} from "./videoPartialEditRecovery";
import {
  renderVideoPartialEdit,
  videoPartialEditEvidencePrefix,
  VIDEO_PARTIAL_EDIT_FAILED_MESSAGE,
  VIDEO_PARTIAL_EDIT_PENDING_MESSAGE,
  type VideoPartialEditRenderDeps,
} from "./videoPartialEdit";
import { runVideoEditWithFallback, type VideoEditDeps } from "./videoEditFallback";
import { buildByteplusSeedance25SubmitBody } from "./byteplusSeedanceVideo";
import { buildEvolinkSeedanceRequest } from "./evolinkSeedanceVideo";

const USER = "42";
const JOB = "vpe_recover";
const PREFIX = videoPartialEditEvidencePrefix(USER, JOB);
const T0 = Date.parse("2026-11-10T08:00:00Z");
const input = (charge: Record<string, unknown> = {}) => ({
  action: "video_partial_edit", requestId: "11111111-2222-4333-8444-555555555555",
  params: {
    videoUri: "gs://bucket/canvas/u42/clip.mp4", referenceImageUris: [], promptZh: "把杯子换成红色",
    sourceDurationSec: 20, startSec: 8, endSec: 12, segmentSec: 4, expanded: false,
    width: 1280, height: 720, fps: 24, hasAudio: true,
    charge: { credits: 60, chargeKey: "videoPartialEdit/42/r1", source: "personal", ...charge },
  },
});
const HANDLE = { channel: "evolink" as const, providerTaskId: "ev-1", submittedAt: new Date(T0 - 5 * 60_000).toISOString() };

/** 内存版任务行：与正式实现同一套条件（未结清 + 租约过期/匹配）。 */
function memoryStore(row: VpeRecoveryRow) {
  const state = () => ((row.output as any)?.vpeRecovery ?? {}) as VpeRecoveryState;
  const held = (token: string) => !state().settled && state().leaseToken === token;
  const put = (s: VpeRecoveryState) => { row.output = { ...(row.output as object), vpeRecovery: s }; };
  const store: VpeRecoveryStore = {
    listCandidates: vi.fn(async nowMs => (!state().settled && (state().leaseUntilMs ?? 0) < nowMs && row.status !== "succeeded" ? [{ ...row }] : [])),
    claim: vi.fn(async (_id, token, nowMs) => {
      if (state().settled || (state().leaseUntilMs ?? 0) >= nowMs || row.status === "succeeded") return null;
      put({ ...state(), leaseToken: token, leaseUntilMs: nowMs + VPE_RECOVERY_LEASE_MS });
      return { ...row };
    }),
    renew: vi.fn(async (_id, token, nowMs) => { if (!held(token)) return false; put({ ...state(), leaseUntilMs: nowMs + VPE_RECOVERY_LEASE_MS }); return true; }),
    release: vi.fn(async (_id, token, s) => { if (!held(token)) return false; put(s); return true; }),
    settleSucceeded: vi.fn(async (_id, token, output) => { if (!held(token)) return false; row.status = "succeeded"; row.error = null; row.output = output; return true; }),
    settleFailed: vi.fn(async (_id, token, error, s) => { if (!held(token)) return false; row.status = "failed"; row.error = error; put(s); return true; }),
  };
  return store;
}

function setup(over: { output?: Record<string, unknown>; evidence?: Record<string, unknown>; deps?: Partial<VpeRecoveryDeps>; charge?: Record<string, unknown> } = {}) {
  const row: VpeRecoveryRow = { id: JOB, userId: USER, status: "failed", error: VIDEO_PARTIAL_EDIT_PENDING_MESSAGE, input: input(over.charge), output: over.output ?? {}, createdAt: new Date(T0 - 10 * 60_000) };
  const evidence = new Map<string, unknown>(Object.entries(over.evidence ?? {}));
  const render = {
    cutSegment: vi.fn(async () => ({ url: "https://signed/segment.mp4", gcsUri: "gs://bucket/segment.mp4", filePath: "/tmp/segment.mp4" })),
    restoreSegmentAudio: vi.fn(async () => ({ gcsUri: "gs://bucket/restored.mp4", durationSec: 4 })),
    concat: vi.fn(async () => ({ gcsUri: "gs://bucket/final.mp4", url: "https://signed/final.mp4", bytes: 1234, durationSec: 20 })),
  };
  let now = T0;
  const deps: VpeRecoveryDeps = {
    store: memoryStore(row),
    channelReady: () => true,
    poll: vi.fn(async (_h, persist) => {
      await persist({ status: 200, body: JSON.stringify({ id: "ev-1", status: "completed", results: ["https://up/ev.mp4"] }) });
      return { state: "completed" as const, sourceUrl: "https://up/ev.mp4" };
    }),
    mirror: vi.fn(async () => "https://storage.googleapis.com/bucket/mirrored.mp4?sig=1"),
    listEvidence: vi.fn(async (prefix: string) => Array.from(evidence.keys()).filter(k => k.startsWith(`${prefix}/`))),
    readEvidence: vi.fn(async (name: string) => evidence.get(name)),
    writeEvidence: vi.fn(async (name: string, value: unknown) => { if (!evidence.has(name)) evidence.set(name, value); }),
    refund: vi.fn(async () => {}),
    render: vi.fn(async () => render),
    withResources: (_id, signal, work) => work(signal),
    now: () => now,
    signal: new AbortController().signal,
    ...over.deps,
  };
  return { row, evidence, deps, render, advance: (ms: number) => { now += ms; } };
}
const failedPoll = (status = "failed") => vi.fn(async (_h: unknown, persist: (r: { status: number; body: string }) => Promise<void>) => {
  await persist({ status: 200, body: JSON.stringify({ id: "ev-1", status, error: { message: "content rejected" } }) });
  return { state: "failed" as const, error: "content rejected" };
});

describe("局部修改重启续查", () => {
  it("续查拼回同样优先流复制：成功则不走整片重编码；不满足条件回退原路径", async () => {
    const s = setup({ output: { vpeUpstream: HANDLE } });
    const spliceStreamCopy = vi.fn(async () => ({ ok: true as const, gcsUri: "gs://bucket/fast.mp4", url: "https://signed/fast.mp4", bytes: 99, durationSec: 20, editedUri: "gs://bucket/raw.mp4", stats: { minSsim: 0.999 } }));
    Object.assign(s.render, { spliceStreamCopy });
    expect(await recoverVideoPartialEditJob(s.row, s.deps)).toBe("succeeded");
    expect(spliceStreamCopy).toHaveBeenCalledWith(expect.objectContaining({ editedUrl: "https://storage.googleapis.com/bucket/mirrored.mp4?sig=1" }));
    expect(s.render.restoreSegmentAudio).not.toHaveBeenCalled();
    expect(s.render.concat).not.toHaveBeenCalled();
    expect(s.row.output).toMatchObject({ gcsUri: "gs://bucket/fast.mp4", debug: { splice: { path: "stream_copy" } } });

    const f = setup({ output: { vpeUpstream: HANDLE } });
    Object.assign(f.render, { spliceStreamCopy: vi.fn(async () => ({ ok: false as const, reason: "codec_mpeg4" })) });
    expect(await recoverVideoPartialEditJob(f.row, f.deps)).toBe("succeeded");
    expect(f.render.concat).toHaveBeenCalledTimes(1);
    expect(f.row.output).toMatchObject({ gcsUri: "gs://bucket/final.mp4", debug: { splice: { path: "reencode", fallbackReason: "codec_mpeg4" } } });
  });
  it("有任务号且上游已出片 → 替回音轨、拼回、留证、标成功，不退款", async () => {
    const s = setup({ output: { vpeUpstream: HANDLE } });
    expect(await recoverVideoPartialEditJob(s.row, s.deps)).toBe("succeeded");
    expect(s.deps.poll).toHaveBeenCalledWith(HANDLE, expect.any(Function));
    expect(s.render.restoreSegmentAudio).toHaveBeenCalledWith(expect.objectContaining({ editedUrl: "https://storage.googleapis.com/bucket/mirrored.mp4?sig=1", segmentFile: "/tmp/segment.mp4" }));
    expect(s.render.concat).toHaveBeenCalledTimes(1);
    expect(s.deps.refund).not.toHaveBeenCalled();
    expect(s.row).toMatchObject({ status: "succeeded", error: null, output: { gcsUri: "gs://bucket/final.mp4", creditsCharged: 60, vpeRecovery: { settled: "succeeded" } } });
    const names = Array.from(s.evidence.keys());
    expect(names).toContain(`${PREFIX}/result.json`);
    // 终态回执原始与解析分别落盘
    expect(names.filter(n => n.endsWith("-terminal-raw.json"))).toHaveLength(1);
    expect(names.filter(n => n.endsWith("-terminal-parsed.json"))).toHaveLength(1);
    // 再跑一轮：已结清，不重复出片
    expect(await recoverVideoPartialEditJob(s.row, s.deps)).toBe("skipped");
    expect(s.render.concat).toHaveBeenCalledTimes(1);
  });

  it("上游明确失败 → 只退一次，重复恢复不再退", async () => {
    const s = setup({ output: { vpeUpstream: HANDLE }, deps: { poll: failedPoll() } });
    expect(await recoverVideoPartialEditJob(s.row, s.deps)).toBe("refunded");
    expect(s.deps.refund).toHaveBeenCalledTimes(1);
    expect(s.deps.refund).toHaveBeenCalledWith(42, 60, expect.stringContaining("重启续查"), "refund/videoPartialEdit/42/r1");
    expect(s.row).toMatchObject({ status: "failed", error: VIDEO_PARTIAL_EDIT_FAILED_MESSAGE, output: { vpeRecovery: { settled: "refunded" } } });
    expect(s.render.concat).not.toHaveBeenCalled();
    expect(await recoverVideoPartialEditJob(s.row, s.deps)).toBe("skipped");
    expect((await recoverVideoPartialEditJobsOnce(s.deps)).refunded).toBe(0);
    expect(s.deps.refund).toHaveBeenCalledTimes(1);
  });

  it("没有任务号且证据确认未发出请求 → 退一次；不查询上游", async () => {
    const s = setup({ evidence: { [`${PREFIX}/request.json`]: {} } });
    expect(await recoverVideoPartialEditJob(s.row, s.deps)).toBe("refunded");
    expect(s.deps.refund).toHaveBeenCalledTimes(1);
    expect(s.deps.poll).not.toHaveBeenCalled();
    expect(await recoverVideoPartialEditJob(s.row, s.deps)).toBe("skipped");
    expect(s.deps.refund).toHaveBeenCalledTimes(1);
  });

  it("没有任务号但请求已发出且无明确拒绝 → 不退款，保持待核对并留证", async () => {
    const s = setup({ evidence: { [`${PREFIX}/channel/abc-01-evolink-request-raw.json`]: { raw: {} } } });
    expect(await recoverVideoPartialEditJob(s.row, s.deps)).toBe("manual");
    expect(s.deps.refund).not.toHaveBeenCalled();
    expect(s.row).toMatchObject({ status: "failed", error: VIDEO_PARTIAL_EDIT_PENDING_MESSAGE, output: { vpeRecovery: { settled: "manual" } } });
    expect(Array.from(s.evidence.keys()).some(n => n.includes("/recovery/") && n.endsWith("-manual.json"))).toBe(true);
  });

  it("首通道零扣费拒绝后中断（第二通道未发请求）→ 确认无上游单，退款", async () => {
    const s = setup({ evidence: {
      [`${PREFIX}/channel/abc-01-byteplus-request-raw.json`]: { raw: {} },
      [`${PREFIX}/channel/abc-02-byteplus-rejection-parsed.json`]: { parsed: { upstreamCharged: false, zeroCharge: true } },
    } });
    expect(await recoverVideoPartialEditJob(s.row, s.deps)).toBe("refunded");
  });

  it("任务行没写进任务号时，从证据前缀取回任务号续查（旧任务取提交回执）", async () => {
    const s = setup({ evidence: {
      [`${PREFIX}/channel/abc-01-evolink-request-raw.json`]: { raw: {} },
      [`${PREFIX}/channel/abc-02-evolink-submit-raw.json`]: { recordedAt: HANDLE.submittedAt, raw: { status: 200, body: JSON.stringify({ id: "ev-1" }) } },
    } });
    const found = await resolveVideoPartialEditUpstream(s.row, PREFIX, s.deps);
    expect(found).toMatchObject({ kind: "handle", handle: { channel: "evolink", providerTaskId: "ev-1" } });
    expect(await recoverVideoPartialEditJob(s.row, s.deps)).toBe("succeeded");
    expect(s.deps.refund).not.toHaveBeenCalled();
  });

  it("仍在生成：不结算，下一轮继续查同一任务号；超过上限时长转待核对且不退款", async () => {
    const poll = vi.fn(async () => ({ state: "running" as const, status: "processing" }));
    const s = setup({ output: { vpeUpstream: HANDLE }, deps: { poll } });
    expect(await recoverVideoPartialEditJob(s.row, s.deps)).toBe("pending");
    expect(s.row.status).toBe("failed");
    expect((s.row.output as any).vpeRecovery.settled).toBeUndefined();
    s.advance(30_000);
    expect(await recoverVideoPartialEditJob(s.row, s.deps)).toBe("pending");
    expect(poll).toHaveBeenCalledTimes(2);
    s.advance(2 * 60 * 60_000);
    expect(await recoverVideoPartialEditJob(s.row, s.deps)).toBe("manual");
    expect(s.deps.refund).not.toHaveBeenCalled();
    expect(s.row).toMatchObject({ error: VIDEO_PARTIAL_EDIT_PENDING_MESSAGE, output: { vpeRecovery: { settled: "manual", upstream: HANDLE } } });
  });

  it("上游回执不是明确失败（如完成但没有成片地址）→ 不退款，转待核对", async () => {
    const poll = vi.fn(async (_h: unknown, persist: any) => {
      await persist({ status: 200, body: JSON.stringify({ id: "ev-1", status: "completed" }) });
      return { state: "failed" as const, error: "任务完成但未返回视频 URL" };
    });
    const s = setup({ output: { vpeUpstream: HANDLE }, deps: { poll } });
    expect(await recoverVideoPartialEditJob(s.row, s.deps)).toBe("manual");
    expect(s.deps.refund).not.toHaveBeenCalled();
  });

  it("并发恢复同一任务：只处理一次（出片一次 / 退款一次）", async () => {
    const ok = setup({ output: { vpeUpstream: HANDLE } });
    const a = await Promise.all([recoverVideoPartialEditJob(ok.row, ok.deps), recoverVideoPartialEditJob(ok.row, ok.deps), recoverVideoPartialEditJob(ok.row, ok.deps)]);
    expect(a.sort()).toEqual(["skipped", "skipped", "succeeded"]);
    expect(ok.deps.poll).toHaveBeenCalledTimes(1);
    expect(ok.render.concat).toHaveBeenCalledTimes(1);
    expect(ok.deps.refund).not.toHaveBeenCalled();

    const bad = setup({ output: { vpeUpstream: HANDLE }, deps: { poll: failedPoll("cancelled") } });
    const b = await Promise.all([recoverVideoPartialEditJob(bad.row, bad.deps), recoverVideoPartialEditJob(bad.row, bad.deps)]);
    expect(b.sort()).toEqual(["refunded", "skipped"]);
    expect(bad.deps.refund).toHaveBeenCalledTimes(1);
  });

  it("租约被别人接手后不退款、不改终态", async () => {
    const s = setup({ output: { vpeUpstream: HANDLE }, deps: { poll: failedPoll() } });
    (s.deps.store.renew as any).mockResolvedValueOnce(false);
    expect(await recoverVideoPartialEditJob(s.row, s.deps)).toBe("skipped");
    expect(s.deps.refund).not.toHaveBeenCalled();
  });

  it("拼回失败先重试一轮，再失败才全额退款；免扣单不发退款", async () => {
    const s = setup({ output: { vpeUpstream: HANDLE } });
    s.render.concat.mockRejectedValue(new Error("拼接失败"));
    expect(await recoverVideoPartialEditJob(s.row, s.deps)).toBe("pending");
    expect(s.deps.refund).not.toHaveBeenCalled();
    s.advance(30_000);
    expect(await recoverVideoPartialEditJob(s.row, s.deps)).toBe("refunded");
    expect(s.deps.refund).toHaveBeenCalledTimes(1);

    const admin = setup({ charge: { credits: 0, source: "admin" } });
    expect(await recoverVideoPartialEditJob(admin.row, admin.deps)).toBe("refunded");
    expect(admin.deps.refund).not.toHaveBeenCalled();
  });

  it("证据列举失败：不结算、不退款，下一轮再来", async () => {
    const s = setup({ deps: { listEvidence: vi.fn(async () => { throw new Error("gcs_list_failed"); }) } });
    expect(await recoverVideoPartialEditJob(s.row, s.deps)).toBe("pending");
    expect(s.deps.refund).not.toHaveBeenCalled();
    expect((s.row.output as any).vpeRecovery.settled).toBeUndefined();
  });

  it("恢复模块绝不提交：源码不引用任何提交函数", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(new URL("./videoPartialEditRecovery.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/submit(Byteplus|Evolink)|submitByteplusSeedance25Video|submitEvolinkSeedanceVideo|runVideoEditWithFallback/);
  });
});

describe("上游任务号落盘（onUpstreamSubmitted）", () => {
  function channelDeps(over: Partial<VideoEditDeps> = {}): VideoEditDeps {
    let t = 1_000_000;
    return {
      byteplusConfigured: () => false,
      evolinkConfigured: () => true,
      buildByteplusBody: buildByteplusSeedance25SubmitBody,
      buildEvolinkBody: buildEvolinkSeedanceRequest,
      submitByteplus: vi.fn(async () => ({ byteplusTaskId: "bp-1" })),
      pollByteplus: vi.fn(async () => ({ state: "completed" as const, sourceUrl: "https://up/bp.mp4" })),
      submitEvolink: vi.fn(async () => ({ evolinkTaskId: "ev-1" })),
      pollEvolink: vi.fn(async () => ({ state: "completed" as const, sourceUrl: "https://up/ev.mp4" })),
      mirror: vi.fn(async () => "https://storage.googleapis.com/bkt/out.mp4?sig=1"),
      bucket: () => "bkt",
      upload: vi.fn(async () => {}),
      sleep: async () => {},
      now: () => (t += 1000),
      pollIntervalMs: { byteplus: 1, evolink: 1 },
      maxPollMs: { byteplus: 60_000, evolink: 60_000 },
      ...over,
    };
  }
  const channelInput = { segmentUrl: "https://signed/segment.mp4", promptZh: "把杯子换成红色", segmentSec: 4, evidencePrefix: "p/channel" };

  it("通道建单成功后、轮询之前回调任务号，并写进证据前缀", async () => {
    const order: string[] = [];
    const deps = channelDeps({ pollEvolink: vi.fn(async () => { order.push("poll"); return { state: "completed" as const, sourceUrl: "https://up/ev.mp4" }; }) });
    const onUpstreamSubmitted = vi.fn(async () => { order.push("handle"); });
    await runVideoEditWithFallback({ ...channelInput, onUpstreamSubmitted }, deps);
    expect(order).toEqual(["handle", "poll"]);
    expect(onUpstreamSubmitted).toHaveBeenCalledWith(expect.objectContaining({ channel: "evolink", providerTaskId: "ev-1", submittedAt: expect.any(String) }));
    const names = (deps.upload as any).mock.calls.map((c: any[]) => c[0].objectName as string);
    expect(names.some((n: string) => /evolink-upstream-raw\.json$/.test(n))).toBe(true);
    expect(names.some((n: string) => /evolink-upstream-parsed\.json$/.test(n))).toBe(true);
  });

  it("回调失败不打断出片；停机信号已中止时不再向第二通道提交", async () => {
    const deps = channelDeps();
    await expect(runVideoEditWithFallback({ ...channelInput, onUpstreamSubmitted: async () => { throw new Error("db down"); } }, deps)).resolves.toMatchObject({ providerTaskId: "ev-1" });
    const stopped = channelDeps();
    const ac = new AbortController();
    ac.abort();
    await expect(runVideoEditWithFallback({ ...channelInput, signal: ac.signal }, stopped)).rejects.toThrow();
    expect(stopped.submitEvolink).not.toHaveBeenCalled();
  });

  it("renderVideoPartialEdit 把任务号连同任务编号交给注入的回调", async () => {
    const onUpstreamSubmitted = vi.fn(async () => {});
    const deps: VideoPartialEditRenderDeps = {
      runVideoEditWithFallback: vi.fn(async (i: any) => {
        await i.onUpstreamSubmitted?.(HANDLE);
        return { videoUrl: "https://signed/edited.mp4", channel: "evolink", providerTaskId: "ev-1", attempts: [] };
      }),
      cutSegment: vi.fn(async () => ({ url: "https://signed/segment.mp4", gcsUri: "gs://bucket/segment.mp4", filePath: "/tmp/segment.mp4" })),
      restoreSegmentAudio: vi.fn(async () => ({ gcsUri: "gs://bucket/restored.mp4", durationSec: 4 })),
      concat: vi.fn(async () => ({ gcsUri: "gs://bucket/final.mp4", url: "https://signed/final.mp4", bytes: 1, durationSec: 20 })),
      signRead: (u: string) => u,
      refund: vi.fn(async () => {}),
      writeEvidence: vi.fn(async () => {}),
      onUpstreamSubmitted,
    };
    await renderVideoPartialEdit(input(), USER, JOB, new AbortController().signal, deps);
    expect(onUpstreamSubmitted).toHaveBeenCalledWith({ jobId: JOB, userId: USER, handle: HANDLE });
  });
});

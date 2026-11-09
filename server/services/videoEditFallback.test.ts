import { describe, expect, it, vi } from "vitest";
import {
  runVideoEditWithFallback,
  signedGcsUrlToGsUri,
  VideoEditFailedError,
  VIDEO_EDIT_FAILED_ZH,
  type VideoEditDeps,
} from "./videoEditFallback";
import { buildByteplusSeedance25SubmitBody } from "./byteplusSeedanceVideo";
import { buildEvolinkSeedanceRequest } from "./evolinkSeedanceVideo";
import { SubmitRejectedError } from "./submitOutcomeErrors";

const SIGNED = "https://storage.googleapis.com/bkt/growth-camp/videos/out.mp4?X-Goog-Algorithm=GOOG4&X-Goog-Signature=abc";
const PRIVACY_BODY = JSON.stringify({ error: { code: "InputImageSensitiveContentDetected.PrivacyInformation", message: "The request failed because the input image may contain real person." } });

function makeDeps(over: Partial<VideoEditDeps> = {}) {
  const uploads: string[] = [];
  const store = new Map<string, unknown>();
  let t = 1_000_000;
  const deps: VideoEditDeps = {
    byteplusConfigured: () => true,
    evolinkConfigured: () => true,
    buildByteplusBody: buildByteplusSeedance25SubmitBody,
    buildEvolinkBody: buildEvolinkSeedanceRequest,
    submitByteplus: vi.fn(async input => {
      await input.persistSubmitReceipt?.({ status: 200, body: JSON.stringify({ id: "bp-1", status: "queued" }) });
      return { byteplusTaskId: "bp-1" };
    }),
    pollByteplus: vi.fn(async (_id, persist) => {
      await persist({ status: 200, body: JSON.stringify({ id: "bp-1", status: "succeeded", content: { video_url: "https://up/bp.mp4" } }) });
      return { state: "completed" as const, sourceUrl: "https://up/bp.mp4" };
    }),
    submitEvolink: vi.fn(async input => {
      await input.persistSubmitReceipt?.({ status: 200, body: JSON.stringify({ id: "ev-1", status: "pending" }) });
      return { evolinkTaskId: "ev-1" };
    }),
    pollEvolink: vi.fn(async (_id, persist) => {
      await persist({ status: 200, body: JSON.stringify({ id: "ev-1", status: "completed", results: ["https://up/ev.mp4"] }) });
      return { state: "completed" as const, sourceUrl: "https://up/ev.mp4" };
    }),
    mirror: vi.fn(async () => SIGNED),
    bucket: () => "bkt",
    upload: async ({ objectName, buffer }) => {
      if (store.has(objectName)) throw new Error(`overwrite ${objectName}`);
      store.set(objectName, JSON.parse(buffer.toString()));
      uploads.push(objectName);
    },
    sleep: async () => {},
    now: () => (t += 1000),
    pollIntervalMs: { byteplus: 1, evolink: 1 },
    maxPollMs: { byteplus: 60_000, evolink: 60_000 },
    ...over,
  };
  return { deps, uploads, store };
}

const input = {
  segmentUrl: "https://storage.googleapis.com/bkt/seg.mp4?X-Goog-Signature=s",
  promptZh: "把桌上的杯子换成红色",
  referenceImageUrls: ["https://storage.googleapis.com/bkt/k1.png?X-Goog-Signature=s"],
  segmentSec: 4,
  aspectRatio: "9:16",
  evidencePrefix: "video-edit/evidence/7/req-1",
};
const tail = (uploads: string[]) => uploads.map(u => u.replace(/^video-edit\/evidence\/7\/req-1\/[a-z0-9]+-/, ""));

describe("runVideoEditWithFallback", () => {
  it("BytePlus 成功：片段作 reference_video、时长按片段，不碰 EvoLink", async () => {
    const { deps, uploads } = makeDeps();
    const out = await runVideoEditWithFallback(input, deps);
    expect(out.channel).toBe("byteplus");
    expect(out.providerTaskId).toBe("bp-1");
    expect(out.videoUrl).toBe(SIGNED);
    expect(out.videoGsUri).toBe("gs://bkt/growth-camp/videos/out.mp4");
    expect(out.attempts).toHaveLength(1);
    expect(out.attempts[0]).toMatchObject({ channel: "byteplus", upstreamCharged: true, providerTaskId: "bp-1", parsed: { id: "bp-1" } });
    expect(deps.submitEvolink).not.toHaveBeenCalled();
    const sent = vi.mocked(deps.submitByteplus).mock.calls[0]![0];
    expect(sent).toMatchObject({ mode: "reference_to_video", videoUrls: [input.segmentUrl], duration: 4 });
    const body = buildByteplusSeedance25SubmitBody(sent);
    expect(body.model).toBe("dreamina-seedance-2-5-260628");
    expect((body.body.content as Array<{ role?: string }>).some(c => c.role === "reference_video")).toBe(true);
    expect(tail(uploads)).toEqual([
      "01-byteplus-request-raw.json", "01-byteplus-request-parsed.json",
      "02-byteplus-submit-raw.json", "02-byteplus-submit-parsed.json",
      "03-byteplus-terminal-raw.json", "03-byteplus-terminal-parsed.json",
      "04-byteplus-result-raw.json", "04-byteplus-result-parsed.json",
    ]);
  });

  it("PrivacyInformation 拒绝（无任务号）→ 记零扣费 → EvoLink video-edit（duration=-1、带参考图、放宽真人）", async () => {
    const { deps, uploads, store } = makeDeps({
      submitByteplus: vi.fn(async inp => {
        await inp.persistSubmitReceipt?.({ status: 400, body: PRIVACY_BODY });
        throw Object.assign(new Error("InputImageSensitiveContentDetected.PrivacyInformation: may contain real person"), { kind: "rejected" });
      }),
    });
    const out = await runVideoEditWithFallback(input, deps);
    expect(out.channel).toBe("evolink");
    expect(out.providerTaskId).toBe("ev-1");
    expect(out.attempts.map(a => [a.channel, a.upstreamCharged, a.rejectionCode ?? null])).toEqual([
      ["byteplus", false, "InputImageSensitiveContentDetected.PrivacyInformation"],
      ["evolink", true, null],
    ]);
    expect(out.attempts[0]!.rawReceipt).toEqual({ status: 400, body: PRIVACY_BODY });
    const evSent = vi.mocked(deps.submitEvolink).mock.calls[0]![0];
    expect(evSent).toMatchObject({ mode: "video_edit", version: "2.5", videoUrls: [input.segmentUrl], imageUrls: input.referenceImageUrls, contentFilter: false });
    expect(buildEvolinkSeedanceRequest(evSent).body.duration).toBe(-1);
    expect(tail(uploads)).toEqual([
      "01-byteplus-request-raw.json", "01-byteplus-request-parsed.json",
      "02-byteplus-submit-raw.json", "02-byteplus-submit-parsed.json",
      "03-byteplus-rejection-raw.json", "03-byteplus-rejection-parsed.json",
      "04-evolink-request-raw.json", "04-evolink-request-parsed.json",
      "05-evolink-submit-raw.json", "05-evolink-submit-parsed.json",
      "06-evolink-terminal-raw.json", "06-evolink-terminal-parsed.json",
      "07-evolink-result-raw.json", "07-evolink-result-parsed.json",
    ]);
    const rejection = Array.from(store.entries()).find(([k]) => k.endsWith("03-byteplus-rejection-parsed.json"))![1] as { parsed: Record<string, unknown> };
    expect(rejection.parsed).toMatchObject({ zeroCharge: true, upstreamCharged: false, fallback: true });
    const raw = Array.from(store.entries()).find(([k]) => k.endsWith("02-byteplus-submit-raw.json"))![1] as { raw: { body: string } };
    expect(raw.raw.body).toBe(PRIVACY_BODY); // 原文不解析
  });

  it("EvoLink 也失败：抛 VideoEditFailedError，前台文案不带通道名，error.attempts 同形，拒绝回执已存", async () => {
    const { deps, uploads } = makeDeps({
      submitByteplus: vi.fn(async () => {
        throw Object.assign(new Error("InputImageSensitiveContentDetected.PrivacyInformation"), { kind: "rejected" });
      }),
      submitEvolink: vi.fn(async inp => {
        await inp.persistSubmitReceipt?.({ status: 400, body: JSON.stringify({ error: { code: "invalid_request", message: "bad" } }) });
        throw new SubmitRejectedError("bad");
      }),
    });
    const err = await runVideoEditWithFallback(input, deps).catch(e => e);
    expect(err).toBeInstanceOf(VideoEditFailedError);
    expect(err.message).toBe(VIDEO_EDIT_FAILED_ZH);
    expect(err.message).not.toMatch(/BytePlus|EvoLink|Seedance/i);
    expect(err.attempts.map((a: { channel: string; upstreamCharged: boolean; rejectionCode?: string }) => [a.channel, a.upstreamCharged, a.rejectionCode])).toEqual([
      ["byteplus", false, "InputImageSensitiveContentDetected.PrivacyInformation"],
      ["evolink", false, "invalid_request"],
    ]);
    expect(tail(uploads).at(-2)).toBe("05-evolink-rejection-raw.json");
  });

  it("BytePlus 未知结果（可能已建单）不转交，避免双扣", async () => {
    const { deps } = makeDeps({
      submitByteplus: vi.fn(async () => { throw Object.assign(new Error("fetch failed"), { kind: "unknown" }); }),
    });
    const err = await runVideoEditWithFallback(input, deps).catch(e => e);
    expect(err).toBeInstanceOf(VideoEditFailedError);
    expect(deps.submitEvolink).not.toHaveBeenCalled();
    expect(err.attempts[0].upstreamCharged).toBe(true);
  });

  it("BytePlus 建单后终态真人拒绝 → 转 EvoLink；片段时长越界不提交", async () => {
    const { deps } = makeDeps({
      pollByteplus: vi.fn(async (_id, persist) => {
        await persist({ status: 200, body: JSON.stringify({ id: "bp-1", status: "failed", error: { code: "InputImageSensitiveContentDetected.PrivacyInformation", message: "real person" } }) });
        return { state: "failed" as const, error: "InputImageSensitiveContentDetected.PrivacyInformation: real person" };
      }),
    });
    const out = await runVideoEditWithFallback(input, deps);
    expect(out.channel).toBe("evolink");
    expect(out.attempts[0]).toMatchObject({ upstreamCharged: true, rejectionCode: "InputImageSensitiveContentDetected.PrivacyInformation", providerTaskId: "bp-1" });

    const { deps: d2 } = makeDeps();
    await expect(runVideoEditWithFallback({ ...input, segmentSec: 3 }, d2)).rejects.toThrow(/4–30 秒/);
    await expect(runVideoEditWithFallback({ ...input, segmentSec: 31 }, d2)).rejects.toThrow(/4–30 秒/);
    expect(d2.submitByteplus).not.toHaveBeenCalled();
  });

  it("signedGcsUrlToGsUri", () => {
    expect(signedGcsUrlToGsUri(SIGNED)).toBe("gs://bkt/growth-camp/videos/out.mp4");
    expect(signedGcsUrlToGsUri("https://x.example/a.mp4")).toBeUndefined();
  });
});

describe("byteplusSeedanceVideo 入口转发", () => {
  it("从 byteplusSeedanceVideo 导出同名函数，入参校验走同一实现", async () => {
    const mod = await import("./byteplusSeedanceVideo");
    expect(typeof mod.runVideoEditWithFallback).toBe("function");
    await expect(mod.runVideoEditWithFallback({ ...input, segmentSec: 2 })).rejects.toBeInstanceOf(VideoEditFailedError);
  });
});

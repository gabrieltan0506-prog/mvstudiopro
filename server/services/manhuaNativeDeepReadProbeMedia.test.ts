import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { parseNativeProbeManifest } from "./manhuaNativeDeepReadProbeManifest";
import { verifyNativeProbeManifestMedia } from "./manhuaNativeDeepReadProbeRuntime";

function fixture() {
  const manifest = parseNativeProbeManifest({
    schemaVersion: 1, sourceDigest: "a".repeat(64), sourceDurationSec: 600,
    segments: [0, 1].map((segmentIndex) => ({
      segmentIndex, startSec: segmentIndex * 300, endSec: (segmentIndex + 1) * 300,
      gsUri: `gs://test-bucket/segment-${segmentIndex}.mp4`, bytes: 1234 + segmentIndex, hasAudio: true,
    })),
  });
  const probes = manifest.segments.map((segment) => ({
    format: { start_time: "0", duration: "300", size: String(segment.bytes) },
    streams: [
      { codec_type: "video", start_time: "0", duration: "300", width: 640, height: 360, avg_frame_rate: "25/1" },
      { codec_type: "audio", start_time: "0", duration: "300" },
    ],
  }));
  const order: string[] = [];
  const evidence: Array<{ segmentIndex: number; kind: "raw" | "parsed"; text: string }> = [];
  const indexOf = (uri: string) => Number(/segment-(\d+)/.exec(uri)?.[1]);
  const deps = {
    stat: vi.fn(async (gsUri: string) => {
      order.push(`stat-${indexOf(gsUri)}`);
      return { bucket: "test-bucket", objectName: `segment-${indexOf(gsUri)}.mp4`, generation: "123" };
    }),
    sign: vi.fn(async (gsUri: string) => {
      order.push(`sign-${indexOf(gsUri)}`);
      return `https://storage.example.test/segment-${indexOf(gsUri)}.mp4?X-Goog-Signature=test-signature`;
    }),
    probe: vi.fn(async (signedUrl: string) => {
      order.push(`probe-${indexOf(signedUrl)}`);
      return JSON.stringify(probes[indexOf(signedUrl)]);
    }),
    persist: vi.fn(async (input: { segmentIndex: number; kind: "raw" | "parsed"; text: string }) => {
      order.push(`${input.kind}-${input.segmentIndex}`);
      evidence.push(input);
      return {
        objectName: `probe-media/seg${input.segmentIndex}/${input.kind}.json`,
        bytes: Buffer.byteLength(input.text), sha256: createHash("sha256").update(input.text).digest("hex"), generation: "456",
      };
    }),
  };
  return { manifest, probes, deps, order, evidence };
}

describe("已有GCS分片复用生产媒体验收", () => {
  it("每片先存原JSON再按生产判据验收，全部通过后才允许发车", async () => {
    const { manifest, deps, order, evidence } = fixture();
    const post = vi.fn(async () => "模型调用占位，不联网");
    const verified = await verifyNativeProbeManifestMedia(manifest, deps);
    await post();
    expect(order).toEqual([
      "stat-0", "sign-0", "probe-0", "raw-0", "stat-0", "parsed-0",
      "stat-1", "sign-1", "probe-1", "raw-1", "stat-1", "parsed-1",
    ]);
    expect(verified.map((row) => row.media)).toEqual([
      { durationSec: 300, hasAudio: true, bytes: 1234 },
      { durationSec: 300, hasAudio: true, bytes: 1235 },
    ]);
    expect(verified.every((row) => row.rawEvidence.generation === "456" && row.parsedEvidence.generation === "456")).toBe(true);
    expect(JSON.stringify(evidence)).not.toContain("test-signature");
    expect(post).toHaveBeenCalledTimes(1);
  });

  it.each([
    { name: "视频时长偏短", change: (f: ReturnType<typeof fixture>) => { f.probes[0].streams[0].duration = "298"; } },
    { name: "非零起点", change: (f: ReturnType<typeof fixture>) => { f.probes[0].streams[0].start_time = "1"; } },
    { name: "音轨超出视频范围", change: (f: ReturnType<typeof fixture>) => { f.probes[0].streams[1].duration = "302"; } },
    { name: "音轨标记不符", change: (f: ReturnType<typeof fixture>) => { f.probes[0].streams.pop(); } },
    { name: "真实字节数不符", change: (f: ReturnType<typeof fixture>) => { f.probes[0].format.size = "1233"; } },
    { name: "字节数缺失", change: (f: ReturnType<typeof fixture>) => { f.probes[0].format.size = ""; } },
  ])("$name：原JSON永久证据已记录，拒绝且零模型调用", async ({ change }) => {
    const f = fixture();
    change(f);
    const post = vi.fn(async () => "不会调用");
    await expect(verifyNativeProbeManifestMedia(f.manifest, f.deps).then(post)).rejects.toThrow();
    expect(f.evidence).toHaveLength(1);
    expect(f.evidence[0].kind).toBe("raw");
    expect(f.evidence[0].text).toBe(JSON.stringify(f.probes[0]));
    expect(post).not.toHaveBeenCalled();
    expect(f.deps.sign).toHaveBeenCalledTimes(1);
  });

  it("坏JSON也先保存原文，不把parse错误正文或签名回传", async () => {
    const f = fixture();
    f.deps.probe.mockResolvedValueOnce('{"format":');
    const post = vi.fn();
    await expect(verifyNativeProbeManifestMedia(f.manifest, f.deps).then(post)).rejects.toThrow("媒体元数据JSON无法解析");
    expect(f.evidence).toEqual([{ segmentIndex: 0, kind: "raw", text: '{"format":' }]);
    expect(post).not.toHaveBeenCalled();
  });

  it.each(["stat", "sign", "probe", "persist"] as const)("%s失败不泄漏签名URL，不调用模型", async (step) => {
    const f = fixture();
    f.deps[step].mockRejectedValueOnce(new Error("https://storage.example.test/segment-0.mp4?X-Goog-Signature=test-signature"));
    const post = vi.fn();
    const failure = await verifyNativeProbeManifestMedia(f.manifest, f.deps).then(post).catch((error) => error as Error);
    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).not.toContain("test-signature");
    expect((failure as Error).cause).toBeUndefined();
    expect(post).not.toHaveBeenCalled();
  });

  it("探测期间对象版本变化，保留原JSON但拒绝发车", async () => {
    const f = fixture();
    f.deps.stat.mockResolvedValueOnce({ bucket: "test-bucket", objectName: "segment-0.mp4", generation: "123" })
      .mockResolvedValueOnce({ bucket: "test-bucket", objectName: "segment-0.mp4", generation: "124" });
    const post = vi.fn();
    await expect(verifyNativeProbeManifestMedia(f.manifest, f.deps).then(post)).rejects.toThrow("版本发生变化");
    expect(f.evidence.map((row) => row.kind)).toEqual(["raw"]);
    expect(post).not.toHaveBeenCalled();
  });

  it("最后一片失败时前片验收不代表整批可发，原始证据逐片保留", async () => {
    const f = fixture();
    f.probes[1].streams[0].duration = "290";
    const post = vi.fn();
    await expect(verifyNativeProbeManifestMedia(f.manifest, f.deps).then(post)).rejects.toThrow();
    expect(f.evidence.map((row) => `${row.segmentIndex}:${row.kind}`)).toEqual(["0:raw", "0:parsed", "1:raw"]);
    expect(post).not.toHaveBeenCalled();
  });

  it("真实无音轨按false保留，不默认有声", async () => {
    const f = fixture();
    f.manifest.segments.forEach((segment) => { segment.hasAudio = false; });
    f.probes.forEach((probe) => { probe.streams.pop(); });
    expect((await verifyNativeProbeManifestMedia(f.manifest, f.deps)).every((row) => !row.media.hasAudio)).toBe(true);
  });

  it("遵循生产判据允许真实音轨晚起或早停，不另立静默拒收门禁", async () => {
    const f = fixture();
    f.probes[0].streams[1].start_time = "1";
    f.probes[0].streams[1].duration = "298";
    expect((await verifyNativeProbeManifestMedia(f.manifest, f.deps))[0].media.hasAudio).toBe(true);
  });
});

/** Real browser + FFmpeg, isolated fake storage. These are development artifacts, not workflow acceptance. */
import { beforeEach, expect, it, vi } from "vitest";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
vi.mock("./artMotionEvidence", () => ({
  backupArtMotionEvidence: vi.fn(async () => {}),
}));
const archive = vi.hoisted(() => new Map<string, Buffer>());
vi.mock("./gcs", () => ({
  uploadBufferToGcs: vi.fn(
    async ({ objectName, buffer }: { objectName: string; buffer: Buffer }) => {
      archive.set(objectName, Buffer.from(buffer));
      return { gcsUri: `gs://offline/${objectName}` };
    }
  ),
}));
vi.mock("./postProduction", async importOriginal => {
  const real = await importOriginal<typeof import("./postProduction")>();
  return {
    ...real,
    uploadResult: vi.fn(
      async ({ filePath, ext }: { filePath: string; ext: string }) => {
        await mkdir("/tmp/art-motion-1007-render", { recursive: true });
        await writeFile(
          `/tmp/art-motion-1007-render/result.${ext}`,
          await readFile(filePath)
        );
        return {
          url: `https://offline.invalid/result.${ext}`,
          gcsUri: `gs://offline/result.${ext}`,
        };
      }
    ),
  };
});
import { renderArtMotion } from "./artMotionRender";
import { defaultArtMotionSpec } from "../../shared/artMotion";
beforeEach(() => archive.clear());
const input = () => ({
  action: "art_motion",
  scopeKey: "offline",
  requestId: "c1007000-1234-4234-8234-123456789abc",
  params: {
    ...defaultArtMotionSpec(),
    duration: 1,
    fps: 24,
    cues: [{ at: 0, kind: "title", text: "真实渲染测试" }],
  },
});
it("encodes exact frames and dimensions through the actual worker renderer", async () => {
  const out = await renderArtMotion(
    input(),
    "offline",
    new AbortController().signal
  );
  expect(out.frameCount).toBe(24);
  expect(out.width).toBe(1280);
  expect(out.height).toBe(720);
  expect(out.evidence.map(e => e.name)).toEqual([
    "request.raw.json",
    "request.normalized.json",
    "frames.json",
    "probe.raw.json",
    "probe.parsed.json",
  ]);
  const frames = JSON.parse(
    Array.from(archive)
      .find(([k]) => k.endsWith("/frames.json"))![1]
      .toString()
  );
  expect(frames.frames).toHaveLength(24);
  expect(new Set(frames.frames.map((f: any) => f.sha256)).size).toBeGreaterThan(
    1
  );
  await writeFile(
    "/tmp/art-motion-1007-render/receipts.json",
    JSON.stringify(out, null, 2)
  );
}, 120000);
it("cancellation keeps partial frame evidence before temporary cleanup", async () => {
  const control = new AbortController(),
    original = console.info;
  const spy = vi.spyOn(console, "info").mockImplementation((...args) => {
    original(...args);
    if (args[0] === "[art-motion] frame")
      control.abort(new Error("offline cancel"));
  });
  try {
    await expect(
      renderArtMotion(input(), "offline", control.signal)
    ).rejects.toThrow();
    const frames = JSON.parse(
      Array.from(archive)
        .find(([k]) => k.endsWith("/frames.partial.json"))![1]
        .toString()
    );
    expect(frames.complete).toBe(false);
    expect(frames.frames).toHaveLength(1);
    expect(frames.frames[0].sha256).toHaveLength(64);
  } finally {
    spy.mockRestore();
  }
}, 120000);
it("renders transparent MOV with real audio muxing", async () => {
  const { execFileSync } = await import("node:child_process");
  const audioPath = "/tmp/art-motion-1007-render/offline-tone.wav";
  await mkdir(path.dirname(audioPath), { recursive: true });
  execFileSync("ffmpeg", [
    "-y",
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=0.3",
    audioPath,
  ]);
  const post = await import("./postProduction");
  const download = vi
    .spyOn(post, "fetchPostProdSourceToFile")
    .mockImplementation(async (_uri, file) => {
      await writeFile(file, await readFile(audioPath));
      return undefined as never;
    });
  try {
    const raw = input();
    raw.params = {
      ...raw.params,
      alpha: true,
      audioUri: "gs://offline/owned-tone.wav",
    } as typeof raw.params;
    const out = await renderArtMotion(
      raw,
      "offline",
      new AbortController().signal
    );
    expect(out.alpha).toBe(true);
    expect(out.frameCount).toBe(24);
    const probe = JSON.parse(
      Array.from(archive)
        .find(([k]) => k.endsWith("/probe.parsed.json"))![1]
        .toString()
    );
    expect(
      probe.streams.find((s: any) => s.codec_type === "video").pix_fmt
    ).toMatch(/^yuva/);
    expect(
      probe.streams.find((s: any) => s.codec_type === "audio").codec_name
    ).toBe("pcm_s16le");
    expect(Number(probe.format.duration)).toBeCloseTo(1, 1);
  } finally {
    download.mockRestore();
  }
}, 120000);
it("GCS失败才回退网站证据，回退后在浏览器启动前保留原请求", async () => {
  const { backupArtMotionEvidence } = await import("./artMotionEvidence");
  const { uploadBufferToGcs } = await import("./gcs");
  const puppeteer = (await import("puppeteer")).default;
  const launch = vi.spyOn(puppeteer, "launch").mockRejectedValueOnce(new Error("测试在渲染前停止"));
  const events: string[] = [];
  vi.mocked(backupArtMotionEvidence).mockImplementationOnce(async () => {
    events.push("durable");
  });
  vi.mocked(uploadBufferToGcs).mockImplementationOnce(async () => {
    events.push("cloud");
    throw new Error("offline storage outage");
  });
  try {
    await expect(
      renderArtMotion(input(), "offline", new AbortController().signal)
    ).rejects.toThrow("测试在渲染前停止");
    expect(events).toEqual(["cloud", "durable"]);
    expect(backupArtMotionEvidence).toHaveBeenCalled();
    expect(launch).toHaveBeenCalledTimes(1);
  } finally { launch.mockRestore(); }
});
it("GCS成功且网站失联时不做网站预检，原请求保存后进入浏览器准备", async () => {
  const { backupArtMotionEvidence } = await import("./artMotionEvidence");
  vi.mocked(backupArtMotionEvidence).mockClear();
  vi.mocked(backupArtMotionEvidence).mockRejectedValue(new Error("website unreachable"));
  const puppeteer = (await import("puppeteer")).default;
  const launch = vi.spyOn(puppeteer, "launch").mockRejectedValueOnce(new Error("测试在渲染前停止"));
  try {
    await expect(
      renderArtMotion(input(), "offline", new AbortController().signal)
    ).rejects.toThrow("测试在渲染前停止");
    expect(backupArtMotionEvidence).not.toHaveBeenCalled();
    expect(Array.from(archive.keys()).filter(k => k.endsWith("request.raw.json"))).toHaveLength(1);
    expect(launch).toHaveBeenCalledTimes(1);
  } finally { launch.mockRestore(); }
});

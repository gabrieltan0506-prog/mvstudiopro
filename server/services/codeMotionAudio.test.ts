import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import {
  assertCodeMotionAudioOwnership,
  buildCodeMotionAudioMixArgs,
  detectCodeMotionAudioFormat,
  importCodeMotionAudio,
  renderCodeMotionAudio,
  type CodeMotionAudioImportDeps,
  type CodeMotionAudioRenderDeps,
} from "./codeMotionAudio";
import type { CodeMotionAudio } from "../../shared/codeMotionAudio";

const projectId = "11111111-1111-4111-8111-111111111111";
const id = "22222222-2222-4222-8222-222222222222";
const bytes = Buffer.from("仅用于依赖注入的虚构音频，不可播放");
const sha256 = createHash("sha256").update(bytes).digest("hex");
const source = {
  id,
  name: "录音.webm",
  gcsUri: `gs://test/post-prod/7/code-motion/${projectId}/audio/${id}/${sha256}.webm`,
  duration: 5,
  mimeType: "audio/webm" as const,
  sha256,
  bytes: bytes.length,
};
const clip = {
  sourceId: id,
  role: "dialogue" as const,
  at: 2,
  trimStart: 1,
  duration: 2,
  volume: 0.8,
  fadeIn: 0.1,
  fadeOut: 0.3,
};
const audio: CodeMotionAudio = { sources: [source], audioTimeline: [clip] };
const input = {
  userId: "7",
  projectId,
  name: "录音.webm",
  gcsUri: "gs://test/uploads/u7/original.webm",
};
function importDeps(): CodeMotionAudioImportDeps {
  return {
    resolve: vi.fn(async () => input.gcsUri),
    read: vi.fn(async () => bytes),
    inspect: vi.fn(async () => ({
      duration: 5,
      mimeType: "audio/webm" as const,
      extension: "webm",
    })),
    archive: vi.fn(async name => `gs://test/${name}`),
  };
}
it("导入先验证归属和真实类型，再不可覆盖归档原字节及SHA", async () => {
  const deps = importDeps();
  const result = await importCodeMotionAudio(input, deps);
  expect(result).toMatchObject({
    duration: 5,
    mimeType: "audio/webm",
    sha256,
    bytes: bytes.length,
  });
  expect(result.gcsUri).toBe(
    `gs://test/post-prod/7/code-motion/${projectId}/audio/${result.id}/${sha256}.webm`
  );
  expect(deps.archive).toHaveBeenCalledWith(
    result.gcsUri.slice("gs://test/".length),
    bytes,
    "audio/webm"
  );
  expect(vi.mocked(deps.resolve).mock.invocationCallOrder[0]).toBeLessThan(
    vi.mocked(deps.read).mock.invocationCallOrder[0]
  );
  expect(vi.mocked(deps.inspect).mock.invocationCallOrder[0]).toBeLessThan(
    vi.mocked(deps.archive).mock.invocationCallOrder[0]
  );
});
it("越权、解码失败、空文件和过长音频均不得归档", async () => {
  const deps = importDeps();
  vi.mocked(deps.resolve).mockRejectedValueOnce(new Error("素材尚未登记"));
  await expect(importCodeMotionAudio(input, deps)).rejects.toThrow(
    "素材尚未登记"
  );
  expect(deps.read).not.toHaveBeenCalled();
  vi.mocked(deps.inspect).mockRejectedValueOnce(new Error("无有效音轨"));
  await expect(importCodeMotionAudio(input, deps)).rejects.toThrow(
    "无有效音轨"
  );
  vi.mocked(deps.read).mockResolvedValueOnce(Buffer.alloc(0));
  await expect(importCodeMotionAudio(input, deps)).rejects.toThrow("音源为空");
  vi.mocked(deps.inspect).mockResolvedValueOnce({
    duration: 181,
    mimeType: "audio/webm",
    extension: "webm",
  });
  await expect(importCodeMotionAudio(input, deps)).rejects.toThrow();
  expect(deps.archive).not.toHaveBeenCalled();
});
it("真实容器检测允许录音未知时长，拒绝伪音频和实际视频", () => {
  expect(
    detectCodeMotionAudioFormat({
      format: { format_name: "matroska,webm" },
      streams: [{ codec_type: "audio", codec_name: "opus" }],
    })
  ).toEqual({ mimeType: "audio/webm", extension: "webm" });
  expect(
    detectCodeMotionAudioFormat({
      format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2" },
      streams: [{ codec_type: "audio", codec_name: "aac" }],
    }).mimeType
  ).toBe("audio/mp4");
  expect(() =>
    detectCodeMotionAudioFormat({
      format: { format_name: "mp3" },
      streams: [{ codec_type: "audio", codec_name: "aac" }],
    })
  ).toThrow("实际音频格式");
  expect(() =>
    detectCodeMotionAudioFormat({
      format: { format_name: "mov,mp4" },
      streams: [
        { codec_type: "audio", codec_name: "aac" },
        { codec_type: "video", codec_name: "h264" },
      ],
    })
  ).toThrow("视频文件");
  expect(() =>
    detectCodeMotionAudioFormat({ format: { format_name: "wav" }, streams: [] })
  ).toThrow("有效音轨");
});
it("同账号别的作品、改SHA及改源编号不能绕过素材归属", async () => {
  const resolve = vi.fn(async ({ source }: { source: string }) => source);
  await assertCodeMotionAudioOwnership(
    { userId: "7", projectId, audio },
    { resolve }
  );
  expect(resolve).toHaveBeenCalledWith({ userId: "7", source: source.gcsUri });
  await expect(
    assertCodeMotionAudioOwnership(
      { userId: "8", projectId, audio },
      { resolve }
    )
  ).rejects.toThrow("当前账号和作品");
  await expect(
    assertCodeMotionAudioOwnership(
      { userId: "7", projectId: id, audio },
      { resolve }
    )
  ).rejects.toThrow("当前账号和作品");
  await expect(
    assertCodeMotionAudioOwnership(
      {
        userId: "7",
        projectId,
        audio: { ...audio, sources: [{ ...source, sha256: "b".repeat(64) }] },
      },
      { resolve }
    )
  ).rejects.toThrow("当前账号和作品");
});
it("整数样本裁段、延迟和淡入淡出保持原速，并将旧对白加入同一混音", () => {
  const args = buildCodeMotionAudioMixArgs(
    audio,
    10,
    new Map([[id, "/tmp/decoded.wav"]]),
    "/tmp/soundtrack.wav",
    "/tmp/speech.wav"
  );
  const graph = args[args.indexOf("-filter_complex") + 1];
  expect(graph).toContain("atrim=start_sample=48000:end_sample=144000");
  expect(graph).toContain("adelay=96000S:all=1");
  expect(graph).toContain("afade=t=in:ss=0:ns=4800");
  expect(graph).toContain("afade=t=out:ss=81600:ns=14400");
  expect(graph).toContain("[a0][speech]amix=inputs=2");
  expect(graph).toContain("atrim=end_sample=480000[out]");
  expect(graph).not.toMatch(/atempo|asetrate|aloop/);
  expect(() =>
    buildCodeMotionAudioMixArgs(
      audio,
      3,
      new Map([[id, "/tmp/a.wav"]]),
      "/tmp/out.wav"
    )
  ).toThrow("超出视频");
});
function renderDeps(): CodeMotionAudioRenderDeps {
  return {
    ownership: vi.fn(async () => {}),
    fetch: vi.fn(async (_uri, file) => {
      await writeFile(file, bytes);
      return bytes.length;
    }),
    decode: vi.fn(async () => ({
      duration: 5,
      mimeType: "audio/webm" as const,
      extension: "webm",
    })),
    run: vi.fn(async () => ({ stdout: "", stderr: "" })),
    probe: vi.fn(async () => 10),
  };
}
it("样本取整导致尾音或淡入淡出越界时明确失败", () => {
  const paths = new Map([[id, "/tmp/decoded.wav"]]);
  const edge = {
    ...audio,
    audioTimeline: [
      {
        ...clip,
        at: 0.49999,
        trimStart: 0.00001,
        duration: 0.50001,
        fadeIn: 0,
        fadeOut: 0,
      },
    ],
  };
  expect(() =>
    buildCodeMotionAudioMixArgs(edge, 1, paths, "/tmp/out.wav")
  ).toThrow("取整后超出时间轴");
  const fade = {
    ...audio,
    audioTimeline: [
      {
        ...clip,
        at: 0,
        trimStart: 0.00001,
        duration: 0.000021,
        fadeIn: 0.0000105,
        fadeOut: 0.0000105,
      },
    ],
  };
  expect(() =>
    buildCodeMotionAudioMixArgs(fade, 1, paths, "/tmp/out.wav")
  ).toThrow("淡入淡出取整后");
});
it("worker再次验原文件SHA和真实长度，拒绝被替换或短缺的音轨", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ink-audio-unit-"));
  try {
    const base = {
      userId: "7",
      projectId,
      audio,
      duration: 10,
      root,
      signal: new AbortController().signal,
    };
    const deps = renderDeps();
    const result = await renderCodeMotionAudio(base, deps);
    expect(result.receipt.sourceHashes).toEqual([sha256]);
    expect(result.output).toBe(path.join(root, "ink-soundtrack.wav"));
    vi.mocked(deps.fetch).mockImplementationOnce(async (_uri, file) => {
      await writeFile(file, Buffer.from("被改过的文件"));
      return 1;
    });
    await expect(renderCodeMotionAudio(base, deps)).rejects.toThrow(
      "内容与已确认版本不一致"
    );
    vi.mocked(deps.decode).mockResolvedValueOnce({
      duration: 4,
      mimeType: "audio/webm",
      extension: "webm",
    });
    await expect(renderCodeMotionAudio(base, deps)).rejects.toThrow("实际时长");
    expect(deps.run).toHaveBeenCalledTimes(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("混音输出时长失败不返回产物，取消信号不继续下载", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ink-audio-unit-"));
  try {
    const deps = renderDeps();
    vi.mocked(deps.probe).mockResolvedValueOnce(9);
    const base = {
      userId: "7",
      projectId,
      audio,
      duration: 10,
      root,
      signal: new AbortController().signal,
    };
    await expect(renderCodeMotionAudio(base, deps)).rejects.toThrow(
      "混音实际时长"
    );
    const control = new AbortController();
    control.abort();
    await expect(
      renderCodeMotionAudio({ ...base, signal: control.signal }, deps)
    ).rejects.toThrow();
    expect(deps.fetch).toHaveBeenCalledTimes(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  archive: vi.fn(
    async (
      _user: string,
      _request: string,
      objectName: string,
      bytes: Buffer
    ) => ({
      storage: "gcs",
      objectName,
      bytes: bytes.length,
      sha256: "a".repeat(64),
    })
  ),
  mix: vi.fn(async (input: { root: string }) => ({
    output: `${input.root}/ink-soundtrack.wav`,
    receipt: { sourceIds: ["test"], duration: 15 },
  })),
  speech: vi.fn(async () => ({ duration: 15 })),
  quota: vi.fn(async () => {}),
  launch: vi.fn(async () => {
    throw new Error("单测在画面渲染前停止");
  }),
}));
vi.mock("./artMotionEvidenceStore", () => ({
  persistArtMotionEvidence: mocks.archive,
}));
vi.mock("./codeMotionAudio", () => ({ renderCodeMotionAudio: mocks.mix }));
vi.mock("./inkFreeSpeech", () => ({ renderInkFreeSpeech: mocks.speech }));
vi.mock("./inkFreeQuota", () => ({ assertInkFreeJob: mocks.quota }));
vi.mock("puppeteer", () => ({ default: { launch: mocks.launch } }));
import { renderArtMotion } from "./artMotionRender";
import { compileCodeMotion } from "../../shared/codeMotion";

const projectId = "11111111-1111-4111-8111-111111111111",
  id = "22222222-2222-4222-8222-222222222222";
function raw(withSpeech = false) {
  const params = compileCodeMotion(
    {
      title: "原声",
      request: "原声介绍",
      text: "",
      style: "words",
      duration: 15,
      orientation: "landscape",
      images: [],
      data: [],
      unit: "",
      audios: [
        {
          id,
          name: "测试.wav",
          gcsUri: "gs://test/fake.wav",
          duration: 5,
          mimeType: "audio/wav",
          bytes: 300,
          sha256: "a".repeat(64),
        },
      ],
    },
    {
      version: 1,
      summary: "原声",
      scenes: [
        {
          heading: "原声",
          body: "介绍",
          duration: 15,
        },
      ],
      audioTimeline: [
        {
          sourceId: id,
          role: "narration",
          at: 0,
          trimStart: 0,
          duration: 5,
          volume: 1,
          fadeIn: 0,
          fadeOut: 0,
        },
      ],
    }
  );
  // Historical persisted jobs remain readable; new INK plans compile only adopted Qwen sources.
  if (withSpeech) params.inkSpeech = { engine: "kokoro-zh-v1.1", lines: [{ at: 0, duration: 5, text: "历史任务只测试接线", voice: "female" }] } as typeof params.inkSpeech;
  return {
    action: "art_motion",
    scopeKey: `code-motion:${projectId}`,
    requestId: "33333333-3333-4333-8333-333333333333",
    params,
  };
}
beforeEach(() => vi.clearAllMocks());
it("worker接原声混音并归档回执，无对白时不调用TTS", async () => {
  const signal = new AbortController().signal;
  await expect(renderArtMotion(raw(), "7", signal)).rejects.toThrow(
    "单测在画面渲染前停止"
  );
  expect(mocks.mix).toHaveBeenCalledWith(
    expect.objectContaining({
      userId: "7",
      projectId,
      duration: 15,
      speechPath: undefined,
      signal,
    })
  );
  expect(mocks.speech).not.toHaveBeenCalled();
  expect(
    mocks.archive.mock.calls.some(call =>
      call[2].endsWith("/code-audio.parsed.json")
    )
  ).toBe(true);
});
it("已有对白先保留原文件，再交同一soundtrack混合", async () => {
  await expect(
    renderArtMotion(raw(true), "7", new AbortController().signal)
  ).rejects.toThrow("单测在画面渲染前停止");
  expect(mocks.speech).toHaveBeenCalledOnce();
  expect(mocks.mix).toHaveBeenCalledWith(
    expect.objectContaining({
      speechPath: expect.stringMatching(/\/ink-dialogue\.wav$/),
    })
  );
  expect(mocks.speech.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.mix.mock.invocationCallOrder[0]
  );
});

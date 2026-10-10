import { expect, it, vi } from "vitest";
import { codeMotionProjectSchema } from "../../shared/codeMotion";
import {
  codeMotionRenderIdentity,
  submitCodeMotion,
  type CodeMotionTaskDeps,
} from "./codeMotionTask";
import {
  loadCodeMotion,
  saveCodeMotion,
  type CodeMotionStoreDeps,
} from "./codeMotionStore";

const projectId = "11111111-1111-4111-8111-111111111111";
const sourceId = "22222222-2222-4222-8222-222222222222";
function project() {
  return codeMotionProjectSchema.parse({
    id: projectId,
    brief: {
      title: "原声作品",
      request: "原声从第二秒进入",
      text: "原声说明",
      style: "words",
      duration: 15,
      orientation: "landscape",
      images: [],
      audios: [
        {
          id: sourceId,
          name: "原声.wav",
          gcsUri: `gs://test/post-prod/7/code-motion/${projectId}/audio/${sourceId}/${"a".repeat(64)}.wav`,
          duration: 5,
          mimeType: "audio/wav",
          sha256: "a".repeat(64),
          bytes: 10000,
        },
      ],
      data: [],
      unit: "",
    },
    plan: {
      version: 1,
      summary: "原声说明",
      scenes: [{ heading: "介绍", body: "原声说明", duration: 15 }],
      audioTimeline: [
        {
          sourceId,
          role: "narration",
          at: 2,
          trimStart: 0,
          duration: 5,
          volume: 1,
          fadeIn: 0,
          fadeOut: 0,
        },
      ],
    },
  });
}
function deps() {
  return {
    load: vi.fn(async () => null),
    queue: vi.fn(async () => ({ jobId: "test", status: "queued" })),
    resolve: vi.fn(async ({ input }) => input),
    view: vi.fn(),
    audioOwnership: vi.fn(async () => {}),
  } as CodeMotionTaskDeps;
}
it("上传原声可不带TTS提交，音源权限先于排队检查", async () => {
  const p = project(),
    d = deps(),
    identity = codeMotionRenderIdentity("7", p);
  expect(identity.spec.inkSpeech).toBeUndefined();
  expect(identity.spec.codeAudio?.sources[0].id).toBe(sourceId);
  await submitCodeMotion("7", p, identity.fingerprint, d);
  expect(d.audioOwnership).toHaveBeenCalledWith({
    userId: "7",
    projectId,
    audio: identity.spec.codeAudio,
  });
  expect(vi.mocked(d.audioOwnership!).mock.invocationCallOrder[0]).toBeLessThan(
    vi.mocked(d.queue).mock.invocationCallOrder[0]
  );
  vi.mocked(d.audioOwnership!).mockRejectedValueOnce(new Error("原声归属错误"));
  await expect(
    submitCodeMotion("7", p, identity.fingerprint, d)
  ).rejects.toThrow("原声归属错误");
  expect(d.queue).toHaveBeenCalledTimes(1);
});
it("音量、原声SHA和秒窗变动均改变幂等指纹", () => {
  const p = project(),
    first = codeMotionRenderIdentity("7", p);
  const changedVolume = project();
  changedVolume.plan!.audioTimeline![0].volume = 0.5;
  expect(codeMotionRenderIdentity("7", changedVolume).jobId).not.toBe(
    first.jobId
  );
  const changedAt = project();
  changedAt.plan!.audioTimeline![0].at = 3;
  expect(codeMotionRenderIdentity("7", changedAt).jobId).not.toBe(first.jobId);
  const changedHash = project();
  changedHash.brief.audios![0].sha256 = "b".repeat(64);
  expect(codeMotionRenderIdentity("7", changedHash).jobId).not.toBe(
    first.jobId
  );
});
it("原声任务响应丢失后恢复同任务，不重新排队或触发合成", async () => {
  const p = project(),
    d = deps(),
    identity = codeMotionRenderIdentity("7", p);
  vi.mocked(d.load).mockResolvedValueOnce({
    id: identity.jobId,
    userId: "7",
    type: "post_prod",
    status: "succeeded",
    input: {
      action: "art_motion",
      scopeKey: identity.scopeKey,
      requestId: identity.requestId,
      params: identity.spec,
    },
  } as never);
  vi.mocked(d.view).mockReturnValueOnce({
    jobId: identity.jobId,
    status: "succeeded",
  } as never);
  expect(await submitCodeMotion("7", p, identity.fingerprint, d)).toEqual({
    jobId: identity.jobId,
    status: "succeeded",
  });
  expect(d.queue).not.toHaveBeenCalled();
  expect(d.audioOwnership).not.toHaveBeenCalled();
});
it("云端保存恢复保留原声身份及全部秒窗，不生成新任务", async () => {
  let body = Buffer.alloc(0);
  const store: CodeMotionStoreDeps = {
    read: vi.fn(async () => ({ body, generation: "1" })),
    write: vi.fn(async (_name, value) => {
      body = value;
      return "1";
    }),
    list: vi.fn(async () => []),
  };
  const p = project();
  await saveCodeMotion("7", p, "0", store);
  const loaded = await loadCodeMotion("7", projectId, store);
  expect(loaded?.project).toEqual(p);
  expect(codeMotionRenderIdentity("7", loaded!.project).fingerprint).toBe(
    codeMotionRenderIdentity("7", p).fingerprint
  );
});

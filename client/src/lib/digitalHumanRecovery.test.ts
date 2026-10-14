import { describe, expect, it, vi } from "vitest";
import {
  newDigitalHumanDraft,
  type DigitalHumanVideo,
} from "@shared/digitalHumanStudio";
import {
  recoverDigitalHumanDraft,
  type DigitalHumanRecoveryServices,
} from "./digitalHumanRecovery";
const id = "a51d8a78-1c90-4f1d-9c1e-324e7a3f4659";
const video: DigitalHumanVideo = {
  requestId: id,
  fingerprint: "test",
  status: "unknown",
  intentId: "test-intent",
  prompt: "测试",
  portrait: { source: "https://example.test/p.png", name: "本人" },
  scene: { source: "https://example.test/s.png", name: "场景" },
  extraPortraits: [],
  audioSource: "https://example.test/a.wav",
  audioRequestId: "audio",
  durationSec: 12,
  aspectRatio: "9:16",
};
function setup() {
  let draft = newDigitalHumanDraft("7", id);
  const calls: string[] = [];
  const services: DigitalHumanRecoveryServices = {
    listVoices: async () => [],
    dialogue: async () => null,
    scene: async () => null,
    job: async () => ({ status: "running" }),
    intent: async () => ({ taskId: "video-original" }),
    video: async taskId => {
      calls.push(taskId);
      return {
        taskId,
        status: "succeeded",
        videoUrl: `https://example.test/${taskId}.mp4`,
      };
    },
    enhancements: async () => [],
    save: fn => {
      draft = fn(draft);
    },
    updateVideo: (id, patch) => {
      draft = {
        ...draft,
        videos: draft.videos.map(v =>
          v.requestId === id ? { ...v, ...patch } : v
        ),
      };
    },
  };
  return {
    services,
    get: () => draft,
    set: (next: typeof draft) => {
      draft = next;
    },
    calls,
  };
}
describe("数字人刷新恢复", () => {
  it("一条配音查询故障不阻断原片找回，恢复没有创建接口", async () => {
    const f = setup();
    f.set({
      ...f.get(),
      audios: [
        {
          request: {
            billingRequestId: id,
            input: "测试",
            voice: "test",
            speakerZh: "本人",
            speakerId: "actor",
            voiceStateZh: "",
          },
          status: "unknown",
        },
      ],
      videos: [video],
    });
    f.services.dialogue = async () => {
      throw new Error("配音查询暂不可用");
    };
    const errors = await recoverDigitalHumanDraft(f.get(), f.services);
    expect(errors).toEqual(["配音查询暂不可用"]);
    expect(f.get().videos[0]).toMatchObject({
      status: "succeeded",
      taskId: "video-original",
      source: "https://example.test/video-original.mp4",
    });
    expect(f.calls).toEqual(["video-original"]);
  });
  it("场景无本地编号时只读查回原请求", async () => {
    const f = setup();
    f.set({
      ...f.get(),
      scenes: [
        {
          request: {
            requestId: id,
            description: "自然光书房",
            aspectRatio: "9:16",
          },
          status: "unknown",
        },
      ],
    });
    f.services.scene = vi.fn(async () => ({ jobId: "original-scene" }));
    f.services.job = vi.fn(async () => ({
      status: "succeeded" as const,
      output: { imageUrl: "https://example.test/scene.png" },
    }));
    await recoverDigitalHumanDraft(f.get(), f.services);
    expect(f.services.scene).toHaveBeenCalledWith(id);
    expect(f.get().scenes[0]).toMatchObject({
      jobId: "original-scene",
      status: "succeeded",
    });
  });
  it("4K未知提交只从同一范围和原片找回，保留720p", async () => {
    const f = setup();
    const original = "https://example.test/720.mp4";
    f.set({
      ...f.get(),
      videos: [
        {
          ...video,
          status: "succeeded",
          source: original,
          upscale: {
            status: "unknown",
            inputSource: original,
            durationSec: 12,
            sourceResolution: "720p",
          },
        },
      ],
    });
    f.services.enhancements = async () => [
      {
        taskId: "wrong",
        sourceUrl: "https://example.test/other.mp4",
        target: "4k",
      },
      { taskId: "correct-4k", sourceUrl: original, target: "4k" },
    ];
    await recoverDigitalHumanDraft(f.get(), f.services);
    expect(f.get().videos[0].source).toBe(original);
    expect(f.get().videos[0].upscale).toMatchObject({
      taskId: "correct-4k",
      status: "succeeded",
    });
    expect(f.calls).toEqual(["correct-4k"]);
  });
  it("成功但产物空值时不假报通过，服务端人工核对保持unknown", async () => {
    const f = setup();
    f.set({ ...f.get(), videos: [video] });
    f.services.video = async taskId => ({ taskId, status: "succeeded" });
    expect(await recoverDigitalHumanDraft(f.get(), f.services)).toEqual([
      "视频任务缺少成片，请核对原任务",
    ]);
    expect(f.get().videos[0].status).toBe("unknown");
    f.services.video = async taskId => ({
      taskId,
      status: "reconcile_manual",
      error: "需核对",
    });
    await recoverDigitalHumanDraft(f.get(), f.services);
    expect(f.get().videos[0]).toMatchObject({
      status: "unknown",
      message: "需核对",
    });
  });
});

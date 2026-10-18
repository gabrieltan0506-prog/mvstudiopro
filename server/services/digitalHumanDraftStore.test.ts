import { addDigitalHumanSegment, switchDigitalHumanSegment } from "../../shared/digitalHumanProject";
import { describe, expect, it, vi } from "vitest";
import { newDigitalHumanDraft, prepareDigitalHumanVideo } from "../../shared/digitalHumanStudio";
import { digitalHumanKeyframeRevision } from "../../shared/digitalHumanKeyframes";
import { readDigitalHumanCloudDraft, writeDigitalHumanCloudDraft } from "./digitalHumanDraftStore";
const draft = newDigitalHumanDraft("7", "a51d8a78-1c90-4f1d-9c1e-324e7a3f4659");
describe("数字人完整云稿与版本冲突", () => {
  it("多段完整云稿保留各段独立内容、项目次序和后期恢复记录", async () => {
    let next: import("../../shared/digitalHumanStudio").DigitalHumanDraft = { ...newDigitalHumanDraft("7", draft.id), script: "第一段原话", direction: "椅子爆裂聚字" };
    next = addDigitalHumanSegment(next, "00000000-0000-4000-8000-000000000099");
    next.script = "第二段原话";
    const projectDraft = { ...next, project: { ...next.project!, postProdStorage: { job: "原任务回执" } } };
    let stored = Buffer.alloc(0);
    const deps = { write: vi.fn(async (input: any) => { stored = input.buffer; return { generation: "14" }; }), read: vi.fn(async () => ({ buffer: stored, generation: "14" })) } as any;
    await writeDigitalHumanCloudDraft(7, projectDraft, "13", deps);
    const restored = (await readDigitalHumanCloudDraft(7, deps)).draft!;
    expect(restored.script).toBe("第二段原话");
    expect(restored.project!.postProdStorage.job).toBe("原任务回执");
    expect(switchDigitalHumanSegment(restored, draft.id)).toMatchObject({ script: "第一段原话", direction: "椅子爆裂聚字" });
  });

  it("采用的关键分镜、顾问原请求和视频参考经服务端云稿往返不被剥除", async () => {
    const next = newDigitalHumanDraft("7", draft.id);
    const audioId = "00000000-0000-4000-8000-000000000001";
    next.script = "检查前方资料。"; next.voiceId = "test";
    next.portrait = { source: "gs://test-only/person.png", name: "本人" };
    next.scene = { source: "gs://test-only/scene.png", name: "场景" };
    next.audios = [{ request: { billingRequestId: audioId, input: next.script, voice: "test", speakerZh: "本人", speakerId: "test", voiceStateZh: "" }, status: "succeeded", source: "gs://test-only/audio.wav", durationSec: 12 }];
    next.approvedAudioRequestId = audioId;
    next.keyframes = [{ id: "00000000-0000-4000-8000-000000000002", label: "前方操作", media: { source: "gs://test-only/frame.png", name: "frame.png" }, useZh: "面板全在身前，人物身份按本人图", startSec: 2, endSec: 8, adopted: true }];
    next.keyframes[0].reviewedRevision = digitalHumanKeyframeRevision(next, next.keyframes[0]);
    next.originalPortraits = [{ source: "gs://test-only/uploads/u7/original.png", name: "用户原始人像" }];
    next.keyframeImageDraft = { label: "透明曲面屏", description: "人物在后方，目光看向拖拽窗口", adviceRevision: "test-advice-revision", startSec: 2, endSec: 8 };
    next.keyframeGenerations = [{ request: { requestId: "00000000-0000-4000-8000-000000000009", draftId: next.id, label: "透明曲面屏", description: "人物在后方，目光看向拖拽窗口", aspectRatio: "9:16", portraits: next.originalPortraits }, status: "unknown" }];
    next.keyframes[0].reviewedRevision = digitalHumanKeyframeRevision(next, next.keyframes[0]);
    next.advisorStorage["publication-pending"] = JSON.stringify({ requestId: "test-only-request", script: next.script });
    next.videos = [prepareDigitalHumanVideo(next, "00000000-0000-4000-8000-000000000003")];
    let stored = Buffer.alloc(0);
    const deps = { write: vi.fn(async (input: any) => { stored = input.buffer; return { generation: "13" }; }), read: vi.fn(async () => ({ buffer: stored, generation: "13" })) } as any;
    await writeDigitalHumanCloudDraft(7, next, "12", deps);
    const restored = (await readDigitalHumanCloudDraft(7, deps)).draft!;
    expect(restored.keyframes).toEqual(next.keyframes);
    expect(restored.originalPortraits).toEqual(next.originalPortraits);
    expect(restored.keyframeImageDraft).toEqual(next.keyframeImageDraft);
    expect(restored.keyframeGenerations).toEqual(next.keyframeGenerations);
    expect(restored.videos[0].keyframes).toEqual(next.keyframes);
    expect(restored.advisorStorage).toEqual(next.advisorStorage);
    expect(deps.write.mock.calls[0][0].ifGenerationMatch).toBe("12");
  });
  it("不存在仅metadata404返回generation0，网络与正文错误不得当空稿", async () => {
    const deps = {read:vi.fn(async()=>{throw new Error("gcs_stat_failed:404");}),write:vi.fn()} as any;
    expect(await readDigitalHumanCloudDraft(7,deps)).toMatchObject({draft:null,generation:"0"});
    deps.read.mockRejectedValue(new Error("gcs_download_failed:404"));
    await expect(readDigitalHumanCloudDraft(7,deps)).rejects.toThrow("gcs_download_failed");
  });
  it("场景地点、机位与白模失效状态通过真实云稿序列化往返", async () => {
    const next = { ...draft, stageCamera: { kind: "single" as const, position: [3, 2, 1.5] as [number, number, number], target: [3, 4, 1.5] as [number, number, number], lens: 45, labelZh: "单人" },
      stageAnchors: [{ id: "window", labelZh: "窗边", point: [3, 4] as [number, number], worldTaskId: "world-test", sceneSource: "gs://test-only/scene.png" }], previsSpatialInvalidated: true };
    let stored: Buffer;
    const deps = { write: vi.fn(async (input: any) => { stored = input.buffer; return { generation: "12" }; }), read: vi.fn(async () => ({ buffer: stored, generation: "12" })) } as any;
    await writeDigitalHumanCloudDraft(7, next, "11", deps);
    expect((await readDigitalHumanCloudDraft(7, deps)).draft).toEqual(next);
  });
  it("写入绑定owner与generation，旧版本冲突不覆盖", async () => {
    const deps = {read:vi.fn(),write:vi.fn(async()=>({generation:"12"}))} as any;
    expect(await writeDigitalHumanCloudDraft(7,draft,"11",deps)).toMatchObject({generation:"12"});
    expect(deps.write.mock.calls[0][0]).toMatchObject({objectName:"digital-human-drafts/user-7/current.json",ifGenerationMatch:"11"});
    expect(JSON.parse(deps.write.mock.calls[0][0].buffer.toString()).draft).toEqual(draft);
    await expect(writeDigitalHumanCloudDraft(8,draft,"0",deps)).rejects.toThrow("账号");
    deps.write.mockRejectedValue(new Error("gcs_upload_failed:412:{}"));
    await expect(writeDigitalHumanCloudDraft(7,draft,"11",deps)).rejects.toThrow("云端数字人稿件已变化");
  });
});

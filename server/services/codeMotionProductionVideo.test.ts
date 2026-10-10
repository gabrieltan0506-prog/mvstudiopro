import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  tier: "free" as "free" | "paid",
  revisionPrice: null as any,
  project: null as any,
  files: new Map<string, Buffer>(),
  tasks: new Map<string, any>(),
  intents: new Map<string, string>(),
  calls: [] as string[],
}));
vi.mock("./codeMotionStore", () => ({
  codeMotionStorage: {
    read: vi.fn(async (n: string) =>
      state.files.has(n) ? { body: state.files.get(n), generation: "1" } : null
    ),
    write: vi.fn(async (n: string, b: Buffer, g: string) => {
      if (g === "0" && state.files.has(n)) throw Error("conflict");
      state.files.set(n, b);
      state.calls.push("persist");
      return "1";
    }),
    list: vi.fn(async () => []),
  },
  loadCodeMotion: vi.fn(async () => ({
    project: state.project,
    generation: "1",
  })),
}));
vi.mock("../credits", () => ({
  getUserPlan: vi.fn(async () => (state.tier === "paid" ? "pro" : "free")),
}));
vi.mock("./codeMotionImport", () => ({ assertCodeMotionImageSource: vi.fn() }));
vi.mock("./codeMotionAudio", () => ({
  assertCodeMotionAudioOwnership: vi.fn(),
}));
vi.mock("./inkFreeQuota", () => ({
  inkSource: () => ({ day: "2026-10-10", ipHash: "fixture" }),
}));
vi.mock("./codeMotionProductionGrant", async importOriginal => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    getCodeMotionProductionGrant: vi.fn(async () => ({
      id: "33333333-3333-4333-8333-333333333333",
      tier: state.tier,
      ...(state.revisionPrice ? {revision:{mode:"paid_video",sceneIndexes:[0],quoteFingerprint:state.revisionPrice.fingerprint}} : {}),
    })),
    ensureCodeMotionProductionGrant: vi.fn(async () => {
      state.calls.push("grant");
      return { id: "33333333-3333-4333-8333-333333333333", tier: state.tier,...(state.revisionPrice ? {revision:{mode:"paid_video",sceneIndexes:[0]}} : {}) };
    }),
    reserveCodeMotionProductionSlot: vi.fn(async () => {
      state.calls.push("slot");
      return { tier: state.tier };
    }),
    assertCodeMotionProductionSlot: vi.fn(async () => ({ tier: state.tier })),
  };
});
vi.mock("./codeMotionRevision",()=>({getCodeMotionRevisionPrice:async()=>state.revisionPrice}));
vi.mock("./codeMotionProductionAudio", () => ({
  codeMotionProductionAudioFingerprint: () => "fixture-audio-hash",
  prepareCodeMotionProductionAudio: vi.fn(
    async (_u: any, _p: any, shot: any) =>
      shot.audioFingerprint ? ["gs://fixture/trimmed-five-seconds.wav"] : []
  ),
  getCodeMotionProductionAudio: vi.fn(async () => ({
    uri: "gs://fixture/trimmed-five-seconds.wav",
  })),
}));
vi.mock("./evolinkSeedanceVideo", async importOriginal => ({
  ...(await importOriginal<any>()),
  isEvolinkSeedanceConfigured: () => true,
}));
vi.mock("./canvasVideoTask", () => ({
  createCanvasVideoTask: vi.fn(async (input: any) => {
    state.calls.push("create");
    const task = { ...input, status: "running" };
    state.tasks.set(input.taskId, task);
    return task;
  }),
  peekCanvasVideoTask: vi.fn(async (id: string) => state.tasks.get(id) || null),
  getCanvasVideoTask: vi.fn(async (id: string) => state.tasks.get(id) || null),
}));
vi.mock("./canvasGenerationIntent", () => ({
  lookupCanvasIntent: vi.fn(async ({ intentId }: any) => {
    const taskId = state.intents.get(intentId);
    return taskId ? { kind: "ok", record: { taskId } } : { kind: "none" };
  }),
}));
vi.mock("../../api/jobs", () => ({
  gateCanvasIntentBeforeCharge: vi.fn(async ({ intentId }: any) => {
    state.calls.push("intent");
    const prior = state.intents.get(intentId);
    if (prior)
      return {
        holderId: "holder",
        taskId: prior,
        step: { proceed: false, kind: "existing", taskId: prior },
      };
    const taskId = `cv_${state.intents.size + 100000000}`;
    state.intents.set(intentId, taskId);
    return { holderId: "holder", taskId, step: { proceed: true } };
  }),
  canvasIntentStepReply: vi.fn(async (step: any) =>
    step.proceed
      ? null
      : { status: 200, body: { ok: true, taskId: step.taskId } }
  ),
  markCanvasIntentStage: vi.fn(async () => true),
  releaseCanvasIntentAfterChargeFailure: vi.fn(),
  chargeCanvasVideoCredits: vi.fn(async () => {
    state.calls.push("charge");
    return { ok: true, userId: 7, credits: state.revisionPrice ? 37 : 130 };
  }),
  refundCanvasChargeOnCreateFail: vi.fn(),
}));
import {
  prepareCodeMotionProductionVideo,
  submitCodeMotionProductionVideo,
  planCodeMotionProductionVideo,
  listCodeMotionProductionVideo,
  assertCodeMotionProductionVideoTask,
} from "./codeMotionProductionVideo";
import { createCanvasVideoTask } from "./canvasVideoTask";
import { chargeCanvasVideoCredits } from "../../api/jobs";
const id = "11111111-1111-4111-8111-111111111111",
  imageId = "22222222-2222-4222-8222-222222222222";
function project() {
  return {
    id,
    brief: {
      title: "镜头",
      request: "动作介绍",
      text: "",
      style: "words",
      duration: 20,
      orientation: "landscape",
      images: [
        {
          id: imageId,
          name: "图",
          gcsUri: `gs://fixture/uploads/u7/code-motion/${"a".repeat(64)}.png`,
        },
      ],
      audios: [],
      data: [],
      unit: "",
      chart: "bar",
      period: "",
      source: "",
    },
    plan: {
      version: 1,
      summary: "四镜",
      scenes: Array.from({ length: 4 }, (_, i) => ({
        heading: `镜${i}`,
        body: "向前一步",
        duration: 5,
        ...(i === 0 ? { imageId } : {}),
        production: {
          imagePrompt: "场景",
          motion: i === 0 ? "natural" : "code",
          videoPrompt: "人物向前一步",
          referenceVideoIds: [],
        },
      })),
      audioTimeline: [],
    },
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  state.tier = "free";
  state.revisionPrice=null;
  state.project = project();
  state.files.clear();
  state.tasks.clear();
  state.intents.clear();
  state.calls.length = 0;
});
describe("映客正式视频生产入口", () => {
  it("免费Mini480p完整走manifest→名额→intent→worker，恢复不会创建第二个视频或扣积分", async () => {
    const prepared = await prepareCodeMotionProductionVideo("7", {
      projectId: id,
      expectedGeneration: "1",
    });
    const input = {
      projectId: id,
      expectedGeneration: "1",
      confirmedFingerprint: prepared.fingerprint,
    };
    await submitCodeMotionProductionVideo("7", input, {} as any);
    await submitCodeMotionProductionVideo("7", input, {} as any);
    expect(createCanvasVideoTask).toHaveBeenCalledTimes(1);
    expect(chargeCanvasVideoCredits).not.toHaveBeenCalled();
    const task = vi.mocked(createCanvasVideoTask).mock.calls[0][0];
    expect(task).toMatchObject({
      engine: "seedance-mini-evolink",
      duration: 5,
      resolution: "480p",
      creditsCharged: 0,
      inkProduction: { kind: "video", index: 0 },
    });
    expect(state.calls.indexOf("slot")).toBeLessThan(
      state.calls.indexOf("create")
    );
    expect(state.calls.indexOf("persist")).toBeLessThan(
      state.calls.indexOf("create")
    );
    expect((await listCodeMotionProductionVideo("7", id)).shots[0].status).toBe(
      "running"
    );
    await expect(
      assertCodeMotionProductionVideoTask({ ...task, status: "queued" } as any)
    ).resolves.toBeUndefined();
    await expect(
      assertCodeMotionProductionVideoTask({
        ...task,
        status: "queued",
        audioUrls: ["gs://other/audio.wav"],
      } as any)
    ).rejects.toThrow("参数或账务");
  });
  it("有旁白+BGM时保持两条音源并选择reference_to_video，付费使用2.5/720p与既有charge", async () => {
    state.tier = "paid";
    state.project.brief.audios = [
      {
        id: "speech",
        gcsUri: "gs://fixture/speech.wav",
        generated: {
          kind: "speech",
          sceneIndex: 0,
          text: "你好",
          voice: "female",
        },
      },
      { id: "bgm", gcsUri: "gs://fixture/bgm.wav" },
    ];
    state.project.plan.scenes[0].speech = { text: "你好", voice: "female" };
    state.project.plan.audioTimeline = [
      { sourceId: "speech", at: 0, duration: 3 },
      { sourceId: "bgm", at: 0, duration: 20 },
    ];
    const prepared = await prepareCodeMotionProductionVideo("7", {
      projectId: id,
      expectedGeneration: "1",
    });
    expect(prepared.shots[0]).toMatchObject({
      model: "seedance-2.5",
      resolution: "720p",
      mode: "reference_to_video",
      audioUrls: ["gs://fixture/speech.wav", "gs://fixture/bgm.wav"],
    });
    await submitCodeMotionProductionVideo(
      "7",
      {
        projectId: id,
        expectedGeneration: "1",
        confirmedFingerprint: prepared.fingerprint,
      },
      {} as any
    );
    expect(chargeCanvasVideoCredits).toHaveBeenCalledTimes(1);
    expect(createCanvasVideoTask).toHaveBeenCalledWith(
      expect.objectContaining({
        engine: "seedance25-evolink",
        workMode: "reference_to_video",
        audioUrls: ["gs://fixture/trimmed-five-seconds.wav"],
        creditsCharged: 130,
      })
    );
  });
  it("只有BGM不能冒充已采用旁白；纯代码场景不调用视频模型", () => {
    state.project.plan.scenes[0].speech = { text: "缺旁白", voice: "female" };
    state.project.brief.audios = [
      { id: "bgm", gcsUri: "gs://fixture/bgm.wav" },
    ];
    state.project.plan.audioTimeline = [
      { sourceId: "bgm", at: 0, duration: 20 },
    ];
    expect(
      planCodeMotionProductionVideo(state.project, "free")[0].missing
    ).toContain("请先生成并采用本镜旁白");
    state.project.plan.scenes[0].production.motion = "code";
    expect(planCodeMotionProductionVideo(state.project, "free")).toEqual([]);
  });
  it("不足4秒或超过5秒的自然镜头在生成前拒绝，不能生成半镜假装覆盖完整场景", () => {
    for (const duration of [3, 6]) {
      state.project.plan.scenes[0].duration = duration;
      expect(() =>
        planCodeMotionProductionVideo(state.project, "free")
      ).toThrow("4–5秒");
    }
    expect(createCanvasVideoTask).not.toHaveBeenCalled();
  });
  it("reused original composition images remain video references when no generated scene.imageId exists", () => {
    delete state.project.plan.scenes[0].imageId;
    state.project.plan.scenes[0].composition = {
      elements: [
        { type: "image", imageId },
        { type: "image", imageId },
      ],
    };
    const shot = planCodeMotionProductionVideo(state.project, "free")[0];
    expect(shot.imageUrls).toEqual([state.project.brief.images[0].gcsUri]);
    expect(shot.missing).not.toContain("请先生成并采用本镜场景图");
  });
});

it("paid revision submits only its selected shot via original intent/charge/task and restores without a second charge",async()=>{
 state.tier="paid";
 const shot=planCodeMotionProductionVideo(state.project,"paid")[0];shot.credits=37;
 state.revisionPrice={fingerprint:"a".repeat(64),credits:37,shot};
 state.project.plan.scenes[1]={...state.project.plan.scenes[0],heading:"保留的另一个动作镜"};
 const prepared=await prepareCodeMotionProductionVideo("7",{projectId:id,expectedGeneration:"1"});
 expect(prepared.shots).toHaveLength(1);expect(prepared.totalCredits).toBe(37);
 const input={projectId:id,expectedGeneration:"1",confirmedFingerprint:prepared.fingerprint};
 await submitCodeMotionProductionVideo("7",input,{} as any);
 await submitCodeMotionProductionVideo("7",input,{} as any);
 expect(chargeCanvasVideoCredits).toHaveBeenCalledTimes(1);
 expect(vi.mocked(chargeCanvasVideoCredits).mock.calls[0][1]).toMatchObject({pricingMode:"inkRevisionVideo",inkRevisionSlot:{kind:"video",index:0}});
 expect(createCanvasVideoTask).toHaveBeenCalledTimes(1);
 expect(vi.mocked(createCanvasVideoTask).mock.calls[0][0]).toMatchObject({creditsCharged:37,engine:"seedance25-evolink",resolution:"720p"});
});
it("free prepare rejects three natural shots before any intent, charge or upstream work",async()=>{
 state.project.plan.scenes.forEach((scene:any,index:number)=>{if(index<3){scene.imageId=imageId;scene.production.motion="natural";}});
 await expect(prepareCodeMotionProductionVideo("7",{projectId:id,expectedGeneration:"1"})).rejects.toThrow("最多生成2");
 expect(state.calls).toEqual([]);
});

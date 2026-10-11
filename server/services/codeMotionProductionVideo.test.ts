import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  tier: "free" as "free" | "paid",
  revisionPrice: null as any,
  byteplusConfigured: true,
  probeDuration:5.08,
  intentInputs: new Map<string,string>(),
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
      ...(state.revisionPrice ? {revision:{mode:state.revisionPrice.shot.editSource?"video_edit":"paid_video",sceneIndexes:[0],quoteFingerprint:state.revisionPrice.fingerprint}} : {}),
    })),
    ensureCodeMotionProductionGrant: vi.fn(async () => {
      state.calls.push("grant");
      return { id: "33333333-3333-4333-8333-333333333333", tier: state.tier,...(state.revisionPrice ? {revision:{mode:state.revisionPrice.shot.editSource?"video_edit":"paid_video",sceneIndexes:[0]}} : {}) };
    }),
    reserveCodeMotionProductionSlot: vi.fn(async () => {
      state.calls.push("slot");
      return { tier: state.tier };
    }),
    assertCodeMotionProductionSlot: vi.fn(async () => ({ tier: state.tier })),
  };
});
vi.mock("./codeMotionRevisionEdit",()=>({verifyCodeMotionEditSource:vi.fn()}));
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
vi.mock("./postProduction",async original=>({...await original<any>(),
 fetchPostProdSourceToFile:vi.fn(async(_source:string,file:string)=>{const {writeFile}=await import("node:fs/promises");await writeFile(file,Buffer.from("unchanged-archived-video-fixture"));}),
 runMediaTool:vi.fn(async()=>({stdout:JSON.stringify({streams:[{codec_type:"video",duration:String(state.probeDuration)},{codec_type:"audio",duration:"5.300"}],format:{duration:"5.300"}})})),
}));
vi.mock("./gcs",()=>({getGcsBucketName:()=>"fixture",signGsUriV4ReadUrl:(uri:string)=>`https://storage.googleapis.com/${uri.slice(5)}?signature=fixture`}));
vi.mock("./byteplusSeedanceVideo",async original=>({...await original<any>(),isByteplusSeedanceConfigured:()=>state.byteplusConfigured,buildByteplusSeedance25SubmitBody:vi.fn((await original<any>()).buildByteplusSeedance25SubmitBody)}));
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
  gateCanvasIntentBeforeCharge: vi.fn(async ({ intentId, taskInput }: any) => {
    state.calls.push("intent");
    const prior = state.intents.get(intentId);
    if (prior && state.intentInputs.get(intentId)!==JSON.stringify(taskInput)) throw Error("historical intent changed");
    if (prior)
      return {
        holderId: "holder",
        taskId: prior,
        step: { proceed: false, kind: "existing", taskId: prior },
      };
    const taskId = `cv_${state.intents.size + 100000000}`;
    state.intents.set(intentId, taskId);
    state.intentInputs.set(intentId,JSON.stringify(taskInput));
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
    return { ok: true, userId: 7, credits: state.revisionPrice ? state.revisionPrice.credits : 130 };
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
import { getUserPlan } from "../credits";
import { getCodeMotionProductionGrant } from "./codeMotionProductionGrant";
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
  state.revisionPrice=null;state.byteplusConfigured=true;state.probeDuration=5.08;state.intentInputs.clear();
  state.project = project();
  state.files.clear();
  state.tasks.clear();
  state.intents.clear();
  state.calls.length = 0;
});
describe("映客正式视频生产入口", () => {
  it("measured 4.72-second dialogue extends a four-second scene to a legal five-second prepared model shot",async()=>{
    const {adoptCodeMotionSoundWithMeasuredDuration}=await import("../../shared/codeMotionSoundAdoption");
    state.project.brief.style="scenes";state.project.brief.duration=19;
    state.project.plan.scenes[0].duration=4;
    state.project.plan.scenes[0].speech={text:"请等我把这句话讲完。",voice:"female",role:"dialogue"};
    const source={id:"55555555-5555-4555-8555-555555555555",name:"对白",gcsUri:"gs://fixture/dialogue.wav",duration:4.72,mimeType:"audio/wav" as const,sha256:"a".repeat(64),bytes:100,
      generated:{requestId:"66666666-6666-4666-8666-666666666666",kind:"speech" as const,sceneIndex:0,text:state.project.plan.scenes[0].speech.text,voice:"female" as const,role:"dialogue" as const}};
    state.project=adoptCodeMotionSoundWithMeasuredDuration(state.project,source).project;
    const prepared=await prepareCodeMotionProductionVideo("7",{projectId:id,expectedGeneration:"1"});
    expect(prepared.shots[0]).toMatchObject({duration:5,version:"2.0-mini",mode:"reference_to_video",missing:[]});
    expect(state.project.plan.audioTimeline[0].duration).toBe(4.72);
  });
  it("paid account choosing free without a grant quotes Mini and submits the same free task from an existing image", async () => {
    state.project.brief.generationTier = "free";
    vi.mocked(getCodeMotionProductionGrant).mockResolvedValueOnce(null);
    vi.mocked(getUserPlan).mockResolvedValueOnce("pro");
    const prepared = await prepareCodeMotionProductionVideo("7", {projectId:id, expectedGeneration:"1"});
    expect(prepared.grant).toBeNull();
    expect(prepared).toMatchObject({tier:"free", totalCredits:0, shots:[{version:"2.0-mini", resolution:"480p", credits:0, missing:[]}]});
    const request = {projectId:id, expectedGeneration:"1", confirmedFingerprint:prepared.fingerprint};
    await submitCodeMotionProductionVideo("7", request, {} as any);
    await submitCodeMotionProductionVideo("7", request, {} as any);
    expect(chargeCanvasVideoCredits).not.toHaveBeenCalled();
    expect(createCanvasVideoTask).toHaveBeenCalledTimes(1);
    const task = vi.mocked(createCanvasVideoTask).mock.calls[0][0];
    expect(task).toMatchObject({engine:"seedance-mini-byteplus", resolution:"480p", creditsCharged:0});
    await expect(assertCodeMotionProductionVideoTask({...task,status:"queued"} as any)).resolves.toBeUndefined();
  });
  it("unentitled paid choice fails video preparation before manifest or submission", async () => {
    state.project.brief.generationTier = "paid";
    vi.mocked(getCodeMotionProductionGrant).mockResolvedValueOnce(null);
    await expect(prepareCodeMotionProductionVideo("7",{projectId:id,expectedGeneration:"1"})).rejects.toThrow("尚未开通付费生成");
    expect(state.files.size).toBe(0);
    expect(state.calls).toEqual([]);
  });
  it("dialogue on a code scene requires real matching speech and emits Seedance dialogue/music markers without subtitle or URL instructions", async () => {
    const scene = state.project.plan.scenes[0];
    scene.production.motion = "code";
    scene.production.videoPrompt = "女主转向门口的同伴，听者望着她。";
    scene.speech = {text:"等我一下，我们一起走。",voice:"female",role:"dialogue",emotion:"[empathetic]"};
    const missing = planCodeMotionProductionVideo(state.project,"free")[0];
    expect(missing).toMatchObject({mode:"reference_to_video",missing:["请先生成并采用本镜对白"]});
    state.project.brief.audios = [{id:"speech",gcsUri:"gs://fixture/dialogue.wav",duration:3,generated:{kind:"speech",sceneIndex:0,text:scene.speech.text,voice:"female",role:"dialogue",emotion:"[empathetic]"}}];
    state.project.plan.audioTimeline = [{sourceId:"speech",role:"dialogue",at:0,duration:3,trimStart:0,volume:1}];
    const ready = await prepareCodeMotionProductionVideo("7",{projectId:id,expectedGeneration:"1"});
    expect(ready.shots[0].missing).toEqual([]);
    expect(ready.shots[0].prompt).toContain("{等我一下，我们一起走。}");
    expect(ready.shots[0].prompt).toContain("(沿用 @音频1");
    expect(ready.shots[0].prompt).toContain("听者不张嘴抢话");
    expect(ready.shots[0].prompt).toContain("无字幕、无画面文字");
    expect(ready.shots[0].prompt).not.toMatch(/【|】|gs:\/\/|https?:\/\//);
    const input = {projectId:id,expectedGeneration:"1",confirmedFingerprint:ready.fingerprint};
    await submitCodeMotionProductionVideo("7",input,{} as any);
    await submitCodeMotionProductionVideo("7",input,{} as any);
    expect(createCanvasVideoTask).toHaveBeenCalledTimes(1);
    expect(createCanvasVideoTask).toHaveBeenCalledWith(expect.objectContaining({workMode:"reference_to_video",audioUrls:["gs://fixture/trimmed-five-seconds.wav"],prompt:ready.shots[0].prompt}));
  });
  it("dialogue cannot reuse a narration receipt, wrong emotion, muted voice or shortened speech clip", () => {
    const scene = state.project.plan.scenes[0];
    scene.production.motion = "code";
    scene.speech = {text:"再见",voice:"female",role:"dialogue"};
    const source = {id:"speech",gcsUri:"gs://fixture/dialogue.wav",duration:3,generated:{kind:"speech",sceneIndex:0,text:"再见",voice:"female",role:"dialogue",emotion:""}};
    const clip = {sourceId:"speech",role:"dialogue",at:0,duration:3,trimStart:0,volume:1};
    state.project.brief.audios=[source];state.project.plan.audioTimeline=[clip];
    for(const mutate of [()=>source.generated.role="narration",()=>source.generated.emotion="[tired]",()=>clip.role="narration",()=>clip.volume=0,()=>clip.duration=2]) {
      source.generated.role="dialogue";source.generated.emotion="";clip.role="dialogue";clip.volume=1;clip.duration=3;
      mutate();
      expect(planCodeMotionProductionVideo(state.project,"free")[0].missing).toContain("请先生成并采用本镜对白");
    }
    expect(createCanvasVideoTask).not.toHaveBeenCalled();
    scene.speech.role="narration";
    expect(planCodeMotionProductionVideo(state.project,"free")).toEqual([]);
  });
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
      engine: "seedance-mini-byteplus",
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
        duration: 3,
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
      { sourceId: "speech", role: "narration", at: 0, duration: 3, trimStart: 0, volume: 1 },
      { sourceId: "bgm", role: "bgm", at: 0, duration: 20, trimStart: 0, volume: 0.25 },
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
        engine: "seedance25-byteplus",
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
      { sourceId: "bgm", role: "bgm", at: 0, duration: 20, trimStart: 0, volume: 0.25 },
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

it("historical paid EvoLink revision keeps original intent identity and restores without a second charge",async()=>{
 state.tier="paid";
 const shot=planCodeMotionProductionVideo(state.project,"paid")[0];shot.credits=37;
 state.revisionPrice={fingerprint:"a".repeat(64),credits:37,shot};
 state.project.plan.scenes[1]={...state.project.plan.scenes[0],heading:"保留的另一个动作镜"};
 const prepared=await prepareCodeMotionProductionVideo("7",{projectId:id,expectedGeneration:"1"});
 expect(prepared.shots).toHaveLength(1);expect(prepared.totalCredits).toBe(37);
 state.files.set(`code-motion/u7/production/${id}/video-manifest.json`,Buffer.from(JSON.stringify({projectId:id,grantId:"33333333-3333-4333-8333-333333333333",fingerprint:prepared.fingerprint,shots:prepared.shots,createdAt:"2026-10-10"})));
 state.byteplusConfigured=false;
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

it("new paid revisions stop before any write or charge until BytePlus cost contract is confirmed",async()=>{
 state.tier="paid";const shot=planCodeMotionProductionVideo(state.project,"paid")[0];shot.credits=37;
 state.revisionPrice={fingerprint:"a".repeat(64),credits:37,shot};
 const prepared=await prepareCodeMotionProductionVideo("7",{projectId:id,expectedGeneration:"1"});
 await expect(submitCodeMotionProductionVideo("7",{projectId:id,expectedGeneration:"1",confirmedFingerprint:prepared.fingerprint},{} as any)).rejects.toThrow("核定BytePlus");
 expect(state.calls).toEqual([]);expect(state.files.size).toBe(0);expect(chargeCanvasVideoCredits).not.toHaveBeenCalled();
});
it("missing BytePlus configuration does not silently send a new task straight to EvoLink",async()=>{
 state.byteplusConfigured=false;const prepared=await prepareCodeMotionProductionVideo("7",{projectId:id,expectedGeneration:"1"});
 await expect(submitCodeMotionProductionVideo("7",{projectId:id,expectedGeneration:"1",confirmedFingerprint:prepared.fingerprint},{} as any)).rejects.toThrow("BytePlus视频服务");
 expect(state.calls).toEqual([]);expect(createCanvasVideoTask).not.toHaveBeenCalled();
});
it("new manifest worker accepts only its primary engine or a recorded same-model fallback",async()=>{
 const prepared=await prepareCodeMotionProductionVideo("7",{projectId:id,expectedGeneration:"1"});
 await submitCodeMotionProductionVideo("7",{projectId:id,expectedGeneration:"1",confirmedFingerprint:prepared.fingerprint},{} as any);
 const task=vi.mocked(createCanvasVideoTask).mock.calls[0][0];
 expect(JSON.parse(state.files.get(`code-motion/u7/production/${id}/video-manifest.json`)!.toString()).providerRoute).toBe("byteplus-first");
 await expect(assertCodeMotionProductionVideoTask({...task,engine:"seedance-mini-evolink"} as any)).rejects.toThrow("参数或账务");
 await expect(assertCodeMotionProductionVideoTask({...task,engine:"seedance-mini-evolink",fallbackReason:"明确拒绝"} as any)).resolves.toBeUndefined();
 await expect(assertCodeMotionProductionVideoTask({...task,engine:"seedance25-byteplus"} as any)).rejects.toThrow("参数或账务");
});

it.each([{duration:5.08,accepted:true},{duration:4.98,accepted:true},{duration:1,accepted:true},{duration:8,accepted:true},{duration:0,accepted:false}])("adopt uses video-stream duration $duration and retains nominal timeline/source bytes",async({duration,accepted})=>{
 state.probeDuration=duration;
 const prepared=await prepareCodeMotionProductionVideo("7",{projectId:id,expectedGeneration:"1"});
 await submitCodeMotionProductionVideo("7",{projectId:id,expectedGeneration:"1",confirmedFingerprint:prepared.fingerprint},{} as any);
 const task=Array.from(state.tasks.values())[0];task.status="succeeded";task.videoUrl="gs://fixture/canvas-video/fixture.mp4";
 const {adoptCodeMotionProductionVideo}=await import("./codeMotionProductionVideo");
 const {fetchPostProdSourceToFile,runMediaTool}=await import("./postProduction");
 if (!accepted) {await expect(adoptCodeMotionProductionVideo("7",id,0)).rejects.toThrow("实际时长");return;}
 const result=await adoptCodeMotionProductionVideo("7",id,0);
 expect(result.asset).toMatchObject({durationSec:5,videoUri:task.videoUrl});expect(result.clip.duration).toBe(5);
 const {createHash}=await import("node:crypto");expect(result.asset.sha256).toBe(createHash("sha256").update("unchanged-archived-video-fixture").digest("hex"));
 expect(await adoptCodeMotionProductionVideo("7",id,0)).toEqual(result);
 expect(fetchPostProdSourceToFile).toHaveBeenCalledTimes(1);expect(runMediaTool).toHaveBeenCalledTimes(1);
 const receipt=state.files.get(`code-motion/u7/production/${id}/video-sources/${task.taskId}.json`);expect(JSON.parse(receipt!.toString())).toEqual(result.asset);
});

it.each(["free","paid"] as const)("%s original edit uses EvoLink directly, stable intent and original clip reference",async tier=>{
 state.tier=tier;state.byteplusConfigured=false;
 const asset={id:"original",videoUri:"gs://fixture/canvas-video/original.mp4",sha256:"a".repeat(64),durationSec:5};
 const clip={assetId:asset.id,at:0,duration:5,sourceStartSec:0,fit:"cover"};
 const shot={sceneIndex:0,at:0,duration:5,prompt:"修改原片动作",model:tier==="free"?"seedance-2.0":"seedance-2.5",version:tier==="free"?"2.0":"2.5",resolution:tier==="free"?"480p":"720p",mode:tier==="free"?"reference_to_video":"video_edit",imageUrls:[],videoUrls:[asset.videoUri],audioUrls:[],credits:tier==="free"?0:44,missing:[],editSource:{parentProjectId:id,asset,clip,width:1280,height:720,inputDuration:5}};
 state.project.plan.scenes[0].production.videoPrompt=shot.prompt;
 state.revisionPrice={fingerprint:"c".repeat(64),credits:shot.credits,shot};
 const prepared=await prepareCodeMotionProductionVideo("7",{projectId:id,expectedGeneration:"1"});
 const input={projectId:id,expectedGeneration:"1",confirmedFingerprint:prepared.fingerprint};
 await submitCodeMotionProductionVideo("7",input,{} as any);await submitCodeMotionProductionVideo("7",input,{} as any);
 expect(createCanvasVideoTask).toHaveBeenCalledTimes(1);
 expect(vi.mocked(createCanvasVideoTask).mock.calls[0][0]).toMatchObject({engine:tier==="free"?"seedance20-evolink":"seedance25-evolink",workMode:shot.mode,videoUrls:[asset.videoUri],creditsCharged:shot.credits});
 if(tier==="free") {
  expect(chargeCanvasVideoCredits).not.toHaveBeenCalled();
  const task=vi.mocked(createCanvasVideoTask).mock.calls[0][0] as any;
  await expect(assertCodeMotionProductionVideoTask(task)).resolves.toBeUndefined();
  await expect(assertCodeMotionProductionVideoTask({...task,seedanceVersion:"2.0-fast"})).rejects.toThrow("参数");
 } else expect(chargeCanvasVideoCredits).toHaveBeenCalledTimes(1);
});

it("paid8s retains exact duration from quote through BytePlus submit, same intent restore and formal adoption;30s uses existing long retail",async()=>{
 state.tier="paid";state.project.plan.scenes[0].duration=8;state.project.brief.duration=23;
 const prepared=await prepareCodeMotionProductionVideo("7",{projectId:id,expectedGeneration:"1"});
 expect(prepared.shots[0]).toMatchObject({duration:8,credits:118,version:"2.5"});
 vi.mocked(chargeCanvasVideoCredits).mockResolvedValueOnce({ok:true,userId:7,credits:118});
 const request={projectId:id,expectedGeneration:"1",confirmedFingerprint:prepared.fingerprint};
 await submitCodeMotionProductionVideo("7",request,{} as any);await submitCodeMotionProductionVideo("7",request,{} as any);
 expect(chargeCanvasVideoCredits).toHaveBeenCalledTimes(1);expect(vi.mocked(chargeCanvasVideoCredits).mock.calls[0][1]).toMatchObject({durationSec:8,videoModel:"seedance-2.5",resolution:"720p"});
 const task=Array.from(state.tasks.values())[0];expect(task).toMatchObject({duration:8,creditsCharged:118,engine:"seedance25-byteplus"});
 const {buildByteplusSeedance25SubmitBody}=await import("./byteplusSeedanceVideo");expect(vi.mocked(buildByteplusSeedance25SubmitBody).mock.results[0].value.body.duration).toBe(8);
 task.status="succeeded";task.videoUrl="gs://fixture/canvas-video/eight.mp4";state.probeDuration=8.04;
 const {adoptCodeMotionProductionVideo}=await import("./codeMotionProductionVideo");expect(await adoptCodeMotionProductionVideo("7",id,0)).toMatchObject({asset:{durationSec:8},clip:{duration:8}});
 state.project.plan.scenes[0].duration=30;expect(planCodeMotionProductionVideo(state.project,"paid")[0]).toMatchObject({duration:30,credits:240});
 expect(()=>planCodeMotionProductionVideo(state.project,"free")).toThrow("4–5秒");
});

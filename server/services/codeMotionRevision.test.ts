import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { codeMotionProjectSchema } from "../../shared/codeMotion";
import { artMotionJobSchema } from "../../shared/artMotion";
const h = vi.hoisted(() => ({
  files: new Map<string, { body: Buffer; generation: string }>(),
  n: 0,
  probeWidth:1280,probeDuration:5,
}));
vi.mock("./codeMotionStore", async original => {
  const actual = await original<any>();
  const storage = {
    read: async (n: string) => h.files.get(n) || null,
    write: async (n: string, b: Buffer, g: string) => {
      if ((h.files.get(n)?.generation || "0") !== g) throw Error("CAS");
      const generation = String(++h.n);
      h.files.set(n, { body: b, generation });
      return generation;
    },
    list: async () => [],
  };
  return { ...actual, codeMotionStorage: storage };
});
vi.mock("./postProduction",async original=>({...await original<any>(),fetchPostProdSourceToFile:async(_u:string,file:string)=>{await (await import("node:fs/promises")).writeFile(file,"owned-edit-fixture");},runMediaTool:async()=>({stdout:JSON.stringify({streams:[{codec_type:"video",duration:h.probeDuration,width:h.probeWidth,height:720}]})})}));
vi.mock("./gcs",async original=>({...await original<any>(),signGsUriV4ReadUrl:(uri:string)=>`https://storage.googleapis.com/${uri.slice(5)}?fixture=true`}));
vi.mock("./paidJobLedger",()=>({readActiveJob:async()=>({status:"settlement_pending"}),markSettlementPending:async()=>true}));
import { codeMotionStorage, saveCodeMotion } from "./codeMotionStore";
import {
  codeMotionProductionFingerprint,
  getCodeMotionProductionGrant,
  writeCodeMotionRevisionGrant,
  reserveCodeMotionProductionSlot,
} from "./codeMotionProductionGrant";
import {
  quoteCodeMotionRevision,
  submitCodeMotionRevision,
  codeMotionRevisionAssetParent,
  type RevisionDeps,
} from "./codeMotionRevision";
const projectId = "11111111-1111-4111-8111-111111111111",
  grantId = "22222222-2222-4222-8222-222222222222";
let generation = "",
  completed = true,
  paid = false;
const project = () =>
  codeMotionProjectSchema.parse({
    id: projectId,
    brief: {
      title: "局部修改",
      request: "技术四镜",
      text: "",
      style: "words",
      duration: 20,
      orientation: "landscape",
      images: [],
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
        heading: `原标题${i}`,
        body: "原正文",
        duration: 5,
      })),
    },
  });
const deps: RevisionDeps = {
  storage: codeMotionStorage,
  grant: getCodeMotionProductionGrant,
  writeGrant: writeCodeMotionRevisionGrant,
  plan: async () => (paid ? "pro" : "free"),
  completed: async () => completed,
};
const input = (i: number) => ({
  projectId,
  expectedGeneration: generation,
  requestId: `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, "0")}`,
  changes: [{ index: 1, heading: `新标题${i}`, body: "局部正文" }],
});
beforeEach(async () => {
  h.files.clear();
  h.n = 0;
  completed = true;
  h.probeWidth=1280;h.probeDuration=5;
  paid = false;
  const p = project();
  generation = (await saveCodeMotion("7", p, "0", codeMotionStorage))
    .generation;
  await codeMotionStorage.write(
    `code-motion/u7/production/${projectId}/grant.json`,
    Buffer.from(
      JSON.stringify({
        id: grantId,
        userId: "7",
        projectId,
        generation,
        tier: "free",
        fingerprint: codeMotionProductionFingerprint(p),
        sceneCount: 4,
        duration: 20,
        createdAt: new Date().toISOString(),
        slots: {},
      })
    ),
    "0"
  );
});
async function saveEditableSource(p=project()) {
 p.brief.style="scenes";p.plan!.scenes=p.plan!.scenes.map((scene,i)=>({...scene,composition:scene.composition||{id:`s${i}`,duration:5,elements:[{id:"title",type:"text",text:scene.heading}]}})) as any;
 const asset={id:"owned-edit-clip",videoUri:"gs://fixture/canvas-video/owned-edit.mp4",sha256:createHash("sha256").update("owned-edit-fixture").digest("hex"),durationSec:5};
 p.plan!.codeVideo={version:1,assets:[asset],clips:[{assetId:asset.id,at:5,duration:5,sourceStartSec:0,fit:"cover"}]};
 await codeMotionStorage.write(`code-motion/u7/production/${projectId}/video-sources/${asset.id}.json`,Buffer.from(JSON.stringify(asset)),"0");
 generation=(await saveCodeMotion("7",p,generation,codeMotionStorage)).generation;
 return p;
}
describe("confirmed local revisions", () => {
  it("code-only edits over a dialogue video fail before consuming a revision or creating a child", async () => {
    const p = project();
    p.plan!.scenes[1].speech = {text:"一起走吧",voice:"male",role:"dialogue"};
    const original = await saveEditableSource(p);
    const snapshot = Array.from(h.files.entries()).map(([key,value])=>[key,value.body.toString(),value.generation]);
    const writes = h.n;
    await expect(submitCodeMotionRevision("7",input(1),deps)).rejects.toThrow("已有原视频");
    expect(h.n).toBe(writes);
    expect(Array.from(h.files.entries()).map(([key,value])=>[key,value.body.toString(),value.generation])).toEqual(snapshot);
    expect((await quoteCodeMotionRevision("7",projectId,deps)).remaining).toBe(2);
    expect(original.plan!.codeVideo!.clips[0].assetId).toBe("owned-edit-clip");
    expect(original.plan!.scenes[1].speech!.role).toBe("dialogue");
  });
  it("previews consume none; concurrent requests accept only two; identical request restores same child", async () => {
    expect(
      (await quoteCodeMotionRevision("7", projectId, deps)).remaining
    ).toBe(2);
    const results = await Promise.allSettled(
      [1, 2, 3].map(i => submitCodeMotionRevision("7", input(i), deps))
    );
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(2);
    const first = results.findIndex(r => r.status === "fulfilled") + 1;
    const a = await submitCodeMotionRevision("7", input(first), deps),
      b = await submitCodeMotionRevision("7", input(first), deps);
    expect(a.project.id).toBe(b.project.id);
    expect(
      (await quoteCodeMotionRevision("7", projectId, deps)).remaining
    ).toBe(0);
    await expect(
      submitCodeMotionRevision(
        "7",
        {
          ...input(first),
          changes: [{ index: 1, heading: "改请求", body: "" }],
        },
        deps
      )
    ).rejects.toThrow("编号");
    await expect(
      reserveCodeMotionProductionSlot("7", {
        projectId: a.project.id,
        grantId: a.grant.id,
        kind: "image",
        index: 1,
        requestId: "extra",
        digest: "a".repeat(64),
      })
    ).rejects.toThrow("沿用");
  });
  it("unfinished version and other account cannot obtain revision; no ledger is consumed", async () => {
    completed = false;
    await expect(submitCodeMotionRevision("7", input(1), deps)).rejects.toThrow(
      "成片"
    );
    await expect(submitCodeMotionRevision("8", input(1), deps)).rejects.toThrow(
      "授权"
    );
    expect(
      (await quoteCodeMotionRevision("7", projectId, deps)).remaining
    ).toBe(2);
  });
  it("second revision of a child shares the root limit, upgrade code-only uses no guessed provider charge", async () => {
    const child = await submitCodeMotionRevision("7", input(1), deps);
    await submitCodeMotionRevision(
      "7",
      {
        ...input(2),
        projectId: child.project.id,
        expectedGeneration: child.generation,
      },
      deps
    );
    await expect(submitCodeMotionRevision("7", input(3), deps)).rejects.toThrow(
      "充值升级"
    );
    paid = true;
    const upgraded = await submitCodeMotionRevision("7", input(3), deps);
    expect(upgraded.grant.tier).toBe("paid");
    expect(
      (await quoteCodeMotionRevision("7", projectId, deps)).costCredits
    ).toBe(0);
  });
  it("asset reuse requires exact original revision snapshot; unrelated source metadata cannot inherit authority", async () => {
    const p = project();
    const source = {
      id: "44444444-4444-4444-8444-444444444444",
      name: "原音",
      gcsUri: `gs://bucket/post-prod/7/code-motion/${projectId}/audio/44444444-4444-4444-8444-444444444444/${"a".repeat(64)}.wav`,
      duration: 20,
      mimeType: "audio/wav" as const,
      sha256: "a".repeat(64),
      bytes: 48000,
    };
    p.brief.audios = [source];
    p.plan!.audioTimeline = [
      {
        sourceId: source.id,
        role: "bgm",
        at: 0,
        trimStart: 0,
        duration: 20,
        volume: 1,
        fadeIn: 0,
        fadeOut: 0,
      },
    ];
    generation = (await saveCodeMotion("7", p, generation, codeMotionStorage))
      .generation;
    const child = await submitCodeMotionRevision("7", input(1), deps);
    expect(
      await codeMotionRevisionAssetParent(
        "7",
        child.project.id,
        "audio",
        source
      )
    ).toBe(projectId);
    expect(
      await codeMotionRevisionAssetParent("7", child.project.id, "audio", {
        ...source,
        sha256: "b".repeat(64),
      })
    ).toBeNull();
    expect(
      await codeMotionRevisionAssetParent(
        "8",
        child.project.id,
        "audio",
        source
      )
    ).toBeNull();
    const { assertCodeMotionAudioOwnership } = await import(
      "./codeMotionAudio"
    );
    const owned = {
      userId: "7",
      projectId: child.project.id,
      audio: { sources: [source], audioTimeline: p.plan!.audioTimeline },
    };
    await expect(
      assertCodeMotionAudioOwnership(owned, {
        resolve: async ({ source }) => source,
        revisionParent: (u, p, a) =>
          codeMotionRevisionAssetParent(u, p, "audio", a),
      })
    ).resolves.toBeUndefined();
    await expect(
      assertCodeMotionAudioOwnership(
        {
          ...owned,
          audio: {
            ...owned.audio,
            sources: [{ ...source, sha256: "b".repeat(64) }],
          },
        },
        {
          resolve: async ({ source }) => source,
          revisionParent: (u, p, a) =>
            codeMotionRevisionAssetParent(u, p, "audio", a),
        }
      )
    ).rejects.toThrow("归档身份");
  });

  it("lost response plus browser reload/new request UUID restores the same confirmed edit without consuming another chance", async () => {
    const a = await submitCodeMotionRevision("7", input(1), deps);
    const b = await submitCodeMotionRevision(
      "7",
      { ...input(1), requestId: input(2).requestId },
      deps
    );
    expect(a.project.id).toBe(b.project.id);
    expect(
      (await quoteCodeMotionRevision("7", projectId, deps)).remaining
    ).toBe(1);
  });
  it("official child export keeps parent audio and untouched generated video through compiler and ownership gates", async () => {
    const p = project();
    const source = {
      id: "44444444-4444-4444-8444-444444444444",
      name: "原混音",
      gcsUri: `gs://bucket/post-prod/7/code-motion/${projectId}/audio/44444444-4444-4444-8444-444444444444/${"a".repeat(64)}.wav`,
      duration: 20,
      mimeType: "audio/wav" as const,
      sha256: "a".repeat(64),
      bytes: 48000,
    };
    p.brief.audios = [source];
    p.plan!.audioTimeline = [
      {
        sourceId: source.id,
        role: "bgm",
        at: 0,
        trimStart: 0,
        duration: 20,
        volume: 1,
        fadeIn: 0,
        fadeOut: 0,
      },
    ];
    const asset = {
      id: "original-clip",
      videoUri: "gs://bucket/archived/original.mp4",
      sha256: "b".repeat(64),
      durationSec: 5,
    };
    p.brief.style = "scenes";
    p.plan!.scenes.forEach((scene, index) => {
      scene.composition = {
        id: `scene${index}`,
        duration: 5,
        elements: [{ id: `title${index}`, type: "text", text: scene.heading }],
      } as any;
    });
    p.plan!.scenes[0].production = {
      imagePrompt: "原图",
      videoPrompt: "原动作",
      motion: "natural",
    };
    p.plan!.codeVideo = {
      version: 1,
      assets: [asset],
      clips: [
        {
          assetId: asset.id,
          at: 0,
          duration: 5,
          sourceStartSec: 0,
          fit: "cover",
        },
      ],
    };
    generation = (await saveCodeMotion("7", p, generation, codeMotionStorage))
      .generation;
    await codeMotionStorage.write(
      `code-motion/u7/production/${projectId}/video-sources/${asset.id}.json`,
      Buffer.from(JSON.stringify(asset)),
      "0"
    );
    const child = await submitCodeMotionRevision("7", input(1), deps);
    const { codeMotionRenderIdentity, submitCodeMotion } = await import(
      "./codeMotionTask"
    );
    const { assertCodeMotionAudioOwnership } = await import(
      "./codeMotionAudio"
    );
    const { assertCodeMotionProductionVideos } = await import(
      "./codeMotionProductionVideo"
    );
    const queued: unknown[] = [];
    const identity = codeMotionRenderIdentity("7", child.project);
    const result = await submitCodeMotion(
      "7",
      child.project,
      identity.fingerprint,
      {
        load: async () => null,
        resolve: async ({ input }) => artMotionJobSchema.parse(input),
        queue: async (_u, input) => {
          queued.push(input);
          return { jobId: "child-job", status: "queued" };
        },
        view: vi.fn() as any,
        audioOwnership: input =>
          assertCodeMotionAudioOwnership(input, {
            resolve: async ({ source }) => source,
            revisionParent: (u, p, a) =>
              codeMotionRevisionAssetParent(u, p, "audio", a),
          }),
        videoOwnership: assertCodeMotionProductionVideos,
      }
    );
    expect(result.jobId).toBe("child-job");
    expect((queued[0] as any).params.codeAudio.sources).toEqual([source]);
    expect((queued[0] as any).params.codeVideo.assets).toEqual([asset]);
    expect((queued[0] as any).params.codeVideo.clips[0].at).toBe(0);
  });
});

describe("paid action revision cost contract", () => {
  it("locks a single paid scene at actual fixed tool units ×2; restores once and rejects unquoted inputs", async () => {
    paid = true;
    const p = project(),
      imageId = "33333333-3333-4333-8333-333333333333";
    p.brief.style = "scenes";
    p.brief.images = [
      {
        id: imageId,
        name: "原场景",
        gcsUri: `gs://fixture/uploads/u7/code-motion/${"c".repeat(64)}.png`,
      },
    ];
    p.plan!.scenes[1].imageId = imageId;
    p.plan!.scenes = p.plan!.scenes.map((scene, i) => ({
      ...scene,
      composition: {
        id: `scene${i}`,
        duration: 5,
        elements: [
          { id: "photo", type: "image", imageId, width: 1, height: 1 },
        ],
      },
    })) as any;
    await saveEditableSource(p);
    const { prepareCodeMotionRevision, getCodeMotionRevisionPrice } =
      await import("./codeMotionRevision");
    const {
      revisionVideoCost,
      codeMotionRevisionCharge,
      settleCodeMotionRevisionCost,
    } = await import("./codeMotionRevisionPricing");
    expect(revisionVideoCost(5)).toEqual({ costUsd: 1.628, credits: 37 });
    const raw = {
      ...input(8),
      changes: [
        { ...input(8).changes[0], motionPrompt: "杯中白色蒸汽缓慢上升" },
      ],
    };
    const price = await prepareCodeMotionRevision("7", raw, deps);
    expect(price.credits).toBe(44);
    await expect(submitCodeMotionRevision("7", raw, deps)).rejects.toThrow(
      "确认"
    );
    const confirmed = { ...raw, confirmedQuote: price.fingerprint };
    const child = await submitCodeMotionRevision("7", confirmed, deps);
    expect(child.grant.revision).toMatchObject({
      mode: "video_edit",
      sceneIndexes: [1],
    });
    expect(
      (await submitCodeMotionRevision("7", confirmed, deps)).project.id
    ).toBe(child.project.id);
    expect(await getCodeMotionRevisionPrice("7", child.project.id)).toEqual(
      price
    );
    const { codeMotionProductionDigest } = await import(
      "./codeMotionProductionGrant"
    );
    const slot = {
      projectId: child.project.id,
      grantId: child.grant.id,
      kind: "video" as const,
      index: 1,
      requestId: "fixed-video",
      digest: codeMotionProductionDigest(price.shot),
    };
    await reserveCodeMotionProductionSlot("7", slot);
    expect(await codeMotionRevisionCharge("7", slot)).toBe(44);
    await expect(
      reserveCodeMotionProductionSlot("7", { ...slot, index: 0 })
    ).rejects.toThrow();
    await expect(
      reserveCodeMotionProductionSlot("7", {
        ...slot,
        kind: "image_semantic",
        index: 0,
      })
    ).rejects.toThrow();
    const { prepareCodeMotionProductionVideo } = await import(
      "./codeMotionProductionVideo"
    );
    const prepared = await prepareCodeMotionProductionVideo("7", {
      projectId: child.project.id,
      expectedGeneration: child.generation,
    });
    expect(prepared.shots).toHaveLength(1);
    expect(prepared.totalCredits).toBe(44);
    const task = {
      userId: 7,
      taskId: "cv_revision",
      inkProduction: slot,
      creditsCharged: 44,
      duration: 5,
      evolinkTaskId: "upstream-original",
      engine:"seedance25-evolink",
    } as any;
    await expect(settleCodeMotionRevisionCost(task)).rejects.toThrow(
      "成功回执"
    );
    await codeMotionStorage.write(
      `code-motion/u7/production/${child.project.id}/video-evidence/1/terminal-raw.json`,
      Buffer.from('{"status":"completed","id":"upstream-original"}'),
      "0"
    );
    await settleCodeMotionRevisionCost(task,"https://storage.googleapis.com/fixture/result.mp4");
    await settleCodeMotionRevisionCost(task,"https://storage.googleapis.com/fixture/result.mp4");
    const file = await codeMotionStorage.read(
      `code-motion/u7/production/${child.project.id}/video-evidence/1/cost-settlement.json`
    );
    expect(JSON.parse(file!.body.toString())).toMatchObject({
      costUsd: 1.98,
      creditsCharged: 44,
      basis: "published_rate_measured_units",
      status: "settled",
    });
    await expect(
      settleCodeMotionRevisionCost({ ...task, creditsCharged: 130 })
    ).rejects.toThrow("金额");
  }, 30000);
  it("never drops existing video references to fit an incomplete price", async () => {
    const { priceCodeMotionRevision } = await import(
      "./codeMotionRevisionPricing"
    );
    const p = project();
    p.plan!.scenes[1].production = {
      imagePrompt: "场景",
      motion: "natural",
      videoPrompt: "动作",
      referenceVideoIds: ["cv_existing"],
    };
    await expect(
      priceCodeMotionRevision(p, {
        index: 1,
        heading: "镜头",
        body: "",
        motionPrompt: "新动作",
      })
    ).rejects.toThrow("视频参考");
  }, 30000);
});

describe("original-clip edit grant",()=>{
 it("free original edit preserves the source, uses standard2.0 and consumes one root revision only",async()=>{
  await saveEditableSource();
  const {prepareCodeMotionRevision}=await import("./codeMotionRevision");
  const raw={...input(31),changes:[{...input(31).changes[0],motionPrompt:"保留原镜头，将蒸汽降低"}]};
  const price=await prepareCodeMotionRevision("7",raw,deps);
  expect(price.shot).toMatchObject({version:"2.0",mode:"reference_to_video",resolution:"480p",credits:0});
  expect((await quoteCodeMotionRevision("7",projectId,deps)).remaining).toBe(2);
  const child=await submitCodeMotionRevision("7",{...raw,confirmedQuote:price.fingerprint},deps);
  expect(child.grant.revision?.mode).toBe("video_edit");
  expect(child.project.plan!.codeVideo!.clips).toHaveLength(1);
  expect((await quoteCodeMotionRevision("7",child.project.id,deps)).remaining).toBe(1);
  paid=true;
  const restored=await submitCodeMotionRevision("7",{...raw,confirmedQuote:price.fingerprint},deps);
  expect(restored.project.id).toBe(child.project.id);expect(restored.grant.tier).toBe("free");
  paid=false;
  const {codeMotionProductionDigest}=await import("./codeMotionProductionGrant");
  const slot={projectId:child.project.id,grantId:child.grant.id,kind:"video" as const,index:1,requestId:"edit-once",digest:codeMotionProductionDigest(price.shot)};
  await reserveCodeMotionProductionSlot("7",slot);
  await expect(reserveCodeMotionProductionSlot("7",{...slot,index:0})).rejects.toThrow();
  await expect(reserveCodeMotionProductionSlot("7",{...slot,kind:"image"})).rejects.toThrow();
 });
 it("missing source and low-resolution paid input fail before a revision is consumed",async()=>{
  const {prepareCodeMotionRevision}=await import("./codeMotionRevision");
  const raw={...input(32),changes:[{...input(32).changes[0],motionPrompt:"修改原片"}]};
  await expect(prepareCodeMotionRevision("7",raw,deps)).rejects.toThrow("原片");
  await saveEditableSource();paid=true;h.probeWidth=200;
  await expect(prepareCodeMotionRevision("7",{...raw,expectedGeneration:generation},deps)).rejects.toThrow("高清放大");
  expect((await quoteCodeMotionRevision("7",projectId,deps)).used).toBe(0);
 });
});

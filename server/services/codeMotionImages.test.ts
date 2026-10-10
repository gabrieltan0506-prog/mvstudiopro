import { describe, expect, it, vi } from "vitest";
import { codeMotionProductionFingerprint } from "./codeMotionProductionGrant";
import {
  loadCodeMotion,
  saveCodeMotion,
  type CodeMotionStoreDeps,
} from "./codeMotionStore";
import {
  prepareCodeMotionImages,
  submitCodeMotionImages,
  listCodeMotionImages,
  adoptCodeMotionImage,
  resolveCodeMotionImageWorkerPolicy,
  type CodeMotionImagesDeps,
} from "./codeMotionImages";

const projectId = "11111111-1111-4111-8111-111111111111";
const grantId = "22222222-2222-4222-8222-222222222222";
async function setup(tier: "free" | "paid" = "free") {
  const files = new Map<string, { body: Buffer; generation: string }>();
  const storage: CodeMotionStoreDeps = {
    read: async name => files.get(name) ?? null,
    list: async prefix => Array.from(files.keys()).filter(k => k.startsWith(prefix)),
    write: async (name, body, generation) => {
      if ((files.get(name)?.generation ?? "0") !== generation)
        throw Error("conflict");
      const next = String(Number(generation) + 1);
      files.set(name, { body, generation: next });
      return next;
    },
  };
  await saveCodeMotion(
    "1",
    {
      id: projectId,
      brief: {
        title: "测试短片",
        request: "按分镜描述生成",
        style: "cards",
        duration: 20,
        orientation: "landscape",
        images: [],
      },
      plan: {
        version: 1,
        summary: "四镜",
        scenes: Array.from({ length: 4 }, (_, i) => ({
          heading: `场景${i}`,
          body: "风吹树林",
          direction: "人物走向画面右侧",
          duration: 5,
        })),
      },
    },
    "0",
    storage
  );
  const jobs = new Map<string, any>();
  const grant: any = {
    id: grantId,
    projectId,
    generation: "1",
    tier,
    fingerprint: codeMotionProductionFingerprint(
      (await loadCodeMotion("1", projectId, storage))!.project
    ),
  };
  const deps: CodeMotionImagesDeps = {
    storage,
    grant: vi.fn(async () => grant),
    prepareGrant: vi.fn(async () => grant),
    reserve: vi.fn(async () => grant),
    assertSlot: vi.fn(async () => grant),
    create: vi.fn(async data => {
      jobs.set(data.id, {
        ...data,
        status: "queued",
        output: null,
        error: null,
      });
      return data.id;
    }),
    job: vi.fn(async id => jobs.get(id) ?? null),
    resolve: vi.fn(async ({ source }) => source),
    preview: vi.fn(async uri => `preview:${uri}`),
    imageSize: vi.fn(async () => 4),
    importFile: vi.fn(async (_, input) => ({
      kind: "image" as const,
      image: {
        id: "11111111-1111-4111-8111-111111111111" as const,
        name: input.name,
        gcsUri: `gs://bucket/uploads/u1/code-motion/${"a".repeat(64)}.png`,
      },
      message: "ok",
    })),
  };
  return { deps, jobs, input: { projectId, expectedGeneration: "1", grantId } };
}

describe("saved image production contract", () => {
  it("fixed batch persists before enqueue, restores partial/unknown jobs without repeating them, adopts the same owned bytes", async () => {
    const { deps, jobs, input } = await setup();
    const prepared = await prepareCodeMotionImages("1", input, deps);
    expect(prepared.credits).toBe(0);
    expect(
      prepared.shots.every(
        s => s.model === "gpt-image-2-2026-04-21" && s.quality === "medium"
      )
    ).toBe(true);
    const create = deps.create;
    deps.create = vi.fn(async data => {
      expect(
        (await deps.storage.list(`code-motion/u1/images/${projectId}/`)).length
      ).toBe(1);
      await create(data);
      if (data.id === prepared.shots[1]!.jobId)
        throw Error("response lost after insert");
      return data.id;
    });
    await submitCodeMotionImages(
      "1",
      { ...input, fingerprint: prepared.fingerprint },
      deps
    );
    expect(deps.create).toHaveBeenCalledTimes(4);
    jobs.get(prepared.shots[1]!.jobId).status = "failed";
    jobs.get(prepared.shots[1]!.jobId).error = "结果未知，人工核对";
    const first = jobs.get(prepared.shots[0]!.jobId);
    first.status = "succeeded";
    first.output = { imageUrl: "gs://bucket/generated/shot.png" };
    await submitCodeMotionImages(
      "1",
      { ...input, fingerprint: prepared.fingerprint },
      deps
    );
    expect(deps.create).toHaveBeenCalledTimes(4);
    const restored = await listCodeMotionImages("1", projectId, deps);
    expect(restored[0]!.shots[1]).toMatchObject({
      status: "failed",
      canResume: false,
    });
    const adopted = await adoptCodeMotionImage(
      "1",
      { projectId, grantId, index: 0 },
      deps
    );
    expect(adopted).toMatchObject({
      sceneIndex: 0,
      image: { id: prepared.shots[0]!.requestId },
    });
    expect(deps.importFile).toHaveBeenCalledWith(
      "1",
      expect.objectContaining({ gcsUri: "gs://bucket/generated/shot.png" })
    );
    await expect(
      adoptCodeMotionImage("1", { projectId, grantId, index: 1 }, deps)
    ).rejects.toThrow("尚未完成");
  });

  it("worker refuses forged input/owner/slot and paid quote uses existing per-shot prices", async () => {
    const { deps, jobs, input } = await setup("paid");
    const prepared = await prepareCodeMotionImages("1", input, deps);
    expect(prepared.credits).toBe(54 + 49 * 3);
    await submitCodeMotionImages(
      "1",
      { ...input, fingerprint: prepared.fingerprint },
      deps
    );
    const job = jobs.get(prepared.shots[0]!.jobId),
      context = job.input.params.codeMotionImage;
    await expect(
      resolveCodeMotionImageWorkerPolicy("1", job.id, context, job.input, deps)
    ).resolves.toMatchObject({ credits: 54, model: "gpt-image-2.5-sunburst" });
    await expect(
      resolveCodeMotionImageWorkerPolicy("2", job.id, context, job.input, deps)
    ).rejects.toThrow("凭据无效");
    await expect(
      resolveCodeMotionImageWorkerPolicy(
        "1",
        job.id,
        context,
        { ...job.input, params: { ...job.input.params, prompt: "other" } },
        deps
      )
    ).rejects.toThrow("凭据无效");
    deps.assertSlot = vi.fn(async () => {
      throw Error("未预留");
    });
    await expect(
      resolveCodeMotionImageWorkerPolicy("1", job.id, context, job.input, deps)
    ).rejects.toThrow("未预留");
  });

  it("missing queue rows alone can resume; content/version mismatch never creates or purchases", async () => {
    const { deps, input } = await setup();
    await expect(
      prepareCodeMotionImages("1", { ...input, expectedGeneration: "2" }, deps)
    ).rejects.toThrow("版本");
    const saved = await loadCodeMotion("1", projectId, deps.storage);
    await saveCodeMotion("1", saved!.project, "1", deps.storage);
    input.expectedGeneration = "2";
    const prepared = await prepareCodeMotionImages("1", input, deps);
    await expect(
      submitCodeMotionImages(
        "1",
        { ...input, fingerprint: "f".repeat(64) },
        deps
      )
    ).rejects.toThrow("内容已变化");
    expect(deps.create).not.toHaveBeenCalled();
    const create = deps.create;
    let first = true;
    deps.create = vi.fn(async data => {
      if (first) {
        first = false;
        throw Error("database down before insert");
      }
      return create(data);
    });
    const batch = await submitCodeMotionImages(
      "1",
      { ...input, fingerprint: prepared.fingerprint },
      deps
    );
    expect(batch.shots[0]!.canResume).toBe(true);
    await submitCodeMotionImages(
      "1",
      { ...input, fingerprint: prepared.fingerprint },
      deps
    );
    expect(deps.create).toHaveBeenCalledTimes(5);
  });
});

it("image preview without an existing grant uses a read-only quote and leaves slots, queue and manifest untouched", async () => {
  const { deps, input } = await setup();
  deps.grant = vi.fn(async () => null);
  const preview = await prepareCodeMotionImages("1", input, deps);
  expect(preview.shots).toHaveLength(4);
  expect(deps.prepareGrant).toHaveBeenCalledWith("1", input);
  expect(deps.reserve).not.toHaveBeenCalled();
  expect(deps.create).not.toHaveBeenCalled();
  expect(await deps.storage.list(`code-motion/u1/images/${projectId}/`)).toEqual([]);
});

it("real image preflight edits poor inputs once, reuses suitable originals and still generates missing scenes", async()=>{
  const {deps,input,jobs}=await setup("paid");
  const saved=(await loadCodeMotion("1",projectId,deps.storage))!;
  const small={id:"55555555-5555-4555-8555-555555555555",name:"small.png",gcsUri:`gs://bucket/uploads/u1/code-motion/${"c".repeat(64)}.png`};
  const good={id:"66666666-6666-4666-8666-666666666666",name:"good.png",gcsUri:`gs://bucket/uploads/u1/code-motion/${"d".repeat(64)}.png`};
  saved.project.brief.images=[small,good];
  saved.project.plan!.scenes[0].imageId=small.id;
  saved.project.plan!.scenes[1].imageId=good.id;
  await saveCodeMotion("1",saved.project,"1",deps.storage); input.expectedGeneration="2";
  deps.inspectImage=vi.fn(async(imageId,gcsUri)=>({imageId,gcsUri,width:imageId===small.id?240:1920,height:imageId===small.id?320:1080,bytes:10,sha256:"c".repeat(64)}));
  const prepared=await prepareCodeMotionImages("1",input,deps);
  expect(prepared.shots.map(s=>s.mode)).toEqual(["edit","reuse","generate","generate"]);
  expect(prepared.shots[0].preflight?.semanticAssessment).toBe("not_performed");
  expect(prepared.shots[0].preflight?.reasons.join(" ")).toContain("240×320");
  expect(prepared.credits).toBe(54+49*2);
  const request={...input,fingerprint:prepared.fingerprint};
  await submitCodeMotionImages("1",request,deps);await submitCodeMotionImages("1",request,deps);
  expect(deps.create).toHaveBeenCalledTimes(3);
  expect(jobs.get(prepared.shots[0].jobId).input.params.referenceImageUrls).toEqual([small.gcsUri]);
  expect(jobs.has(prepared.shots[1].jobId)).toBe(false);
  expect((await listCodeMotionImages("1",projectId,deps))[0].shots[1]).toMatchObject({status:"reused",canResume:false});
  expect((await loadCodeMotion("1",projectId,deps.storage))!.project.brief.images).toEqual([small,good]);
});

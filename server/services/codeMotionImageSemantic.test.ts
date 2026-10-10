import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import sharp from "sharp";
import {
  analyzeCodeMotionImageSemantic,
  loadCodeMotionImageSemantic,
  validateCodeMotionSemanticReport,
  type CodeMotionSemanticDeps,
} from "./codeMotionImageSemantic";
import { semanticImageDecision } from "../../shared/codeMotionImageSemantic";
import {
  loadCodeMotion,
  saveCodeMotion,
  type CodeMotionStoreDeps,
} from "./codeMotionStore";
import { codeMotionProductionFingerprint } from "./codeMotionProductionGrant";
import {
  prepareCodeMotionImages,
  submitCodeMotionImages,
} from "./codeMotionImages";
const projectId = "11111111-1111-4111-8111-111111111111",
  grantId = "22222222-2222-4222-8222-222222222222",
  imageId = "33333333-3333-4333-8333-333333333333",
  audioId = "44444444-4444-4444-8444-444444444444";
const h = (b: Buffer) => createHash("sha256").update(b).digest("hex");
async function setup(tier: "free" | "paid" = "free") {
  const files = new Map<string, { body: Buffer; generation: string }>(),
    posts: any[] = [],
    image = await sharp({
      create: { width: 800, height: 600, channels: 3, background: "blue" },
    })
      .png()
      .toBuffer(),
    audio = Buffer.from("fixture actual audio bytes"),
    video = Buffer.from("fixture video bytes");
  const storage: CodeMotionStoreDeps = {
    read: async name => files.get(name) || null,
    list: async prefix =>
      Array.from(files.keys()).filter(k => k.startsWith(prefix)),
    write: async (name, body, generation) => {
      if ((files.get(name)?.generation || "0") !== generation)
        throw Error("CAS conflict");
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
        title: "咖啡短片",
        request: "呈现咖啡与原声对应",
        style: "scenes",
        duration: 20,
        orientation: "landscape",
        images: [
          { id: imageId, name: "原图", gcsUri: "gs://bucket/image.png" },
        ],
        audios: [
          {
            id: audioId,
            name: "原声",
            gcsUri: "gs://bucket/audio.wav",
            duration: 20,
            mimeType: "audio/wav",
            sha256: h(audio),
            bytes: audio.length,
          },
        ],
      },
      plan: {
        version: 1,
        summary: "四镜咖啡",
        scenes: Array.from({ length: 4 }, (_, i) => ({
          heading: "咖啡",
          composition: {
            id: `scene${i}`,
            duration: 5,
            elements: [
              { id: "text", type: "text", text: "咖啡" },
              ...(i === 0
                ? [{ id: "img", type: "image", imageId, width: 1, height: 1 }]
                : []),
            ],
          },
          body: "杯子中咖啡蒸汽升起",
          duration: 5,
          ...(i === 0 ? { imageId } : {}),
        })),
        audioTimeline: [
          {
            sourceId: audioId,
            role: "narration",
            at: 0,
            trimStart: 0,
            duration: 20,
            volume: 1,
            fadeIn: 0,
            fadeOut: 0,
          },
        ],
        codeVideo: {
          version: 1,
          assets: [
            {
              id: "v1",
              videoUri: "gs://bucket/video.mp4",
              sha256: h(video),
              durationSec: 5,
            },
          ],
          clips: [
            {
              assetId: "v1",
              at: 0,
              duration: 5,
              sourceStartSec: 0,
              fit: "cover",
            },
          ],
        },
      },
    } as any,
    "0",
    storage
  );
  const project = (await loadCodeMotion("1", projectId, storage))!.project,
    grant: any = {
      id: grantId,
      projectId,
      tier,
      fingerprint: codeMotionProductionFingerprint(project),
    };
  const report: any = {
    findings: [
      {
        index: 0,
        imageIds: [imageId],
        status: "conflict",
        confidence: 0.95,
        requirement: "杯子中咖啡蒸汽升起",
        repair: "保留构图，改为咖啡杯和上升蒸汽",
        observations: [
          { sourceId: imageId, observation: "原图显示蓝色海面，没有咖啡杯" },
          { sourceId: audioId, observation: "原声说咖啡蒸汽升起", atSec: 1 },
          { sourceId: "v1", observation: "参考片显示咖啡杯近景", atSec: 2 },
        ],
      },
    ],
    coverage: [
      {
        sourceId: imageId,
        readable: true,
        observation: "可见海面与远处地平线",
      },
      { sourceId: audioId, readable: true, observation: "可辨人声讲解咖啡" },
      { sourceId: "v1", readable: true, observation: "可见咖啡杯近景" },
    ],
    limitations: "夹具结果，不代表实调视觉或听音验收",
  };
  const deps: CodeMotionSemanticDeps = {
    storage,
    archive: vi.fn(async name => `gs://bucket/${name}`),
    grant: vi.fn(async () => grant),
    reserve: vi.fn(async () => grant),
    assert: vi.fn(async () => grant),
    resolve: vi.fn(async ({ source }) => source),
    ownership: vi.fn(async () => {}),
    read: vi.fn(async uri =>
      uri.endsWith(".png") ? image : uri.endsWith(".wav") ? audio : video
    ),
    window: vi.fn(async () => Buffer.from("fixture bounded PCM window")),
    post: vi.fn(async body => {
      posts.push(body);
      expect(
        Array.from(files.keys()).some(k => k.endsWith("/request.json"))
      ).toBe(true);
      return {
        status: 200,
        text: JSON.stringify({
          modelVersion: "gemini-3.8-flash-001",
          usageMetadata: { promptTokenCount: 123 },
          candidates: [
            {
              finishReason: "STOP",
              content: { parts: [{ text: JSON.stringify(report) }] },
            },
          ],
        }),
      };
    }),
  };
  const input = { projectId, expectedGeneration: "1", grantId };
  return { deps, input, files, posts, project, report, grant, image };
}
describe("confirmed image semantic pipeline", () => {
  it("sends actual native image/audio/video parts, saves raw before parsed, and reuses exactly one result", async () => {
    const t = await setup();
    const first = await analyzeCodeMotionImageSemantic("1", t.input, t.deps);
    const again = await analyzeCodeMotionImageSemantic("1", t.input, t.deps);
    expect(again).toEqual(first);
    expect(t.deps.post).toHaveBeenCalledTimes(1);
    expect(t.deps.reserve).toHaveBeenCalledWith(
      "1",
      expect.objectContaining({ kind: "image_semantic", index: 0 })
    );
    const body = t.posts[0],
      parts = body.contents[0].parts;
    expect(parts.some((p: any) => p.fileData?.mimeType === "image/png")).toBe(
      true
    );
    expect(parts.some((p: any) => p.inlineData?.mimeType === "audio/wav")).toBe(
      true
    );
    expect(
      parts.some(
        (p: any) =>
          p.fileData?.mimeType === "video/mp4" && p.videoMetadata.fps === 12
      )
    ).toBe(true);
    expect(body.generationConfig).toMatchObject({
      maxOutputTokens: 65536,
      thinkingConfig: { thinkingLevel: "MEDIUM" },
      audioTimestamp: true,
    });
    expect(body.generationConfig.thinkingConfig).not.toHaveProperty(
      "thinkingBudget"
    );
    const keys = Array.from(t.files.keys());
    expect(keys.findIndex(k => k.endsWith("/raw.json"))).toBeLessThan(
      keys.findIndex(k => k.endsWith("/result.json"))
    );
    expect(first.report.findings[0].status).toBe("conflict");
    expect(t.deps.window).toHaveBeenCalledWith(expect.any(Buffer), 0, 20);
  });
  it("recovers preserved raw without repurchase after parsed persistence loss; unknown never retries", async () => {
    const t = await setup();
    await analyzeCodeMotionImageSemantic("1", t.input, t.deps);
    for (const k of Array.from(t.files.keys()))
      if (k.endsWith("/result.json")) t.files.delete(k);
    await analyzeCodeMotionImageSemantic("1", t.input, t.deps);
    expect(t.deps.post).toHaveBeenCalledTimes(1);
    for (const k of Array.from(t.files.keys()))
      if (k.endsWith("/result.json") || k.endsWith("/raw.json"))
        t.files.delete(k);
    await expect(
      analyzeCodeMotionImageSemantic("1", t.input, t.deps)
    ).rejects.toThrow("待核对");
    expect(t.deps.post).toHaveBeenCalledTimes(1);
  });
  it("keeps malformed raw and refuses missing coverage, invented source, and invented requirement", async () => {
    const t = await setup();
    t.report.coverage.pop();
    await expect(
      analyzeCodeMotionImageSemantic("1", t.input, t.deps)
    ).rejects.toThrow("未覆盖");
    expect(Array.from(t.files.keys()).some(k => k.endsWith("/raw.json"))).toBe(
      true
    );
    expect(
      Array.from(t.files.keys()).some(k => k.endsWith("/result.json"))
    ).toBe(false);
    const source = [
      {
        sourceId: imageId,
        kind: "image" as const,
        bytes: 1,
        sha256: "a".repeat(64),
        mimeType: "image/png",
      },
    ];
    const report = {
      ...t.report,
      coverage: [t.report.coverage[0]],
      findings: [
        {
          ...t.report.findings[0],
          observations: [
            { sourceId: "invented", observation: "想象的图片观察" },
          ],
        },
      ],
    };
    expect(() =>
      validateCodeMotionSemanticReport(report, t.project, source)
    ).toThrow("证据");
    report.findings[0].observations = [
      { sourceId: imageId, observation: "清楚的原图海面观察" },
    ];
    report.findings[0].requirement = "用户从未要求的太空场景";
    expect(() =>
      validateCodeMotionSemanticReport(report, t.project, source)
    ).toThrow("要求");
  });
  it("does not redraw based on weak confidence or unreadable input", async () => {
    const t = await setup();
    t.report.findings[0].confidence = 0.6;
    const result = await analyzeCodeMotionImageSemantic("1", t.input, t.deps);
    expect(semanticImageDecision(result.report.findings[0])).toMatchObject({
      assessment: "uncertain",
      reasons: [],
      repair: "",
    });
    const t2 = await setup();
    t2.report.coverage[0].readable = false;
    const second = await analyzeCodeMotionImageSemantic("1", t2.input, t2.deps);
    expect(second.report.findings[0]).toMatchObject({
      status: "uncertain",
      confidence: 0.79,
    });
  });
  it.each(["free", "paid"] as const)(
    "%s formal prepare→analyze→prepare→submit uses one fixed edit plus missing-image generation",
    async tier => {
      const t = await setup(tier),
        jobs = new Map<string, any>();
      const images: any = {
        storage: t.deps.storage,
        grant: t.deps.grant,
        prepareGrant: t.deps.grant,
        reserve: t.deps.reserve,
        assertSlot: t.deps.assert,
        resolve: t.deps.resolve,
        semantic: loadCodeMotionImageSemantic,
        inspectImage: async () => ({
          imageId,
          gcsUri: "gs://bucket/image.png",
          width: 1920,
          height: 1080,
          bytes: t.image.length,
          sha256: h(t.image),
        }),
        preview: async (uri: string) => uri,
        job: async (id: string) => jobs.get(id) || null,
        create: vi.fn(async (data: any) => {
          jobs.set(data.id, { ...data, status: "queued" });
          return data.id;
        }),
      };
      const before = await prepareCodeMotionImages("1", t.input, images);
      expect(before.shots[0].mode).toBe("reuse");
      await expect(
        submitCodeMotionImages(
          "1",
          { ...t.input, fingerprint: before.fingerprint },
          images
        )
      ).rejects.toThrow("语义");
      expect(images.create).not.toHaveBeenCalled();
      await analyzeCodeMotionImageSemantic("1", t.input, t.deps);
      const prepared = await prepareCodeMotionImages("1", t.input, images);
      expect(prepared.shots[0]).toMatchObject({
        mode: "edit",
        model:
          tier === "free" ? "gpt-image-2-2026-04-21" : "gpt-image-2.5-sunburst",
        quality: tier === "free" ? "medium" : "high",
      });
      expect(prepared.shots.slice(1).every(s => s.mode === "generate")).toBe(
        true
      );
      expect(prepared.shots[0].prompt).toContain("咖啡杯");
      expect(prepared.shots[0].preflight?.semanticRawSha256).toHaveLength(64);
      await submitCodeMotionImages(
        "1",
        { ...t.input, fingerprint: prepared.fingerprint },
        images
      );
      await submitCodeMotionImages(
        "1",
        { ...t.input, fingerprint: prepared.fingerprint },
        images
      );
      expect(images.create).toHaveBeenCalledTimes(4);
      expect(
        Array.from(jobs.values())[0].input.params.referenceImageUrls
      ).toEqual(["gs://bucket/image.png"]);
      expect(t.deps.post).toHaveBeenCalledTimes(1);
    }
  );
});

it("does not buy semantic analysis for an already committed image batch", async () => {
  const t = await setup();
  await t.deps.storage.write(
    `code-motion/u1/images/${projectId}/${grantId}.json`,
    Buffer.from("{}"),
    "0"
  );
  await expect(
    analyzeCodeMotionImageSemantic("1", t.input, t.deps)
  ).rejects.toThrow("已经确认");
  expect(t.deps.post).not.toHaveBeenCalled();
  expect(t.deps.reserve).not.toHaveBeenCalled();
});

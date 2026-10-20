import { beforeEach, expect, it, vi } from "vitest";
import sharp from "sharp";
const f = vi.hoisted(() => ({
  files: new Map<string, Buffer>(),
  jobs: new Map<string, any>(),
  generate: vi.fn(),
  resolve: vi.fn(),
  grade: vi.fn(),
  owner: vi.fn(),
  settled: vi.fn(),
  png: Buffer.alloc(0) as Buffer,
  balance: 999999,
}));
vi.mock("./codeMotionStore", () => ({
  codeMotionStorage: {
    read: async (name: string) =>
      f.files.has(name) ? { body: f.files.get(name), generation: "1" } : null,
    write: async (name: string, body: Buffer) => {
      if (f.files.has(name)) throw Error("conflict");
      f.files.set(name, body);
      return "1";
    },
    list: async (prefix: string) =>
      Array.from(f.files.keys()).filter(k => k.startsWith(prefix)),
  },
}));
vi.mock("./postProdMediaSource", () => ({
  resolveRegisteredPostProdMediaSource: f.resolve,
}));
vi.mock("./gcs", () => ({
  getGcsBucketName: () => "test-bucket",
  signGsUriV4ReadUrl: (u: string) => `https://test.invalid/${u.slice(5)}`,
  uploadBufferToGcsIfAbsent: async (p: any) => {
    if (!f.files.has(p.objectName)) f.files.set(p.objectName, p.buffer);
  },
}));
vi.mock("./openaiGptImage2", () => ({
  postOpenAiGptImage2AndUpload: f.generate,
}));
vi.mock("./canvasMediaOwnership", () => ({
  registerCanvasImageDeliveryOrThrow: f.owner,
}));
vi.mock("./platformCoverGrade", () => ({ postProcessPlatformCover: f.grade }));
vi.mock("./photoMediaInput", () => ({
  downloadPhotoMedia: async (url: string) =>
    url.endsWith("/provider.json")
      ? f.files.get(
          decodeURIComponent(new URL(url).pathname).replace(
            /^\/test-bucket\//,
            ""
          )
        )
      : f.png,
}));
vi.mock("./paidJobLedger", () => ({
  markSettlementPending: async () => true,
  unregisterActiveJob: f.settled,
}));
vi.mock("../jobs/repository", () => ({
  getJobByIdStrict: async (id: string) => f.jobs.get(id) || null,
  markJobSucceededWithRetry: async (id: string, output: unknown) => {
    Object.assign(f.jobs.get(id), { status: "succeeded", output });
    return true;
  },
}));
vi.mock("../credits", () => ({
  getCredits: async () => ({ totalAvailable: f.balance }),
}));
vi.mock("../db", () => ({
  getDb: async () => ({
    insert: () => ({
      values: (rows: any[]) => ({
        onConflictDoNothing: async () => {
          for (const row of rows)
            if (!f.jobs.has(row.id)) f.jobs.set(row.id, row);
        },
      }),
    }),
  }),
}));
import {
  prepareCover,
  submitCover,
  coverJobInput,
  resolveCoverWorkerPolicy,
  generateCoverImage,
  getCover,
  listCovers,
  recoverCover,
  assertCoverPixels,
} from "./coverWorkshop";
import {
  coverBriefSchema,
  coverSize,
  buildCoverPrompt,
  COVER_DRAFT_CREDITS,
} from "../../shared/coverWorkshop";
const id = "11111111-1111-4111-8111-111111111111",
  finalId = "22222222-2222-4222-8222-222222222222";
const brief = coverBriefSchema.parse({
  description: "咖啡馆里一个自然瞬间",
  headline: "慢一点",
  references: ["gs://test-bucket/u1/ref.png"],
});
beforeEach(async () => {
  f.balance = 999999;
  f.files.clear();
  f.jobs.clear();
  vi.clearAllMocks();
  f.png = await sharp({
    create: { width: 1152, height: 2048, channels: 3, background: "#827b65" },
  })
    .png()
    .toBuffer();
  f.resolve.mockImplementation(async ({ userId, source }) => {
    if (userId !== "1" || !source.startsWith("gs://test-bucket/"))
      throw Error("素材无权访问");
    return source;
  });
  f.grade.mockImplementation(async (url: string) => ({
    originalUrl: url,
    imageUrl: "gs://test-bucket/graded.png",
    receiptUrl: "gs://test-bucket/receipt.json",
  }));
  f.settled.mockResolvedValue({ ok: true });
  f.generate.mockImplementation(async (_p, _d, options) => {
    await options.persistResponse({
      status: 200,
      body: JSON.stringify({
        data: [{ b64_json: f.png.toString("base64") }],
        usage: { output_tokens: 123 },
      }),
    });
    return "https://test.invalid/raw.png";
  });
});
async function draft() {
  return prepareCover("1", { id, stage: "draft", brief });
}
async function policy(index = 0) {
  const m = await draft();
  await submitCover("1", id, m.fingerprint);
  return resolveCoverWorkerPolicy(
    "1",
    m.items[index].jobId,
    coverJobInput(m, index)
  );
}
it("描述或图均可，三款构图不相同，标题与长文本完整保留，固定原生2K", async () => {
  expect(coverBriefSchema.safeParse({}).success).toBe(false);
  expect(
    coverBriefSchema.safeParse({ references: brief.references }).success
  ).toBe(true);
  expect(["9:16", "16:9", "1:1"].map(a => coverSize(a as any))).toEqual([
    "1152x2048",
    "2048x1152",
    "2048x2048",
  ]);
  const m = await draft();
  expect(m.items).toHaveLength(3);
  expect(new Set(m.items.map(i => i.prompt)).size).toBe(3);
  expect(m.items.reduce((s, i) => s + i.credits, 0)).toBe(COVER_DRAFT_CREDITS);
  expect(
    m.items.every(
      i => i.prompt.includes("慢一点") && i.prompt.includes(brief.description)
    )
  ).toBe(true);
  expect(f.generate).not.toHaveBeenCalled();
  expect(f.jobs.size).toBe(0);
  expect(
    buildCoverPrompt(
      { ...brief, headline: "", description: "字".repeat(4000) },
      1
    )
  ).toContain("字".repeat(4000));
});
it("三张原子入队，同ID并发/失败重查不重复，确认指纹及worker伪造阻断", async () => {
  const m = await draft();
  await expect(submitCover("1", id, "wrong")).rejects.toThrow("版本");
  await Promise.all([
    submitCover("1", id, m.fingerprint),
    submitCover("1", id, m.fingerprint),
  ]);
  expect(f.jobs.size).toBe(3);
  f.jobs.get(m.items[0].jobId).status = "failed";
  await submitCover("1", id, m.fingerprint);
  expect(f.jobs.get(m.items[0].jobId).status).toBe("failed");
  const input = coverJobInput(m, 0);
  input.params.prompt = "换内容";
  await expect(
    resolveCoverWorkerPolicy("1", m.items[0].jobId, input)
  ).rejects.toThrow("凭据");
  await expect(
    resolveCoverWorkerPolicy("2", m.items[0].jobId, coverJobInput(m, 0))
  ).rejects.toThrow("无权");
});
it("同一设计不能覆写，跨账号读取与引用他人图片均拒绝", async () => {
  await draft();
  await expect(
    prepareCover("1", {
      id,
      stage: "draft",
      brief: { ...brief, headline: "改稿" },
    })
  ).rejects.toThrow("不同设计");
  await expect(getCover("2", id)).rejects.toThrow("无权");
  expect(await listCovers("2")).toEqual([]);
  await expect(
    prepareCover("2", { id, stage: "draft", brief })
  ).rejects.toThrow("无权");
});
it("初稿走Flare2K，严格禁回落，逐张后期；重复执行只复用原图", async () => {
  const p = await policy();
  expect(await generateCoverImage(p)).toBe("gs://test-bucket/graded.png");
  expect(f.generate).toHaveBeenCalledWith(
    p.item.prompt,
    "cover-workshop",
    expect.objectContaining({
      exactModel: "gpt-image-2.5-flare",
      size: "1152x2048",
      quality: "medium",
      strictRequest: true,
    })
  );
  await generateCoverImage(p);
  expect(f.generate).toHaveBeenCalledTimes(1);
  expect(f.grade).toHaveBeenCalledTimes(1);
  expect(f.files.has(`cover-workshop/u1/${id}/0/provider.json`)).toBe(true);
});
it("未知提交结果永久占位，第二次绝不调用供应商", async () => {
  const p = await policy();
  f.generate.mockRejectedValueOnce(
    Object.assign(Error("timeout"), { kind: "unknown" })
  );
  await expect(generateCoverImage(p)).rejects.toMatchObject({
    kind: "unknown",
  });
  await expect(generateCoverImage(p)).rejects.toMatchObject({
    kind: "unknown",
  });
  expect(f.generate).toHaveBeenCalledTimes(1);
});
it("后期失败恢复同一原图、同一任务，成稿绑定选定图+本人参考且锁Sunburst", async () => {
  const p = await policy(1);
  f.grade.mockRejectedValueOnce(Error("后期暂时中断"));
  await expect(generateCoverImage(p)).rejects.toMatchObject({
    kind: "unknown",
  });
  f.jobs.get(p.item.jobId).status = "failed";
  expect((await getCover("1", id)).items[1].canRecover).toBe(true);
  await recoverCover("1", id, 1);
  expect(f.generate).toHaveBeenCalledTimes(1);
  expect(f.settled).toHaveBeenCalled();
  const final = await prepareCover("1", {
    id: finalId,
    stage: "final",
    batchId: id,
    candidate: 1,
    changes: "保留构图",
  });
  expect(final.items).toHaveLength(1);
  expect(final.items[0].refs[0]).toBe("gs://test-bucket/graded.png");
  expect(final.items[0].refs[1]).toBe(brief.references[0]);
  expect(final.items[0].prompt).toContain("保留构图");
  expect(final.items[0].direction).toBe(1);
  await submitCover("1", finalId, final.fingerprint);
  await generateCoverImage(
    await resolveCoverWorkerPolicy(
      "1",
      final.items[0].jobId,
      coverJobInput(final, 0)
    )
  );
  expect(f.generate).toHaveBeenLastCalledWith(
    final.items[0].prompt,
    "cover-workshop",
    expect.objectContaining({
      exactModel: "gpt-image-2.5-sunburst",
      quality: "high",
      size: "1152x2048",
    })
  );
});
it("失败/未生成初稿不能创建成稿，选图本身不调用模型", async () => {
  await policy();
  await expect(
    prepareCover("1", {
      id: finalId,
      stage: "final",
      batchId: id,
      candidate: 0,
      changes: "",
    })
  ).rejects.toThrow("尚未成功");
  expect(f.generate).not.toHaveBeenCalled();
});
it("供应商返回低分辨率不能冒充2K，原图保留并走明确失败", async () => {
  const p = await policy();
  f.png = await sharp({
    create: { width: 1024, height: 1536, channels: 3, background: "red" },
  })
    .png()
    .toBuffer();
  await expect(generateCoverImage(p)).rejects.toMatchObject({
    kind: "invalid_output",
  });
  expect(f.grade).not.toHaveBeenCalled();
  expect(f.files.has(`cover-workshop/u1/${id}/0/original.png`)).toBe(true);
  await expect(assertCoverPixels(f.png, "1152x2048")).rejects.toThrow(
    "像素不符合"
  );
});

it("整批余额预检不够则不入队；已提交请求可在余额减少后只查询原任务", async () => {
  const m = await draft();
  f.balance = 100;
  await expect(submitCover("1", id, m.fingerprint)).rejects.toThrow("余额不足");
  expect(f.jobs.size).toBe(0);
  f.balance = 152;
  await submitCover("1", id, m.fingerprint);
  f.balance = 0;
  await submitCover("1", id, m.fingerprint);
  expect(f.jobs.size).toBe(3);
});
it("原图索引丢失仍能从永久供应商回执恢复，绝不再次生成", async () => {
  const p = await policy();
  await generateCoverImage(p);
  const base = `cover-workshop/u1/${id}/0`;
  f.files.delete(`${base}/original.json`);
  f.files.delete(`${base}/original.png`);
  f.files.delete(`${base}/delivery.json`);
  f.jobs.get(p.item.jobId).status = "failed";
  expect((await getCover("1", id)).items[0].canRecover).toBe(true);
  await recoverCover("1", id, 0);
  expect(f.generate).toHaveBeenCalledTimes(1);
  expect(f.files.has(`${base}/original.png`)).toBe(true);
});
it("无效参考在设计阶段拒绝，未入队未收费", async () => {
  f.png = Buffer.from("not an image");
  await expect(draft()).rejects.toThrow();
  expect(f.jobs.size).toBe(0);
  expect(f.generate).not.toHaveBeenCalled();
});

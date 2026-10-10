import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
const state = vi.hoisted(() => ({
  db: null as any,
  files: new Map<string, { body: Buffer; generation: string }>(),
  version: 1,
  paid: false,
}));
vi.mock("../db", () => ({ getDb: async () => state.db }));
vi.mock("../jobs/repository", () => ({ getJobByIdStrict: async () => null }));
vi.mock("./postProdMediaSource", async original => ({
  ...(await original<any>()),
  resolvePostProdInputSources: async ({ input }: any) => input,
}));
vi.mock("../credits", () => ({
  getUserPlan: async () => (state.paid ? "pro" : "free"),
}));
vi.mock("./codeMotionStore", async importOriginal => {
  const original = await importOriginal<any>();
  const storage = {
    read: async (n: string) => state.files.get(n) || null,
    write: async (n: string, b: Buffer, g: string) => {
      if ((state.files.get(n)?.generation || "0") !== g)
        throw Error("conflict");
      const generation = String(++state.version);
      state.files.set(n, { body: b, generation });
      return generation;
    },
    list: async (p: string) =>
      Array.from(state.files.keys()).filter(n => n.startsWith(p)),
  };
  return {
    ...original,
    codeMotionStorage: storage,
    loadCodeMotion: (u: string, p: string) =>
      original.loadCodeMotion(u, p, storage),
  };
});
import {
  ensureCodeMotionProductionGrant,
  reserveCodeMotionProductionSlot,
  enqueueCodeMotionProductionExport,
  codeMotionProductionDigest,
  prepareCodeMotionProductionGrant,
  writeCodeMotionRevisionGrant,
} from "./codeMotionProductionGrant";
import {
  assertInkFreeJob,
  ensureInkFreeTable,
  quoteInkFree,
  enqueueInkFree,
} from "./inkFreeQuota";
import { codeMotionStorage } from "./codeMotionStore";
const pg = new PGlite(),
  db = drizzle(pg);
const projectId = "11111111-1111-4111-8111-111111111111";
const source = (i: string) => ({
  day: "2026-10-11",
  ipHash: i.padEnd(64, "0"),
});
function addProject(userId: string) {
  const project = {
    id: projectId,
    brief: {
      title: "测试作品",
      request: "四镜头",
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
      summary: "四镜头",
      scenes: Array.from({ length: 4 }, () => ({
        heading: "介绍",
        body: "内容",
        duration: 5,
      })),
    },
  };
  state.files.set(`code-motion/u${userId}/projects/${projectId}.json`, {
    body: Buffer.from(
      JSON.stringify({ project, updatedAt: new Date().toISOString() })
    ),
    generation: "1",
  });
}
beforeAll(async () => {
  state.db = db;
  await db.execute(
    sql`CREATE TABLE jobs(id text PRIMARY KEY,"userId" text,type text,provider text,status text,input json,attempts integer)`
  );
  await ensureInkFreeTable(db);
}, 30000);
beforeEach(async () => {
  state.files.clear();
  state.paid = false;
  await db.execute(sql`DELETE FROM jobs`);
  await db.execute(sql`DELETE FROM ink_free_claims`);
});
afterAll(() => pg.close());
describe("正式免费/会员导出账务门禁 PostgreSQL", () => {
  it("只看报价不领取；并发11制作最多10且产生媒体之前就占位", async () => {
    for (let i = 1; i <= 11; i++) addProject(String(i));
    await prepareCodeMotionProductionGrant("1", {
      projectId,
      expectedGeneration: "1",
    });
    expect(
      (await db.execute(sql`SELECT count(*)::int n FROM ink_free_claims`)).rows
    ).toEqual([{ n: 0 }]);
    const results = await Promise.allSettled(
      Array.from({ length: 11 }, (_, i) =>
        ensureCodeMotionProductionGrant(String(i + 1), {
          projectId,
          expectedGeneration: "1",
          source: source(String(i + 1)),
        })
      )
    );
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(10);
    expect(
      (await db.execute(sql`SELECT count(*)::int n FROM ink_free_claims`)).rows
    ).toEqual([{ n: 10 }]);
    expect(
      (await db.execute(sql`SELECT count(*)::int n FROM jobs`)).rows
    ).toEqual([{ n: 0 }]);
  });
  it("免费整作品只领一次；导出同槽幂等、失败不能重新释放已经花掉的图音视频预算", async () => {
    addProject("7");
    const grant = await ensureCodeMotionProductionGrant("7", {
      projectId,
      expectedGeneration: "1",
      source: source("7"),
    });
    const input = {
      action: "art_motion",
      scopeKey: `code-motion:${projectId}`,
      requestId: "render",
      params: { duration: 20 },
    };
    const request = {
      id: "test-production-export",
      userId: "7",
      input,
      format: "mp4" as const,
      provider: "canvas-art-motion",
      type: "post_prod" as const,
    };
    const slot = {
      projectId,
      grantId: grant.id,
      kind: "export" as const,
      index: 0,
      requestId: request.id,
      digest: codeMotionProductionDigest(input),
    };
    await reserveCodeMotionProductionSlot("7", slot);
    await Promise.all([
      enqueueCodeMotionProductionExport(request, slot),
      enqueueCodeMotionProductionExport(request, slot),
    ]);
    await expect(
      assertInkFreeJob("7", request.id, "mp4", db)
    ).resolves.toBeUndefined();
    await expect(assertInkFreeJob("8", request.id, "mp4", db)).rejects.toThrow(
      "名额"
    );
    await db.execute(
      sql`UPDATE jobs SET status='failed' WHERE id=${request.id}`
    );
    expect(await quoteInkFree("7", source("other"), db)).toMatchObject({
      eligible: false,
      reason: "account_pending",
    });
    await expect(
      enqueueInkFree({ ...request, id: "other-export" }, source("other"), db)
    ).rejects.toThrow("已有免费任务");
    expect(
      (await db.execute(sql`SELECT count(*)::int n FROM ink_free_claims`)).rows
    ).toEqual([{ n: 1 }]);
    await expect(
      enqueueCodeMotionProductionExport(
        { ...request, input: { changed: true } },
        slot
      )
    ).rejects.toThrow("授权与任务");
  });
  it("会员导出沿作品授权不占免费名额、不另造收费合同，worker必须有映射", async () => {
    state.paid = true;
    addProject("9");
    const grant = await ensureCodeMotionProductionGrant("9", {
      projectId,
      expectedGeneration: "1",
      source: source("9"),
    });
    const input = {
      action: "art_motion",
      scopeKey: `code-motion:${projectId}`,
      requestId: "paid-render",
      params: { duration: 20 },
    };
    const request = {
      id: "test-paid-production-export",
      userId: "9",
      input,
      format: "mp4" as const,
      provider: "canvas-art-motion",
      type: "post_prod" as const,
    };
    const slot = {
      projectId,
      grantId: grant.id,
      kind: "export" as const,
      index: 0,
      requestId: request.id,
      digest: codeMotionProductionDigest(input),
    };
    await reserveCodeMotionProductionSlot("9", slot);
    expect(
      await enqueueCodeMotionProductionExport(request, slot)
    ).toMatchObject({ cost: 0, status: "queued" });
    await expect(
      assertInkFreeJob("9", request.id, "mp4", db)
    ).resolves.toBeUndefined();
    await expect(
      assertInkFreeJob("9", "unregistered", "mp4", db)
    ).rejects.toThrow("名额");
    expect(
      (await db.execute(sql`SELECT count(*)::int n FROM ink_free_claims`)).rows
    ).toEqual([{ n: 0 }]);
  });
  it("局部修改子作品导出绑定原grant，不再次领取免费名额", async () => {
    addProject("7");
    const parent = await ensureCodeMotionProductionGrant("7", {
      projectId,
      expectedGeneration: "1",
      source: source("7"),
    });
    const childId = "33333333-3333-4333-8333-333333333333";
    const child = JSON.parse(
      state.files
        .get(`code-motion/u7/projects/${projectId}.json`)!
        .body.toString()
    ).project;
    child.id = childId;
    child.plan.scenes[1].heading = "局部修改";
    state.files.set(`code-motion/u7/projects/${childId}.json`, {
      body: Buffer.from(
        JSON.stringify({ project: child, updatedAt: new Date().toISOString() })
      ),
      generation: "1",
    });
    const grant = await writeCodeMotionRevisionGrant(
      "7",
      child,
      "1",
      parent,
      {
        rootProjectId: projectId,
        rootGrantId: parent.id,
        parentProjectId: projectId,
        number: 1,
        sceneIndexes: [1],
        mode: "code_only",
      },
      codeMotionStorage
    );
    const input = {
      action: "art_motion",
      scopeKey: `code-motion:${childId}`,
      requestId: "revision-render",
      params: { duration: 20 },
    };
    const request = {
      id: "revision-export",
      userId: "7",
      input,
      format: "mp4" as const,
      provider: "canvas-art-motion",
      type: "post_prod" as const,
    };
    const slot = {
      projectId: childId,
      grantId: grant.id,
      kind: "export" as const,
      index: 0,
      requestId: request.id,
      digest: codeMotionProductionDigest(input),
    };
    await reserveCodeMotionProductionSlot("7", slot);
    await enqueueCodeMotionProductionExport(request, slot);
    await expect(
      assertInkFreeJob("7", request.id, "mp4", db)
    ).resolves.toBeUndefined();
    expect(
      (await db.execute(sql`SELECT count(*)::int n FROM ink_free_claims`)).rows
    ).toEqual([{ n: 1 }]);
    expect(
      (
        await db.execute(
          sql`SELECT "rootGrantId" FROM ink_free_production_exports WHERE "jobId"='revision-export'`
        )
      ).rows
    ).toEqual([{ rootGrantId: parent.id }]);
  });
  it("pure-code first export through the actual task queue mints production grant before claiming and rendering", async () => {
    addProject("7");
    const project = JSON.parse(
      state.files
        .get(`code-motion/u7/projects/${projectId}.json`)!
        .body.toString()
    ).project;
    const { codeMotionRenderIdentity, submitCodeMotion } = await import(
      "./codeMotionTask"
    );
    const identity = codeMotionRenderIdentity("7", project);
    const result = await submitCodeMotion(
      "7",
      project,
      identity.fingerprint,
      undefined,
      source("7")
    );
    expect(result.jobId).toBe(identity.jobId);
    const grantFile = state.files.get(
      `code-motion/u7/production/${projectId}/grant.json`
    );
    expect(grantFile).toBeTruthy();
    const grant = JSON.parse(grantFile!.body.toString());
    expect(
      (
        await db.execute(
          sql`SELECT "jobId" FROM ink_free_claims WHERE "userId"='7'`
        )
      ).rows
    ).toEqual([{ jobId: `ink_prod_${grant.id}` }]);
    await expect(
      assertInkFreeJob("7", identity.jobId, "mp4", db)
    ).resolves.toBeUndefined();
  });
});

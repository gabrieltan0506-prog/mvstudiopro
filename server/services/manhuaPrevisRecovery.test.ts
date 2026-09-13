import { createHash } from "node:crypto";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import * as databaseModule from "../db";
import { describe, expect, it, vi } from "vitest";
import {
  createManhuaPrevisStudio,
  manhuaPrevisRequestSchema,
} from "../../shared/manhuaPrevis";
import type { PrevisRenderReport } from "./manhuaPrevisReport";
import { PREVIS_BODY_BONES } from "../../shared/manhuaPrevisRig";
import {
  recoverPrevisResult,
  previsRecoveryStorage,
  type PrevisRecoveryDeps,
  type PrevisRecoveryRow,
} from "./manhuaPrevisRecovery";
import {
  getPrevisTask,
  listPrevisTasks,
  previsTaskId,
  submitPrevisTask,
  type PrevisTaskDeps,
} from "./manhuaPrevisTask";

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
function fixture(withInteractions = false) {
  const studio = createManhuaPrevisStudio(
    2,
    "11111111-1111-4111-8111-111111111111"
  );
  const input = {
    requestId: "22222222-2222-4222-8222-222222222222",
    scopeId: studio.scopeId,
    clipId: "clip-1",
    spec: studio.spec,
  };
  if (withInteractions) {
    input.spec.actors.push({
      ...structuredClone(input.spec.actors[0]),
      id: "actor-2",
      nameZh: "角色 2",
      start: [0.5, 0],
      end: [0.5, 0],
    });
    input.spec.interactions = [
      {
        id: "pair-1",
        kind: "strike_recoil",
        actorId: "actor-1",
        targetActorId: "actor-2",
        startSec: 0,
        contactSec: 1,
        endSec: 2,
      },
    ];
  }
  input.spec = manhuaPrevisRequestSchema.parse(input).spec;
  const prefix = `gs://test-bucket/post-prod/7/previs/${input.requestId}/`;
  const report: PrevisRenderReport = {
    frames: 48,
    fps: 24,
    actors: [
      {
        id: "actor-1",
        nameZh: "角色 1",
        bones: 16,
        contactError: 0,
        stanceDrift: 0,
        offscreenFrames: [],
      },
    ],
    warnings: [],
  };
  if (withInteractions) {
    report.actors.push({
      ...structuredClone(report.actors[0]),
      id: "actor-2",
      nameZh: "角色 2",
    });
    report.interactions = [
      {
        id: "pair-1",
        kind: "strike_recoil",
        actorId: "actor-1",
        targetActorId: "actor-2",
        contactFrame: 25,
        contactError: 0,
        actualPoint: [0, 0, 1],
        targetPoint: [0, 0, 1],
      },
    ];
  }
  const probe = {
    streams: [{ width: 960, height: 540, nb_read_frames: "48" }],
    format: { duration: "2.000" },
  };
  const json = (v: unknown) => Buffer.from(JSON.stringify(v));
  const video = Buffer.alloc(1200, 3),
    scene = Buffer.alloc(1300, 4);
  const objects = new Map<string, Buffer>([
    [prefix + "request.json", json(input)],
    [prefix + "report.json", json(report)],
    [prefix + "probe.json", json(probe)],
    [prefix + "preview.mp4", video],
    [prefix + "scene.blend", scene],
  ]);
  const result = {
    userId: "7",
    ...input,
    gcsUri: prefix + "preview.mp4",
    durationSec: 2,
    bytes: video.length,
    sha256: sha(video),
    width: 960,
    height: 540,
    sceneGcsUri: prefix + "scene.blend",
    requestGcsUri: prefix + "request.json",
    reportGcsUri: prefix + "report.json",
    probeGcsUri: prefix + "probe.json",
    requestSha256: sha(json(input)),
    reportSha256: sha(json(report)),
    probeSha256: sha(json(probe)),
    sceneSha256: sha(scene),
    report,
  };
  const seal = () => {
    const bytes = json(result);
    objects.set(prefix + "result.json", bytes);
    objects.set(
      prefix + "result-evidence.json",
      json({
        userId: "7",
        requestId: input.requestId,
        scopeId: input.scopeId,
        clipId: input.clipId,
        result: {
          gcsUri: prefix + "result.json",
          bytes: bytes.length,
          sha256: sha(bytes),
        },
      })
    );
  };
  seal();
  const row: PrevisRecoveryRow = {
    id: previsTaskId(7, input.requestId),
    userId: "7",
    type: "post_prod",
    status: "failed",
    provider: "blender-previs",
    input: { action: "manhua_previs", params: input },
    output: null,
    error: "落库失败",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const d: PrevisRecoveryDeps = {
    bucket: () => "test-bucket",
    inspect: vi.fn(async args => {
      const bytes = objects.get(args.gcsUri);
      if (!bytes || bytes.length > args.maxBytes) throw new Error("不可读取");
      args.onChunk?.(bytes);
      return {
        bucket: "test-bucket",
        objectName: args.gcsUri.slice(17),
        byteLength: bytes.length,
        header: bytes.subarray(0, 12),
        sha256: sha(bytes),
      };
    }),
    save: vi.fn(async (previous, output) => ({
      ...previous,
      status: "succeeded",
      output,
      error: null,
    })),
  };
  return { input, prefix, objects, result, seal, row, d };
}
describe("白模永久产物恢复", () => {
  it.each([
    "valid",
    "custom-valid",
    "missing",
    "source",
    "false-contact",
    "map-missing",
    "map-truncated",
    "map-duplicate",
    "map-unknown",
    "map-explicit-mismatch",
  ])("恢复带骨角色必须复核同一配置且不夸大接地：%s", async mode => {
    const f = fixture();
    const actor = f.input.spec.actors[0];
    actor.assetRef = "asset-1";
    actor.riggedModel = {
      sourceJobId: "m3d_saved",
      forwardAxis: "+X",
      targetHeight: 1.7,
      boneMap: { pelvis: mode === "custom-valid" ? "实际骨盆" : "pelvis" },
    };
    f.input.spec = manhuaPrevisRequestSchema.parse(f.input).spec;
    f.result.spec = f.input.spec;
    if (mode !== "missing")
      f.result.report.models = [
        {
          actorId: actor.id,
          sourceJobId: mode === "source" ? "m3d_other" : "m3d_saved",
          sha256: "a".repeat(64),
          bytes: 2048,
          vertices: 100,
          meshVertices: 100,
          accessorComponents: 1500,
          instanceComponents: 1500,
          instanceIndices: 300,
          imagePixels: 0,
          meshes: 1,
          jointNames: [...PREVIS_BODY_BONES],
          morphNames: [],
          mappedBones: 16,
          boneMap: Object.fromEntries(
            PREVIS_BODY_BONES.map(name => [name, name])
          ) as Record<(typeof PREVIS_BODY_BONES)[number], string>,
          forwardAxis: "+X",
          targetHeight: 1.7,
          weightedVertices: 100,
          retargetFrames: 48,
          retargetMode: "rest-corrected-rotation-preserve-target-lengths",
          contactValidated: false,
          boundaryZh: "角色网格接地未验证",
          offscreenFrames: [],
        },
      ];
    if (mode === "false-contact")
      Object.assign(f.result.report.models![0], { contactValidated: true });
    const model = f.result.report.models?.[0];
    if (model) {
      if (mode === "custom-valid") {
        model.boneMap.pelvis = "实际骨盆";
        model.jointNames[0] = "实际骨盆";
      } else if (mode === "map-missing")
        Reflect.deleteProperty(model, "boneMap");
      else if (mode === "map-truncated")
        Reflect.deleteProperty(model.boneMap, "head");
      else if (mode === "map-duplicate") model.boneMap.head = "neck";
      else if (mode === "map-unknown") model.boneMap.head = "未知骨骼";
      else if (mode === "map-explicit-mismatch") {
        model.boneMap.pelvis = "spine";
        model.boneMap.spine = "pelvis";
      }
    }
    for (const [name, value] of [
      ["request.json", f.input],
      ["report.json", f.result.report],
    ] as const) {
      const bytes = Buffer.from(JSON.stringify(value));
      f.objects.set(f.prefix + name, bytes);
      if (name === "request.json") f.result.requestSha256 = sha(bytes);
      else f.result.reportSha256 = sha(bytes);
    }
    f.seal();
    const result = await recoverPrevisResult(f.row, 7, f.d);
    expect(f.d.inspect).toHaveBeenCalled();
    if (mode === "valid" || mode === "custom-valid") {
      expect(result.status).toBe("succeeded");
      expect(f.d.save).toHaveBeenCalledOnce();
    } else {
      expect(result).toBe(f.row);
      expect(f.d.save).not.toHaveBeenCalled();
    }
  });
  it("双人交互完整存证可恢复", async () => {
    const f = fixture(true);
    expect((await recoverPrevisResult(f.row, 7, f.d)).status).toBe("succeeded");
    expect(f.d.save).toHaveBeenCalledOnce();
  });
  it.each(["missing", "duplicate", "actor", "frame", "point", "error"])(
    "哈希重新封存也拒绝语义损坏的交互报告：%s",
    async mode => {
      const f = fixture(true);
      const event = f.result.report.interactions![0];
      if (mode === "missing") delete f.result.report.interactions;
      else if (mode === "duplicate")
        f.result.report.interactions!.push({ ...event });
      else if (mode === "actor") event.actorId = "actor-2";
      else if (mode === "frame") event.contactFrame = 24;
      else if (mode === "point") event.actualPoint[0] = 1;
      else event.contactError = 0.001;
      const bytes = Buffer.from(JSON.stringify(f.result.report));
      f.result.reportSha256 = sha(bytes);
      f.objects.set(f.prefix + "report.json", bytes);
      f.seal();
      expect(await recoverPrevisResult(f.row, 7, f.d)).toBe(f.row);
      expect(f.d.save).not.toHaveBeenCalled();
    }
  );
  it("失败状态的取消或隐藏标记也必须阻止恢复", async () => {
    for (const flag of ["cancelRequestedAt", "hiddenAt"]) {
      const f = fixture();
      f.row.input = {
        ...(f.row.input as object),
        [flag]: new Date().toISOString(),
      };
      expect(await recoverPrevisResult(f.row, 7, f.d)).toBe(f.row);
      expect(f.d.inspect).not.toHaveBeenCalled();
    }
  });
  it("真实CAS同时锁用户、动作配置、失败状态、原输出与错误，竞争取消不被覆盖", async () => {
    const f = fixture();
    let condition: SQL | undefined;
    let loaded = 0;
    const select = {
      from: () => select,
      where: async () =>
        ++loaded === 1 ? [f.row] : [{ ...f.row, status: "cancelled" }],
    };
    const update = {
      set: vi.fn(() => update),
      where: (value: SQL) => {
        condition = value;
        return update;
      },
      returning: async () => [],
    };
    const db = vi.spyOn(databaseModule, "getDb").mockResolvedValue({
      select: () => select,
      update: () => update,
    } as never);
    const inspect = vi
      .spyOn(previsRecoveryStorage, "inspect")
      .mockImplementation(f.d.inspect);
    const bucket = vi
      .spyOn(previsRecoveryStorage, "bucket")
      .mockReturnValue("test-bucket");
    try {
      expect((await getPrevisTask(7, f.input.requestId))?.status).toBe(
        "cancelled"
      );
      const query = new PgDialect().sqlToQuery(condition!);
      for (const field of [
        "id",
        "userId",
        "type",
        "provider",
        "status",
        "input",
        "output",
        "error",
      ])
        expect(query.sql).toContain(`"${field}"`);
      expect(query.sql).toContain("IS NOT DISTINCT FROM");
      expect(query.params).toEqual(
        expect.arrayContaining([
          f.row.id,
          "7",
          "post_prod",
          "blender-previs",
          "failed",
          JSON.stringify(f.row.input),
          null,
          "落库失败",
        ])
      );
      expect(update.set).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "succeeded",
          output: f.result,
          error: null,
        })
      );
    } finally {
      db.mockRestore();
      inspect.mockRestore();
      bucket.mockRestore();
    }
  });
  it.each([null, {}, { postProdHeartbeatAt: "2026-09-11T10:00:00.000Z" }])(
    "原空结果或心跳恢复为同一视频，不重新生成：%j",
    async output => {
      const f = fixture();
      f.row.output = output;
      const recovered = await recoverPrevisResult(f.row, 7, f.d);
      expect(recovered.status).toBe("succeeded");
      expect(recovered.error).toBeNull();
      expect(recovered.output).toEqual(f.result);
      expect(f.d.save).toHaveBeenCalledTimes(1);
      expect(f.d.inspect).toHaveBeenCalledTimes(7);
    }
  );
  it.each(["queued", "running", "cancelled", "succeeded"])(
    "不触碰%s任务",
    async status => {
      const f = fixture();
      f.row.status = status;
      expect(await recoverPrevisResult(f.row, 7, f.d)).toBe(f.row);
      expect(f.d.inspect).not.toHaveBeenCalled();
    }
  );
  it.each([
    { gcsUri: "gs://original/video" },
    { cancelRequested: true },
    { url: "https://original.invalid" },
    { unknown: 1 },
  ])("不覆盖已有或未知输出：%j", async output => {
    const f = fixture();
    f.row.output = output;
    expect(await recoverPrevisResult(f.row, 7, f.d)).toBe(f.row);
    expect(f.d.inspect).not.toHaveBeenCalled();
  });
  it("越权、错误动作、伪造任务号在云读取前拒绝", async () => {
    for (const mutate of [
      (f: ReturnType<typeof fixture>) => {
        f.row.userId = "8";
      },
      (f: ReturnType<typeof fixture>) => {
        f.row.id = previsTaskId(8, f.input.requestId);
      },
      (f: ReturnType<typeof fixture>) => {
        f.row.input = { action: "audio_trim", params: f.input };
      },
    ]) {
      const f = fixture();
      mutate(f);
      expect(await recoverPrevisResult(f.row, 7, f.d)).toBe(f.row);
      expect(f.d.inspect).not.toHaveBeenCalled();
    }
  });
  it.each([
    "user",
    "scope",
    "clip",
    "spec",
    "bucket",
    "prefix",
    "hash",
    "bytes",
    "frames",
    "bones",
    "duration",
    "requestHash",
  ])("有效manifest也不能放行错误%s", async kind => {
    const f = fixture();
    if (kind === "user") f.result.userId = "8";
    if (kind === "scope")
      f.result.scopeId = "33333333-3333-4333-8333-333333333333";
    if (kind === "clip") f.result.clipId = "clip-other";
    if (kind === "spec")
      ((f.result.spec = structuredClone(f.result.spec)),
        (f.result.spec.actors[0].nameZh = "另一个人"));
    if (kind === "bucket")
      f.result.gcsUri = f.result.gcsUri.replace(
        "test-bucket",
        "foreign-bucket"
      );
    if (kind === "prefix")
      f.result.sceneGcsUri = f.result.sceneGcsUri.replace("/7/", "/8/");
    if (kind === "hash") f.result.sha256 = "0".repeat(64);
    if (kind === "bytes") f.result.bytes++;
    if (kind === "frames") f.result.report.frames = 47;
    if (kind === "bones") f.result.report.actors[0].bones = 0;
    if (kind === "duration") f.result.durationSec = 3;
    if (kind === "requestHash") f.result.requestSha256 = "0".repeat(64);
    f.seal();
    expect(await recoverPrevisResult(f.row, 7, f.d)).toBe(f.row);
    expect(f.d.save).not.toHaveBeenCalled();
  });
  it.each([
    "result-evidence.json",
    "result.json",
    "request.json",
    "report.json",
    "probe.json",
    "scene.blend",
    "preview.mp4",
  ])("缺失%s保留失败，不伪造成功", async name => {
    const f = fixture();
    f.objects.delete(f.prefix + name);
    expect(await recoverPrevisResult(f.row, 7, f.d)).toBe(f.row);
    expect(f.d.save).not.toHaveBeenCalled();
  });
  it("原始回执被篡改/超限、manifest身份不符均拒收", async () => {
    for (const kind of ["corrupt", "large", "owner"]) {
      const f = fixture();
      if (kind === "corrupt")
        f.objects.set(f.prefix + "result.json", Buffer.from("{}"));
      if (kind === "large")
        f.objects.set(
          f.prefix + "result.json",
          Buffer.alloc(4 * 1024 * 1024 + 1)
        );
      if (kind === "owner") {
        const manifest = JSON.parse(
          f.objects.get(f.prefix + "result-evidence.json")!.toString()
        );
        manifest.userId = "8";
        f.objects.set(
          f.prefix + "result-evidence.json",
          Buffer.from(JSON.stringify(manifest))
        );
      }
      expect(await recoverPrevisResult(f.row, 7, f.d)).toBe(f.row);
      expect(f.d.save).not.toHaveBeenCalled();
    }
  });
  it("CAS竞争取消返回取消记录，写入失败不冒充成功", async () => {
    const f = fixture();
    f.d.save = vi.fn(async () => ({ ...f.row, status: "cancelled" }));
    expect((await recoverPrevisResult(f.row, 7, f.d)).status).toBe("cancelled");
    f.d.save = vi.fn(async () => {
      throw new Error("数据库不可用");
    });
    expect(await recoverPrevisResult(f.row, 7, f.d)).toBe(f.row);
  });
  it("查询、同号提交和列表均消费恢复；不同配置先拒绝，不调用恢复", async () => {
    const f = fixture();
    const recover = vi.fn((row: PrevisRecoveryRow, user: number) =>
      recoverPrevisResult(row, user, f.d)
    );
    const d: PrevisTaskDeps = {
      load: async () => f.row,
      insert: vi.fn(async () => {}),
      sign: uri => `signed:${uri}`,
      recover,
    };
    expect((await getPrevisTask(7, f.input.requestId, d))?.status).toBe(
      "succeeded"
    );
    expect((await submitPrevisTask(7, f.input, d)).output).toMatchObject({
      url: `signed:${f.result.gcsUri}`,
    });
    expect(
      (
        await listPrevisTasks(7, f.input.scopeId, f.input.clipId, undefined, {
          list: async () => [f.row],
          sign: d.sign,
          recover,
        })
      ).items[0].status
    ).toBe("succeeded");
    expect(recover).toHaveBeenCalledTimes(3);
    await expect(
      submitPrevisTask(7, { ...f.input, clipId: "other" }, d)
    ).rejects.toThrow("不同配置");
    expect(recover).toHaveBeenCalledTimes(3);
  });
});

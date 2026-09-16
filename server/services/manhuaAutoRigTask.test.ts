import { describe, expect, it } from "vitest";
import {
  AUTO_RIG_BONES,
  autoRigRequestSchema,
  type AutoRigRequest,
} from "../../shared/manhuaAutoRig";
import { autoRigSha, validateAutoRigBindReport } from "./manhuaAutoRigRender";
import {
  autoRigTaskId,
  getAutoRigTask,
  submitAutoRigTask,
  type AutoRigRow,
  type AutoRigTaskDeps,
} from "./manhuaAutoRigTask";
const request: AutoRigRequest = {
  stage: "inspect",
  requestId: "11111111-1111-4111-8111-111111111111",
  assetRef: "human-1",
  sourceJobId: "m3d_test_original",
  settings: { pose: "T", forwardAxis: "+X", targetHeight: 1.7 },
};
function fixture() {
  const rows = new Map<string, AutoRigRow>();
  let inserts = 0,
    reads = 0,
    saves = 0;
  const deps: AutoRigTaskDeps = {
    bucket: () => "test",
    load: async id => rows.get(id) ?? null,
    source: async () =>
      ({
        taskId: request.sourceJobId,
        assetRef: request.assetRef,
        bytes: 100,
        sha256: "a".repeat(64),
        gcsUri: "gs://test/source.glb",
      }) as any,
    insert: async (id, userId, input) => {
      inserts++;
      rows.set(id, {
        id,
        userId: String(userId),
        type: "post_prod",
        provider: "blender-auto-rig",
        status: "queued",
        input: { action: "manhua_auto_rig", params: input },
        output: null,
        error: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    },
    readResult: async () => {
      reads++;
      return null;
    },
    saveRecovered: async row => {
      saves++;
      return row;
    },
    sign: uri => uri,
  };
  return { rows, deps, counts: () => ({ inserts, reads, saves }) };
}
describe("人体绑骨请求闭合", () => {
  it("同编号重复提交只产生一个任务", async () => {
    const f = fixture();
    const a = await submitAutoRigTask(1, request, f.deps);
    const b = await submitAutoRigTask(1, structuredClone(request), f.deps);
    expect(a.jobId).toBe(b.jobId);
    expect(f.counts().inserts).toBe(1);
  });
  it("1473 R1 去事务后的并发窗口：同编号不同设置在 load 之后被别处抢先插入（onConflictDoNothing 静默）→ 回执核对拦下，不冒充成功", async () => {
    const f = fixture();
    const rival = { ...request, settings: { ...request.settings, pose: "A" } };
    const insert = f.deps.insert;
    // 模拟：本次 insert 到达时行已被并发赢家（不同设置）写入，onConflictDoNothing 不报错也不覆盖
    f.deps.insert = async (id, userId, _input) => insert(id, userId, rival as never);
    await expect(submitAutoRigTask(1, request, f.deps)).rejects.toThrow("请求回执未确认");
    expect(f.counts().inserts).toBe(1);
    // 赢家的设置原样保留
    const row = f.rows.get(Array.from(f.rows.keys())[0]!)!;
    expect((row.input as { params: { settings: { pose: string } } }).params.settings.pose).toBe("A");
  });
  it("同编号不同设置拒绝，不覆盖旧请求", async () => {
    const f = fixture();
    await submitAutoRigTask(1, request, f.deps);
    await expect(
      submitAutoRigTask(
        1,
        { ...request, settings: { ...request.settings, pose: "A" } },
        f.deps
      )
    ).rejects.toThrow("同一请求编号");
    expect(f.counts().inserts).toBe(1);
  });
  it("用户编号隔离", () =>
    expect(autoRigTaskId(1, request.requestId)).not.toBe(
      autoRigTaskId(2, request.requestId)
    ));
  it("伪造本人来源被拒绝", async () => {
    const f = fixture();
    f.deps.source = async () =>
      ({
        taskId: request.sourceJobId,
        assetRef: "other",
        bytes: 100,
        sha256: "a".repeat(64),
      }) as any;
    await expect(submitAutoRigTask(1, request, f.deps)).rejects.toThrow("范围");
    expect(f.counts().inserts).toBe(0);
  });
  it("空来源不能排队", async () => {
    const f = fixture();
    f.deps.source = async () =>
      ({
        taskId: request.sourceJobId,
        assetRef: request.assetRef,
        bytes: 0,
        sha256: "a".repeat(64),
      }) as any;
    await expect(submitAutoRigTask(1, request, f.deps)).rejects.toThrow("范围");
  });
  it("查不到任务不提交", async () => {
    const f = fixture();
    expect(await getAutoRigTask(1, request.requestId, f.deps)).toBeNull();
    expect(f.counts().inserts).toBe(0);
  });
  it.each(["canceled", "running"])("%s 不尝试失败恢复", async status => {
    const f = fixture();
    await submitAutoRigTask(1, request, f.deps);
    const row = f.rows.get(autoRigTaskId(1, request.requestId))!;
    row.status = status;
    await getAutoRigTask(1, request.requestId, f.deps);
    expect(f.counts().reads).toBe(0);
  });
  it("取消标记失败不恢复也不重排", async () => {
    const f = fixture();
    await submitAutoRigTask(1, request, f.deps);
    const row = f.rows.get(autoRigTaskId(1, request.requestId))!;
    row.status = "failed";
    row.input = {
      ...(row.input as object),
      cancelRequestedAt: new Date().toISOString(),
    };
    await getAutoRigTask(1, request.requestId, f.deps);
    expect(f.counts()).toEqual({ inserts: 1, reads: 0, saves: 0 });
  });
  it("无完整云回执失败保留原状态", async () => {
    const f = fixture();
    await submitAutoRigTask(1, request, f.deps);
    f.rows.get(autoRigTaskId(1, request.requestId))!.status = "failed";
    expect((await getAutoRigTask(1, request.requestId, f.deps))?.status).toBe(
      "failed"
    );
    expect(f.counts()).toEqual({ inserts: 1, reads: 1, saves: 0 });
  });
  it("缺少人工确认不能绑定", () =>
    expect(
      autoRigRequestSchema.safeParse({ ...request, stage: "bind" }).success
    ).toBe(false));
});
const limbs = ["forearm-1", "forearm1", "lower_leg-1", "lower_leg1"];
function report() {
  const sha = autoRigSha("test");
  return {
    status: "candidate_validated",
    productionReady: false,
    qualityAccepted: false,
    sourceDigest: sha,
    outputSha256: sha,
    vertices: 100,
    maxWeightInfluences: 4,
    influencedVertices: Object.fromEntries(
      Object.keys(AUTO_RIG_BONES).map(k => [k, 5])
    ),
    bendMaxDeltaMeters: Object.fromEntries(limbs.map(k => [k, 0.2])),
    reimportBendMaxDeltaMeters: Object.fromEntries(limbs.map(k => [k, 0.2])),
    truncationBendMaxDeltaMeters: Object.fromEntries(limbs.map(k => [k, 0])),
    stage4Reimport: {
      sha256: sha,
      mappedBones: 16,
      meshVertices: 120,
      weightedVertices: 120,
    },
  };
}
describe("绑骨数值回执不冒充美术验收", () => {
  it("完整真实数值结构通过且保留未验质量", () => {
    const r = report();
    expect(validateAutoRigBindReport(r, r.sourceDigest).qualityAccepted).toBe(
      false
    );
  });
  it("四个任意键不能冒充四肢", () => {
    const r = report();
    r.reimportBendMaxDeltaMeters = { a: 1, b: 1, c: 1, d: 1 };
    expect(() => validateAutoRigBindReport(r, r.sourceDigest)).toThrow();
  });
  it("重导入无位移不能通过", () => {
    const r = report();
    r.reimportBendMaxDeltaMeters[limbs[0]] = 0;
    expect(() => validateAutoRigBindReport(r, r.sourceDigest)).toThrow();
  });
  it("存在无权重顶点不能通过", () => {
    const r = report();
    r.stage4Reimport.weightedVertices--;
    expect(() => validateAutoRigBindReport(r, r.sourceDigest)).toThrow();
  });
  it("候选SHA不一致不能采用", () => {
    const r = report();
    expect(() =>
      validateAutoRigBindReport(r, r.sourceDigest, "b".repeat(64))
    ).toThrow();
  });
});

import { adoptAutoRigTask, type AutoRigAdoptDeps } from "./manhuaAutoRigTask";
function adoption() {
  const sourceSha = "c".repeat(64),
    candidateSha = "d".repeat(64),
    calls: unknown[] = [];
  const original = {
    taskId: request.sourceJobId,
    assetRef: request.assetRef,
    status: "succeeded",
    sourceVersion: "gs://test/original-image.png",
    sourceImageUrl: "https://offline.invalid/original.png",
  };
  const task = {
    status: "succeeded",
    params: { ...request, stage: "bind" },
    output: {
      stage: "bind",
      sha256: candidateSha,
      sourceSha256: sourceSha,
      bytes: 100,
      gcsUri: `gs://test/uploads/u7/auto-rig/${request.requestId}/model.glb`,
    },
  };
  const d: AutoRigAdoptDeps = {
    get: async () => task as any,
    source: async () => ({ sha256: sourceSha }) as any,
    original: async () => original as any,
    bucket: () => "test",
    inspect: async () => ({ sha256: candidateSha, byteLength: 100 }) as any,
    importModel: async input => {
      calls.push(input);
      return { ...original, taskId: "m3d_import_test" } as any;
    },
  };
  return { d, task, original, calls, candidateSha };
}
it("采用复用已有导入器，继承原图来源版本且候选存储限定本人", async () => {
  const f = adoption();
  const result = await adoptAutoRigTask(
    7,
    request.requestId,
    f.candidateSha,
    false,
    f.d
  );
  expect(result.taskId).toBe("m3d_import_test");
  expect(f.calls).toEqual([
    {
      userId: 7,
      assetRef: request.assetRef,
      sourceVersion: f.original.sourceVersion,
      sourceImageUrl: f.original.sourceImageUrl,
      glbGcsUri: f.task.output.gcsUri,
    },
  ]);
});
it("恢复返回原任务，不创建新模型记录或删除候选", async () => {
  const f = adoption();
  expect(
    await adoptAutoRigTask(7, request.requestId, f.candidateSha, true, f.d)
  ).toEqual(f.original);
  expect(f.calls).toEqual([]);
});
it("候选内容变化拒绝采用，不调用导入器", async () => {
  const f = adoption();
  f.d.inspect = async () =>
    ({ sha256: "0".repeat(64), byteLength: 100 }) as any;
  await expect(
    adoptAutoRigTask(7, request.requestId, f.candidateSha, false, f.d)
  ).rejects.toThrow("字节已变化");
  expect(f.calls).toEqual([]);
});
it("候选非本人命名空间拒绝采用", async () => {
  const f = adoption();
  f.task.output.gcsUri = f.task.output.gcsUri.replace("/u7/", "/u8/");
  await expect(
    adoptAutoRigTask(7, request.requestId, f.candidateSha, false, f.d)
  ).rejects.toThrow("来源不一致");
  expect(f.calls).toEqual([]);
});
it("原模型版本变更拒绝恢复", async () => {
  const f = adoption();
  f.d.source = async () => ({ sha256: "0".repeat(64) }) as any;
  await expect(
    adoptAutoRigTask(7, request.requestId, f.candidateSha, true, f.d)
  ).rejects.toThrow("版本不一致");
});

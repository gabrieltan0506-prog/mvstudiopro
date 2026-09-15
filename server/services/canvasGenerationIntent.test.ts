/**
 * 服务端意图裁决：扣费前的多态区分与并发竞态。
 *
 * 存储改数据库后（0915 拍板），本文件用 MemoryCanvasIntentStore：
 * 每个操作让出一次事件循环再原子执行，与「多个请求同时到达数据库、逐条串行」同语义。
 * 它证明的是**裁决逻辑**在原子存储上的正确性；Postgres 的 SQL 形状另见
 * canvasIntentStore.pg.test.ts。**真实 Postgres 的原子性本仓离线设施验不了，如实标未验。**
 *
 * 覆盖施工单 12 项里属于本层的：
 *   #4 同意图不同 body → 409 且零扣费（含首次并发请求）
 *   #6 占位已写任务未建 → 输家不补建
 *   #7 读失败 / 损坏 / 数据库不可用 → 不走「未命中→新建」，不回退文件
 *   #8 扣费成功后建单前中断 → 同 chargeKey、同 taskId 恢复
 *   #5 换账号不能查询或绑定他人任务
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  CANVAS_INTENT_RECORD_FORMAT,
  acquireCanvasIntent,
  computeCanvasTaskInputDigest,
  computeServerRequestDigest,
  lookupCanvasIntent,
  planCanvasIntentJobStep,
  releaseCanvasIntentLease,
  renewCanvasIntentLease,
  updateCanvasIntentStage,
} from "./canvasGenerationIntent";
import { MemoryCanvasIntentStore, failClosedCanvasIntentStore } from "./canvasIntentStore";

let store: MemoryCanvasIntentStore;

beforeEach(() => {
  store = new MemoryCanvasIntentStore();
});

const base = {
  userId: 7,
  intentId: "gi_clip_a",
  operation: "clip",
  holderId: "holder-A",
};
const mk = (
  over: Partial<typeof base> & {
    requestDigest: string;
    now?: () => number;
    leaseMs?: number;
    reservedTaskId?: string;
  },
) => ({ ...base, store, ...over });

describe("摘要：黑名单口径，非语义字段才排除", () => {
  it("提交键/意图 ID 这类每次都变的字段不参与摘要", () => {
    const a = computeServerRequestDigest({ prompt: "x", idempotencyKey: "k1", intentId: "i1" });
    const b = computeServerRequestDigest({ prompt: "x", idempotencyKey: "k2", intentId: "i2" });
    expect(a).toBe(b);
  });

  it("对象键序不影响摘要，但**数组次序有语义**必须影响", () => {
    expect(computeServerRequestDigest({ a: 1, b: 2 })).toBe(
      computeServerRequestDigest({ b: 2, a: 1 }),
    );
    expect(computeServerRequestDigest({ refs: ["u1", "u2"] })).not.toBe(
      computeServerRequestDigest({ refs: ["u2", "u1"] }),
    );
  });

  it("换模型/工作模式/时长/音频开关都必须换摘要（不按白名单漏字段）", () => {
    const b0 = { prompt: "p", videoModel: "wan-3.0", workMode: "i2v", duration: 10, generateAudio: true };
    const d0 = computeServerRequestDigest(b0);
    expect(computeServerRequestDigest({ ...b0, videoModel: "seedance-2.5" })).not.toBe(d0);
    expect(computeServerRequestDigest({ ...b0, workMode: "reference_to_video" })).not.toBe(d0);
    expect(computeServerRequestDigest({ ...b0, duration: 15 })).not.toBe(d0);
    expect(computeServerRequestDigest({ ...b0, generateAudio: false })).not.toBe(d0);
  });

  it("建单输入摘要：计费快照/任务号/标签不计，提示词与引用顺序计", () => {
    const t0 = {
      prompt: "p", imageUrls: ["a", "b"], duration: 10, engine: "wan30-auto",
      userId: 7, creditsCharged: 30, deduct: { source: "personal" }, taskId: "cv_x", label: "L", idempotencyKey: "k",
    };
    const d0 = computeCanvasTaskInputDigest(t0);
    expect(computeCanvasTaskInputDigest({ ...t0, userId: 8, creditsCharged: 99, taskId: "cv_y", label: "M", idempotencyKey: "z" })).toBe(d0);
    expect(computeCanvasTaskInputDigest({ ...t0, imageUrls: ["b", "a"] })).not.toBe(d0);
    expect(computeCanvasTaskInputDigest({ ...t0, prompt: "q" })).not.toBe(d0);
  });
});

describe("占位与裁决", () => {
  it("首次调用拿到创建权", async () => {
    const got = await acquireCanvasIntent(mk({ requestDigest: "d1" }));
    expect(got.kind).toBe("acquired");
  });

  it("并发两个同时占位，只有一个拿到创建权，另一个是 creating（不补建）", async () => {
    const [a, b] = await Promise.all([
      acquireCanvasIntent(mk({ requestDigest: "d1" })),
      acquireCanvasIntent(mk({ requestDigest: "d1" })),
    ]);
    expect([a.kind, b.kind].sort()).toEqual(["acquired", "creating"]);
  });

  it("十路并发只有一个赢家（原子存储上 insertIfAbsent 只成功一次）", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => acquireCanvasIntent(mk({ requestDigest: "d1" }))),
    );
    expect(results.filter((r) => r.kind === "acquired")).toHaveLength(1);
    expect(results.filter((r) => r.kind === "creating")).toHaveLength(9);
  });

  it("#6 占位已写、任务未建时，第二次请求是 creating 而不是补建", async () => {
    await acquireCanvasIntent(mk({ requestDigest: "d1" })); // 赢家停在 reserved
    const second = await acquireCanvasIntent(mk({ requestDigest: "d1" }));
    expect(second.kind).toBe("creating");
    if (second.kind !== "creating") return;
    expect(second.record.stage).toBe("reserved");
    expect(second.record.taskId).toMatch(/^cv_/);
    expect(second.leaseExpiresAt).toBeTruthy();
  });

  it("试片已预留任务号时沿用它，不另造第二个号", async () => {
    const got = await acquireCanvasIntent(mk({ requestDigest: "d1", reservedTaskId: "cv_pilot_reserved_01" }));
    expect(got.kind).toBe("acquired");
    if (got.kind !== "acquired") return;
    expect(got.record.taskId).toBe("cv_pilot_reserved_01");
  });

  it("任务已建：返回既有任务，零扣费零上游", async () => {
    const first = await acquireCanvasIntent(mk({ requestDigest: "d1" }));
    await updateCanvasIntentStage({ ...mk({ requestDigest: "d1" }), stage: "task_created" });
    const again = await acquireCanvasIntent(mk({ requestDigest: "d1" }));
    expect(again.kind).toBe("existing_task");
    if (again.kind !== "existing_task" || first.kind !== "acquired") return;
    expect(again.taskId).toBe(first.record.taskId);
  });

  it("#8 已扣费但任务未建：返回 charged_pending_task 并带 chargeKey，供恢复时不二扣", async () => {
    await acquireCanvasIntent(mk({ requestDigest: "d1" }));
    await updateCanvasIntentStage({ ...mk({ requestDigest: "d1" }), stage: "charged", chargeKey: "ck_1" });
    const again = await acquireCanvasIntent(mk({ requestDigest: "d1" }));
    expect(again.kind).toBe("charged_pending_task");
    if (again.kind !== "charged_pending_task") return;
    expect(again.record.chargeKey).toBe("ck_1");
  });
});

describe("#4 同意图不同输入：扣费前冲突", () => {
  it("摘要不同 → conflict，并给出原摘要", async () => {
    await acquireCanvasIntent(mk({ requestDigest: "d1" }));
    const got = await acquireCanvasIntent(mk({ requestDigest: "d2" }));
    expect(got.kind).toBe("conflict");
    if (got.kind !== "conflict") return;
    expect(got.expectedDigest).toBe("d1");
  });

  it("**首次并发**也覆盖：两个不同 body 同时占位，输家必须是 conflict 而非 creating", async () => {
    const [a, b] = await Promise.all([
      acquireCanvasIntent(mk({ requestDigest: "dA" })),
      acquireCanvasIntent(mk({ requestDigest: "dB" })),
    ]);
    expect([a.kind, b.kind].sort()).toEqual(["acquired", "conflict"]);
  });

  it("冲突不覆盖原记录——原摘要仍在", async () => {
    await acquireCanvasIntent(mk({ requestDigest: "d1" }));
    await acquireCanvasIntent(mk({ requestDigest: "d2" }));
    const found = await lookupCanvasIntent(mk({ requestDigest: "d1" }));
    expect(found.kind).toBe("ok");
    if (found.kind !== "ok") return;
    expect(found.record.requestDigest).toBe("d1");
  });
});

describe("#7 读失败 / 损坏 / 数据库不可用：绝不当作「不存在」，不回退文件", () => {
  it("占位后读取返回损坏 → unreadable，不是 acquired 也不是 creating", async () => {
    await acquireCanvasIntent(mk({ requestDigest: "d1" }));
    store.faults.get = () => ({ kind: "unreadable", reasonZh: "生成记录内容损坏" });
    const got = await acquireCanvasIntent(mk({ requestDigest: "d1" }));
    expect(got.kind).toBe("unreadable");
  });

  it("插入本身报错（连接断/权限）→ unreadable，带原因", async () => {
    store.faults.insert = () => ({ kind: "unreadable", reasonZh: "生成记录占位失败（EACCES）" });
    const got = await acquireCanvasIntent(mk({ requestDigest: "d1" }));
    expect(got.kind).toBe("unreadable");
    if (got.kind !== "unreadable") return;
    expect(got.reasonZh).toContain("EACCES");
  });

  it("插入说已存在、读却说没有 → unreadable，不放行新建", async () => {
    store.faults.insert = () => ({ kind: "exists" });
    const got = await acquireCanvasIntent(mk({ requestDigest: "d1" }));
    expect(got.kind).toBe("unreadable");
  });

  it("lookup 读不出来时返回 unreadable 而不是 none——调用方不会误判成可新建", async () => {
    await acquireCanvasIntent(mk({ requestDigest: "d1" }));
    store.faults.get = () => ({ kind: "unreadable", reasonZh: "坏" });
    expect((await lookupCanvasIntent(mk({ requestDigest: "d1" }))).kind).toBe("unreadable");
  });

  it("数据库不可用/表未就绪：占位、查询、更新全部拒绝（fail-closed，不回退）", async () => {
    const closed = failClosedCanvasIntentStore("数据库不可用");
    const got = await acquireCanvasIntent({ ...mk({ requestDigest: "d1" }), store: closed });
    expect(got.kind).toBe("unreadable");
    expect((await lookupCanvasIntent({ ...mk({ requestDigest: "d1" }), store: closed })).kind).toBe("unreadable");
    expect(
      await updateCanvasIntentStage({ ...mk({ requestDigest: "d1" }), store: closed, stage: "charged", chargeKey: "ck" }),
    ).toBeNull();
    expect(store.peek(7, "gi_clip_a")).toBeUndefined(); // 没有偷偷写到别处
  });
});

describe("#5 归属：换账号不能碰他人任务", () => {
  it("不同 userId 的同 intentId 是各自独立的占位", async () => {
    const a = await acquireCanvasIntent(mk({ requestDigest: "d1", userId: 7 }));
    const b = await acquireCanvasIntent(mk({ requestDigest: "d1", userId: 8 }));
    expect(a.kind).toBe("acquired");
    expect(b.kind).toBe("acquired");
  });

  it("按他人 userId 查不到记录（不泄露）", async () => {
    await acquireCanvasIntent(mk({ requestDigest: "d1", userId: 7 }));
    expect((await lookupCanvasIntent(mk({ requestDigest: "d1", userId: 8 }))).kind).toBe("none");
  });

  it("更新阶段时归属不符一律拒绝", async () => {
    await acquireCanvasIntent(mk({ requestDigest: "d1", userId: 7 }));
    const res = await updateCanvasIntentStage({
      ...mk({ requestDigest: "d1", userId: 8 }),
      stage: "task_created",
    });
    expect(res).toBeNull();
  });
});

describe("阶段更新", () => {
  it("扣费 → 建单两步都能落盘，且保留原摘要、intentId 与 taskId", async () => {
    const first = await acquireCanvasIntent(mk({ requestDigest: "d1" }));
    await updateCanvasIntentStage({ ...mk({ requestDigest: "d1" }), stage: "charged", chargeKey: "ck" });
    const after = await updateCanvasIntentStage({ ...mk({ requestDigest: "d1" }), stage: "task_created" });
    expect(after?.stage).toBe("task_created");
    expect(after?.chargeKey).toBe("ck");
    if (first.kind === "acquired") expect(after?.taskId).toBe(first.record.taskId);
    expect(after?.requestDigest).toBe("d1");
    expect(after?.format).toBe(CANVAS_INTENT_RECORD_FORMAT);
  });

  it("记录不存在时更新返回 null，不凭空造一条", async () => {
    const res = await updateCanvasIntentStage({ ...mk({ requestDigest: "d1" }), stage: "charged", chargeKey: "ck" });
    expect(res).toBeNull();
    expect((await lookupCanvasIntent(mk({ requestDigest: "d1" }))).kind).toBe("none");
  });
});

describe("creating 崩溃后的安全接管（凭租约，不凭猜）", () => {
  it("租约仍有效时**不许接管**，只能 creating", async () => {
    let t = 1_000_000;
    const now = () => t;
    await acquireCanvasIntent(mk({ requestDigest: "d1", holderId: "A", now, leaseMs: 60_000 }));
    t += 30_000;
    const got = await acquireCanvasIntent(mk({ requestDigest: "d1", holderId: "B", now, leaseMs: 60_000 }));
    expect(got.kind).toBe("creating");
  });

  it("租约**确已过期**才接管，且沿用原 taskId 与原摘要", async () => {
    let t = 1_000_000;
    const now = () => t;
    const first = await acquireCanvasIntent(mk({ requestDigest: "d1", holderId: "A", now, leaseMs: 60_000 }));
    t += 60_001;
    const got = await acquireCanvasIntent(mk({ requestDigest: "d1", holderId: "B", now, leaseMs: 60_000 }));
    expect(got.kind).toBe("took_over");
    if (got.kind !== "took_over" || first.kind !== "acquired") return;
    expect(got.previousHolderId).toBe("A");
    expect(got.record.holderId).toBe("B");
    expect(got.record.taskId).toBe(first.record.taskId);
    expect(got.record.requestDigest).toBe("d1");
  });

  it("**两个接管者同时到，只有一个接管成功**（条件 UPDATE 只命中一次）", async () => {
    let t = 1_000_000;
    const now = () => t;
    await acquireCanvasIntent(mk({ requestDigest: "d1", holderId: "A", now, leaseMs: 1000 }));
    t += 2000;
    const [b, c] = await Promise.all([
      acquireCanvasIntent(mk({ requestDigest: "d1", holderId: "B", now, leaseMs: 60_000 })),
      acquireCanvasIntent(mk({ requestDigest: "d1", holderId: "C", now, leaseMs: 60_000 })),
    ]);
    expect([b.kind, c.kind].sort()).toEqual(["creating", "took_over"]);
    const holder = store.peek(7, "gi_clip_a")?.holderId;
    expect(["B", "C"]).toContain(holder);
  });

  it("**续租可阻止接管**——赢家只是慢，不该被抢走", async () => {
    let t = 1_000_000;
    const now = () => t;
    await acquireCanvasIntent(mk({ requestDigest: "d1", holderId: "A", now, leaseMs: 60_000 }));
    t += 50_000;
    await renewCanvasIntentLease(mk({ requestDigest: "d1", holderId: "A", now, leaseMs: 60_000 }));
    t += 20_000;
    const got = await acquireCanvasIntent(mk({ requestDigest: "d1", holderId: "B", now, leaseMs: 60_000 }));
    expect(got.kind).toBe("creating");
  });

  it("非持有者不能续租（防止把别人的租约延长）", async () => {
    await acquireCanvasIntent(mk({ requestDigest: "d1", holderId: "A" }));
    expect(await renewCanvasIntentLease(mk({ requestDigest: "d1", holderId: "B" }))).toBeNull();
  });

  it("被接管后，**原持有者的迟到写入必须被拒**，不能把接管者写回去", async () => {
    let t = 1_000_000;
    const now = () => t;
    await acquireCanvasIntent(mk({ requestDigest: "d1", holderId: "A", now, leaseMs: 1000 }));
    t += 2000;
    const took = await acquireCanvasIntent(mk({ requestDigest: "d1", holderId: "B", now, leaseMs: 60_000 }));
    expect(took.kind).toBe("took_over");
    const stale = await updateCanvasIntentStage({
      ...mk({ requestDigest: "d1", holderId: "A", now }),
      stage: "charged",
      chargeKey: "ck_stale",
    });
    expect(stale).toBeNull();
    const after = await lookupCanvasIntent(mk({ requestDigest: "d1" }));
    expect(after.kind).toBe("ok");
    if (after.kind !== "ok") return;
    expect(after.record.holderId).toBe("B");
    expect(after.record.chargeKey).toBeUndefined();
  });
});

describe("charged_pending_task 恢复到同一任务", () => {
  it("扣费后崩溃：恢复者先接管持有权，拿回**同一个预留 taskId** 与 chargeKey，不二扣不换任务", async () => {
    let t = 1_000_000;
    const now = () => t;
    const first = await acquireCanvasIntent(mk({ requestDigest: "d1", holderId: "A", now, leaseMs: 1000 }));
    if (first.kind !== "acquired") throw new Error("setup");
    await updateCanvasIntentStage({ ...mk({ requestDigest: "d1", holderId: "A", now, leaseMs: 1000 }), stage: "charged", chargeKey: "ck_1" });
    // 租约未过期：别的执行体只能 creating（A 可能正要建单）
    expect((await acquireCanvasIntent(mk({ requestDigest: "d1", holderId: "B", now }))).kind).toBe("creating");
    t += 2000;
    const again = await acquireCanvasIntent(mk({ requestDigest: "d1", holderId: "B", now }));
    expect(again.kind).toBe("charged_pending_task");
    if (again.kind !== "charged_pending_task") return;
    expect(again.record.taskId).toBe(first.record.taskId);
    expect(again.record.chargeKey).toBe("ck_1");
    // 持有权已转给 B：A 的迟到推进被拒，B 的能过（否则 B 会被自己的 fencing 挡住，任务永久卡住）
    expect(again.record.holderId).toBe("B");
    expect(await updateCanvasIntentStage({ ...mk({ requestDigest: "d1", holderId: "A", now }), stage: "task_created" })).toBeNull();
    expect((await updateCanvasIntentStage({ ...mk({ requestDigest: "d1", holderId: "B", now }), stage: "task_created" }))?.stage).toBe("task_created");
  });

  it("charged 状态即使租约过期也走恢复路径，不退化成接管新建", async () => {
    let t = 1_000_000;
    const now = () => t;
    const first = await acquireCanvasIntent(mk({ requestDigest: "d1", holderId: "A", now, leaseMs: 1000 }));
    if (first.kind !== "acquired") throw new Error("setup");
    await updateCanvasIntentStage({ ...mk({ requestDigest: "d1", holderId: "A", now }), stage: "charged", chargeKey: "ck_1" });
    t += 999_999;
    const again = await acquireCanvasIntent(mk({ requestDigest: "d1", holderId: "B", now, leaseMs: 60_000 }));
    expect(again.kind).toBe("charged_pending_task");
    if (again.kind !== "charged_pending_task") return;
    expect(again.record.taskId).toBe(first.record.taskId);
  });
});

describe("planCanvasIntentJobStep：裁决 → 建单点动作（纯映射）", () => {
  const rec = (stage: "reserved" | "charged" | "task_created", extra: Record<string, unknown> = {}) => ({
    format: CANVAS_INTENT_RECORD_FORMAT, intentId: "gi", userId: 7, operation: "clip", requestDigest: "d",
    stage, taskId: "cv_reserved_1", holderId: "H", leaseExpiresAt: "2026-01-01T00:00:00.000Z",
    createdAt: "x", updatedAt: "x", ...extra,
  }) as const;

  it("acquired / took_over / charged_pending_task 都继续，且 taskId 是预留号", () => {
    for (const d of [
      { kind: "acquired" as const, record: rec("reserved") },
      { kind: "took_over" as const, record: rec("reserved"), previousHolderId: "X" },
      { kind: "charged_pending_task" as const, record: rec("charged", { chargeKey: "ck" }) },
    ]) {
      const step = planCanvasIntentJobStep(d, "gi");
      expect(step.proceed).toBe(true);
      if (step.proceed) expect(step.taskId).toBe("cv_reserved_1");
    }
  });

  it("conflict → 409 零扣费；creating → 202 可查询不诱导重生成；unreadable → 503", () => {
    const c = planCanvasIntentJobStep({ kind: "conflict", record: rec("reserved"), expectedDigest: "d" }, "gi");
    expect(c.proceed).toBe(false);
    if (!c.proceed && c.kind === "reply") { expect(c.status).toBe(409); expect(c.body.code).toBe("intent_conflict"); }
    const p = planCanvasIntentJobStep({ kind: "creating", record: rec("reserved"), leaseExpiresAt: "L" }, "gi");
    if (!p.proceed && p.kind === "reply") { expect(p.status).toBe(202); expect(p.body.pending).toBe(true); expect(p.body.taskId).toBeUndefined(); }
    const u = planCanvasIntentJobStep({ kind: "unreadable", reasonZh: "坏" }, "gi");
    if (!u.proceed && u.kind === "reply") { expect(u.status).toBe(503); expect(u.body.code).toBe("intent_unreadable"); }
  });

  it("existing_task → 交回 taskId 让建单点还原既有任务", () => {
    const e = planCanvasIntentJobStep({ kind: "existing_task", record: rec("task_created"), taskId: "cv_reserved_1" }, "gi");
    expect(e.proceed).toBe(false);
    if (!e.proceed && e.kind === "existing_task") expect(e.taskId).toBe("cv_reserved_1");
  });
});

describe("扣费失败后释放占位（R1 1464-08）", () => {
  it("释放后别的执行体**立刻**能接管，不用等租约；stage/taskId 不变", async () => {
    let t = 1_000_000;
    const now = () => t;
    const first = await acquireCanvasIntent(mk({ requestDigest: "d1", holderId: "A", now, leaseMs: 60_000 }));
    if (first.kind !== "acquired") throw new Error("setup");
    // 未释放：B 只能 creating
    expect((await acquireCanvasIntent(mk({ requestDigest: "d1", holderId: "B", now }))).kind).toBe("creating");
    expect(await releaseCanvasIntentLease(mk({ requestDigest: "d1", holderId: "A", now }))).toBe(true);
    t += 1; // 几乎同时
    const got = await acquireCanvasIntent(mk({ requestDigest: "d1", holderId: "B", now }));
    expect(got.kind).toBe("took_over");
    if (got.kind !== "took_over") return;
    expect(got.record.taskId).toBe(first.record.taskId);
    expect(got.record.stage).toBe("reserved");
  });

  it("非持有者释放不了别人的占位", async () => {
    await acquireCanvasIntent(mk({ requestDigest: "d1", holderId: "A" }));
    expect(await releaseCanvasIntentLease(mk({ requestDigest: "d1", holderId: "B" }))).toBe(false);
    expect((await acquireCanvasIntent(mk({ requestDigest: "d1", holderId: "C" }))).kind).toBe("creating");
  });
});


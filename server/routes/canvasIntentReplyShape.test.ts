/**
 * R1 审查（PR #1464）补的两条路由级回归：
 *
 * 1464-04  Seedance 2.5 主链是对象返回、由 op 统一落 HTTP。裁决层的 202「creating」
 *          曾被压成 HTTP 200 且无 taskId / pending / intentId——客户端
 *          `resolvePendingCanvasIntentTaskId` 只认 202 或 pending===true，于是把它当失败。
 *          这里用内存意图存储的故障注入逼出 creating，断言 202 + pending + intentId 原样到达。
 *
 * 1464-06  试片预留（registry 里 submitting）在扣费前被裁决层挡回（503 unreadable / 409）时，
 *          零扣费零建单，预留必须释放成 failed；否则两分钟后 refreshUnderLock 判成
 *          reconcile_manual，一次数据库瞬断就把试片锁进人工核对。
 *
 * 鉴权 / 扣费 / 网络 / 上游全部虚构；任何真实 fetch 直接抛。
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CanvasIntentRow } from "../services/canvasIntentStore";

const boundary = vi.hoisted(() => ({
  authenticate: vi.fn(),
  charge: vi.fn(async () => {
    throw new Error("本测试禁止扣费");
  }),
}));
vi.mock("../_core/sdk.js", () => ({
  sdk: { authenticateRequest: boundary.authenticate },
}));
vi.mock("../credits.js", () => ({
  getUserPlan: async () => "pro",
  deductCreditsAmount: boundary.charge,
  refundCredits: vi.fn(async () => {}),
  InsufficientCreditsError: class extends Error {},
}));
vi.mock("../db.js", () => ({ getDb: async () => null }));
vi.mock("../services/openrouterHailuoVideo.js", () => ({
  isOpenRouterHailuoConfigured: () => true,
  buildOpenRouterHailuoSubmitBody: vi.fn(),
}));
vi.mock("../services/evolinkSeedanceVideo.js", () => ({
  EVOLINK_SEEDANCE_MAX_POLL_MS: 1_500_000,
  EVOLINK_SEEDANCE_POLL_INTERVAL_MS: 600_000,
  isEvolinkSeedanceConfigured: () => true,
  isSeedance25Enabled: () => true,
  buildEvolinkSeedanceRequest: () => ({}),
  submitEvolinkSeedanceVideo: vi.fn(async () => {
    throw new Error("本测试禁止上游提交");
  }),
  pollEvolinkVideoTaskOnce: vi.fn(),
}));
vi.mock("../services/byteplusSeedanceVideo.js", () => ({
  BYTEPLUS_SEEDANCE_MAX_POLL_MS: 1_500_000,
  isByteplusFallbackableError: () => false,
  isByteplusSeedanceConfigured: () => false,
  buildByteplusSeedance25SubmitBody: () => ({}),
  pollByteplusVideoTaskOnce: vi.fn(),
  submitByteplusSeedance25Video: vi.fn(),
}));
vi.mock("../services/paidJobLedger.js", () => ({
  registerActiveJob: async () => {},
  heartbeatActiveJob: async () => {},
  pauseActiveJob: async () => {},
  unregisterActiveJob: async () => ({ ok: true }),
  refundCreditsOnFailure: vi.fn(async () => ({ refunded: true, creditsRefunded: 0, status: "refunded" })),
  refundMarkerFor: () => "test-refund-marker",
  canonicalRefundKey: () => "test-refund-key",
}));

/** 内存意图存储：暴露出来做故障注入 */
const intentStore = vi.hoisted(() => ({ current: null as null | import("../services/canvasIntentStore").MemoryCanvasIntentStore }));
vi.mock("../services/canvasIntentStore.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../services/canvasIntentStore")>();
  const store = new mod.MemoryCanvasIntentStore();
  intentStore.current = store;
  return { ...mod, getDefaultCanvasIntentStore: async () => store };
});

let fixtureDir: string;
let handler: (typeof import("../../api/jobs"))["default"];

beforeAll(async () => {
  fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-intent-reply-shape-"));
  vi.stubEnv("CANVAS_VIDEO_TASK_DIR", path.join(fixtureDir, "tasks"));
  vi.stubEnv("MANHUA_PILOT_REVIEW_DIR", path.join(fixtureDir, "reviews"));
  await fs.mkdir(path.join(fixtureDir, "tasks"), { recursive: true });
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("本测试禁止真实网络和付费上游");
    }),
  );
  handler = (await import("../../api/jobs")).default;
  // mock 工厂是惰性的：先把意图层拉进来，让内存存储实例化以便注入故障
  await import("../services/canvasGenerationIntent");
  if (!intentStore.current) throw new Error("内存意图存储未实例化");
});
afterAll(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  if (fixtureDir) await fs.rm(fixtureDir, { recursive: true, force: true });
});
beforeEach(() => {
  boundary.authenticate.mockResolvedValue({ id: 71, role: "admin" });
  boundary.charge.mockClear();
  intentStore.current!.faults = {};
});

async function request(op: string, method: "GET" | "POST", body: unknown = {}, query: Record<string, unknown> = {}) {
  const out = { status: 0, body: {} as Record<string, any> };
  const res = {
    setHeader() {
      return res;
    },
    status(code: number) {
      out.status = code;
      return res;
    },
    json(payload: Record<string, any>) {
      out.body = payload;
      return res;
    },
    end() {
      return res;
    },
  };
  await handler({ method, query: { op, ...query }, body, headers: {} } as never, res as never);
  return out;
}

describe("1464-04 · Seedance 2.5 对象返回链：裁决层 202 / fencing 202 必须原样到达客户端", () => {
  it("同意图同摘要、别人持有且租约有效 → HTTP 202 + pending:true + intentId；零扣费零上游", async () => {
    const store = intentStore.current!;
    // 占位说「已存在」，读回一条**同摘要**（从插入行抄）、别的持有者、租约有效的 reserved 记录
    let captured: CanvasIntentRow | null = null;
    store.faults.insert = () => ({ kind: "exists" });
    const realInsert = store.insertIfAbsent.bind(store);
    store.insertIfAbsent = async (row) => {
      captured = row;
      return realInsert(row);
    };
    store.faults.get = () =>
      captured
        ? {
            kind: "ok",
            row: {
              ...captured,
              holderId: "h_other_executor",
              leaseExpiresAt: new Date(Date.now() + 50_000).toISOString(),
            },
          }
        : undefined;

    const result = await request("seedance25", "POST", {
      prompt: "虚构：山谷晨雾",
      imageUrl: "https://test.invalid/frame.png",
      duration: 5,
      resolution: "720p",
      aspectRatio: "9:16",
      intentId: "gi_clip-e01-01_r1shape0001",
      idempotencyKey: "gi_clip-e01-01_r1shape0001",
    });
    expect(result.status).toBe(202);
    expect(result.body).toMatchObject({
      ok: true,
      async: true,
      pending: true,
      status: "creating",
      intentId: "gi_clip-e01-01_r1shape0001",
      version: "2.5",
    });
    expect(result.body.taskId).toBeUndefined();
    expect(boundary.charge).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("裁决层 409 冲突（同意图不同摘要）→ HTTP 409 保持状态码；零扣费", async () => {
    const store = intentStore.current!;
    store.faults.insert = () => ({ kind: "exists" });
    store.faults.get = (key) => ({
      kind: "ok",
      row: {
        intentId: key.split(":").slice(1).join(":"),
        userId: 71,
        operation: "seedance25Video",
        requestDigest: "digest-of-a-different-request",
        stage: "reserved",
        taskId: "cv_other_task_000001",
        holderId: "h_other_executor",
        leaseExpiresAt: new Date(Date.now() + 50_000).toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
    const result = await request("seedance25", "POST", {
      prompt: "虚构：山谷晨雾（改了词）",
      imageUrl: "https://test.invalid/frame.png",
      duration: 5,
      resolution: "720p",
      intentId: "gi_clip-e01-01_r1shape0002",
    });
    expect(result.status).toBe(409);
    expect(result.body.ok).toBe(false);
    expect(boundary.charge).not.toHaveBeenCalled();
  });
});

describe("1464-06 · 试片预留在扣费前被裁决层挡回：预留必须释放，不留孤儿 submitting", () => {
  const scope = { projectVersion: "e".repeat(64), episodeIndex: 2, videoModel: "minimax-hailuo-3" };
  const submission = { projectVersion: scope.projectVersion, episodeIndex: 2, segmentIndex: 1, intent: "pilot" as const };

  it("意图存储 unreadable → 503、零扣费；registry 从 submitting 变 failed，再次提交能重新预留", async () => {
    const store = intentStore.current!;
    store.faults.insert = () => ({ kind: "unreadable", reasonZh: "测试注入：数据库瞬断" });

    const first = await request("hailuo3Video", "POST", {
      prompt: "虚构试片镜头",
      duration: 10,
      episodeIndex: 2,
      clipIndex: 1,
      manhuaPilot: submission,
    });
    expect(first.status).toBe(503);
    expect(first.body.code).toBe("intent_unreadable");
    expect(boundary.charge).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();

    const status = await request("manhuaPilotStatus", "GET", {}, scope);
    expect(status.body.ok).toBe(true);
    // 修前：submitting（孤儿预留，两分钟后 reconcile_manual）；修后：failed，可重新提交
    expect(status.body.review.status).toBe("failed");

    // 存储恢复后同一试片能重新预留并走到裁决（这里让它再次 unreadable 只为证明预留没被卡住）
    const second = await request("hailuo3Video", "POST", {
      prompt: "虚构试片镜头",
      duration: 10,
      episodeIndex: 2,
      clipIndex: 1,
      manhuaPilot: submission,
    });
    expect(second.status).toBe(503);
    expect(second.body.code).toBe("intent_unreadable");
    expect(boundary.charge).not.toHaveBeenCalled();
  });
});

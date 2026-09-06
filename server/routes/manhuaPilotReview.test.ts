import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => ({
  authenticate: vi.fn(),
  charge: vi.fn<
    (...args: unknown[]) => Promise<{ cost: number; source: string }>
  >(async () => {
    throw new Error("本测试禁止扣费");
  }),
  refund: vi.fn(async () => ({
    refunded: true,
    creditsRefunded: 10,
    status: "refunded",
  })),
}));
vi.mock("../_core/sdk.js", () => ({
  sdk: { authenticateRequest: boundary.authenticate },
}));
vi.mock("../credits.js", () => ({
  getUserPlan: async () => "pro",
  deductCreditsAmount: boundary.charge,
  InsufficientCreditsError: class extends Error {},
}));
vi.mock("../services/openrouterHailuoVideo.js", () => ({
  isOpenRouterHailuoConfigured: () => true,
}));
vi.mock("../db.js", () => ({ getDb: async () => null }));
vi.mock("../services/paidJobLedger.js", () => ({
  registerActiveJob: async () => {},
  refundCreditsOnFailure: boundary.refund,
  refundMarkerFor: () => "test-refund-marker",
  canonicalRefundKey: () => "test-refund-key",
}));

let fixtureDir: string;
let handler: (typeof import("../../api/jobs"))["default"];
const scope = {
  projectVersion: "f".repeat(64),
  episodeIndex: 1,
  videoModel: "minimax-hailuo-3",
};
const submission = {
  projectVersion: scope.projectVersion,
  episodeIndex: 1,
  segmentIndex: 1,
  intent: "pilot" as const,
};

beforeAll(async () => {
  fixtureDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "manhua-review-route-test-")
  );
  vi.stubEnv("CANVAS_VIDEO_TASK_DIR", path.join(fixtureDir, "tasks"));
  vi.stubEnv("MANHUA_PILOT_REVIEW_DIR", path.join(fixtureDir, "reviews"));
  await fs.mkdir(path.join(fixtureDir, "tasks"), { recursive: true });
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("本测试禁止真实网络和付费上游");
    })
  );
  handler = (await import("../../api/jobs")).default;
});
afterAll(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  if (fixtureDir) await fs.rm(fixtureDir, { recursive: true, force: true });
});

async function request(
  op: string,
  method: "GET" | "POST",
  body: unknown = {},
  query: Record<string, unknown> = {}
) {
  const out = {
    status: 0,
    body: {} as Record<string, any>,
    headers: {} as Record<string, string>,
  };
  const res = {
    setHeader(key: string, value: string) {
      out.headers[key] = value;
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
  await handler(
    { method, query: { op, ...query }, body, headers: {} } as never,
    res as never
  );
  return out;
}

describe("真实 jobs 审批路由与本地持久记录（鉴权/支付/网络边界虚构）", () => {
  it("未登录不读审批，错误方法不能写审批", async () => {
    boundary.authenticate.mockRejectedValueOnce(new Error("test no session"));
    expect((await request("manhuaPilotStatus", "GET", {}, scope)).status).toBe(
      401
    );
    expect((await request("manhuaPilotReview", "GET")).status).toBe(405);
  });

  it("未批准长片由实际生成API在扣费前拒绝", async () => {
    boundary.authenticate.mockResolvedValue({ id: 71, role: "admin" });
    const result = await request("hailuo3Video", "POST", {
      prompt: "虚构测试镜头",
      duration: 15,
      episodeIndex: 1,
      manhuaPilot: { ...submission, intent: "full" },
    });
    expect(result.status).toBe(409);
    expect(result.body.error).toContain("请先审阅并批准");
    expect(boundary.charge).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("旧漫剧请求缺审批身份不能走普通画布旁路", async () => {
    boundary.authenticate.mockResolvedValue({ id: 71, role: "admin" });
    const result = await request("hailuo3Video", "POST", {
      prompt: "虚构测试镜头",
      duration: 15,
      episodeIndex: 1,
      clipIndex: 1,
    });
    expect(result.status).toBe(409);
    expect(boundary.charge).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("真实API从任务快照到生成、批准、刷新闭合，并拒绝其他账号和旧任务", async () => {
    boundary.authenticate.mockResolvedValue({ id: 71, role: "admin" });
    const service = await import("../services/manhuaPilotReview");
    const reserved = await service.prepareManhuaPilotSubmission({
      userId: 71,
      submissionRaw: submission,
      actualVideoModel: scope.videoModel,
      durationSec: 10,
    });
    if (reserved.kind !== "pilot") throw new Error("测试预留失败");
    await fs.mkdir(path.join(fixtureDir, "tasks"), { recursive: true });
    const now = new Date().toISOString();
    await fs.writeFile(
      path.join(fixtureDir, "tasks", `${reserved.taskId}.json`),
      JSON.stringify({
        taskId: reserved.taskId,
        userId: 71,
        status: "succeeded",
        creditsCharged: 0,
        engine: "hailuo-openrouter",
        prompt: "虚构测试镜头",
        label: "测试试片",
        aspectRatio: "9:16",
        duration: 10,
        generateAudio: true,
        createdAt: now,
        updatedAt: now,
        videoUrl: "https://test.invalid/approved-pilot.mp4",
        manhuaPilot: { ...submission, videoModel: scope.videoModel },
      })
    );
    const generated = await request("manhuaPilotStatus", "GET", {}, scope);
    expect(generated.headers["Cache-Control"]).toBe("private, no-store");
    expect(generated.body).toMatchObject({
      ok: true,
      review: { status: "generated", taskId: reserved.taskId },
    });
    boundary.authenticate.mockResolvedValue({ id: 72, role: "admin" });
    expect(
      (
        await request("manhuaPilotReview", "POST", {
          ...scope,
          taskId: reserved.taskId,
          decision: "approve",
        })
      ).status
    ).toBe(409);
    boundary.authenticate.mockResolvedValue({ id: 71, role: "admin" });
    expect(
      (
        await request("manhuaPilotReview", "POST", {
          ...scope,
          taskId: "test-old-task",
          decision: "approve",
        })
      ).status
    ).toBe(409);
    const approved = await request("manhuaPilotReview", "POST", {
      ...scope,
      taskId: reserved.taskId,
      decision: "approve",
    });
    expect(approved.status).toBe(200);
    expect(approved.body.review.status).toBe("approved");
    expect((await request("manhuaPilotStatus", "GET", {}, scope)).body).toEqual(
      approved.body
    );
    expect(boundary.charge).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("扣费回执不明进入人工核对，第二次点击不会再次扣费或提交", async () => {
    boundary.authenticate.mockResolvedValue({ id: 73, role: "admin" });
    const body = {
      prompt: "虚构测试镜头",
      duration: 10,
      episodeIndex: 1,
      manhuaPilot: submission,
    };
    const first = await request("hailuo3Video", "POST", body);
    expect(first.status).toBe(503);
    expect(boundary.charge).toHaveBeenCalledTimes(1);
    expect(
      (await request("manhuaPilotStatus", "GET", {}, scope)).body.review.status
    ).toBe("reconcile_manual");
    expect((await request("hailuo3Video", "POST", body)).status).toBe(409);
    expect(boundary.charge).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["missing", "running", "succeeded", "ledger_failed"] as const)(
    "建单异常 %s：只对明确未提交的失败退款",
    async scenario => {
      const userId = {
        missing: 81,
        running: 82,
        succeeded: 83,
        ledger_failed: 84,
      }[scenario];
      boundary.authenticate.mockResolvedValue({ id: userId, role: "admin" });
      boundary.charge.mockResolvedValue({ cost: 10, source: "personal" });
      boundary.refund.mockClear();
      const taskModule = await import("../services/canvasVideoTask");
      const create = vi
        .spyOn(taskModule, "createCanvasVideoTask")
        .mockImplementation(async input => {
          if (scenario !== "missing") {
            const now = new Date().toISOString();
            await fs.writeFile(
              path.join(fixtureDir, "tasks", `${input.taskId}.json`),
              JSON.stringify({
                ...input,
                createdAt: now,
                updatedAt: now,
                status: scenario === "ledger_failed" ? "failed" : scenario,
                ...(scenario === "running"
                  ? { openRouterJobId: "test-upstream-task" }
                  : {}),
                ...(scenario === "succeeded"
                  ? { videoUrl: "https://test.invalid/late-success.mp4" }
                  : {}),
              })
            );
          }
          throw new Error(
            scenario === "ledger_failed"
              ? "paid_job_ledger_register_failed"
              : "test create response lost"
          );
        });
      try {
        const result = await request("hailuo3Video", "POST", {
          prompt: "虚构测试镜头",
          duration: 10,
          episodeIndex: 1,
          manhuaPilot: submission,
        });
        expect(result.status).toBe(502);
        expect(boundary.refund).toHaveBeenCalledTimes(
          scenario === "ledger_failed" ? 1 : 0
        );
        const status = (await request("manhuaPilotStatus", "GET", {}, scope))
          .body.review.status;
        expect(status).toBe(
          scenario === "ledger_failed"
            ? "failed"
            : scenario === "succeeded"
              ? "generated"
              : "reconcile_manual"
        );
        expect(fetch).not.toHaveBeenCalled();
      } finally {
        create.mockRestore();
      }
    }
  );
});

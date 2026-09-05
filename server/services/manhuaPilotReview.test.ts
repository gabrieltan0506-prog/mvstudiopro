import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CanvasVideoTaskRecord } from "./canvasVideoTask";

let tempDir = "";
let taskDir = "";

const projectVersion = "a".repeat(64);
const pilotRaw = {
  projectVersion,
  episodeIndex: 2,
  segmentIndex: 1,
  intent: "pilot" as const,
};
const scope = {
  projectVersion,
  episodeIndex: 2,
  videoModel: "seedance-2.5",
};

beforeAll(async () => {
  tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "manhua-pilot-review-test-")
  );
  taskDir = path.join(tempDir, "tasks");
  process.env.CANVAS_VIDEO_TASK_DIR = taskDir;
  process.env.MANHUA_PILOT_REVIEW_DIR = path.join(tempDir, "reviews");
  await fs.mkdir(taskDir, { recursive: true });
});

afterAll(async () => {
  delete process.env.CANVAS_VIDEO_TASK_DIR;
  delete process.env.MANHUA_PILOT_REVIEW_DIR;
  await fs.rm(tempDir, { recursive: true, force: true });
});

async function writeTask(
  taskId: string,
  input: Partial<CanvasVideoTaskRecord> = {}
): Promise<CanvasVideoTaskRecord> {
  const now = new Date().toISOString();
  const task: CanvasVideoTaskRecord = {
    taskId,
    userId: 17,
    status: "succeeded",
    creditsCharged: 10,
    engine: "seedance25-evolink",
    label: "测试试片",
    prompt: "虚构测试提示词",
    aspectRatio: "9:16",
    duration: 10,
    generateAudio: true,
    videoUrl:
      "https://storage.googleapis.com/test-bucket/pilot.mp4?X-Goog-Signature=test",
    createdAt: now,
    updatedAt: now,
    manhuaPilot: { ...pilotRaw, videoModel: "seedance-2.5" },
    ...input,
  };
  await fs.writeFile(
    path.join(taskDir, `${taskId}.json`),
    JSON.stringify(task)
  );
  return task;
}

describe("manhuaPilotReview 服务端真相源", () => {
  it("并发首提只预留一个任务，后来的请求复用 submitting", async () => {
    const { prepareManhuaPilotSubmission } = await import(
      "./manhuaPilotReview"
    );
    const [a, b] = await Promise.all([
      prepareManhuaPilotSubmission({
        userId: 11,
        submissionRaw: pilotRaw,
        actualVideoModel: "wan-3.0",
        durationSec: 10,
      }),
      prepareManhuaPilotSubmission({
        userId: 11,
        submissionRaw: pilotRaw,
        actualVideoModel: "wan-3.0",
        durationSec: 10,
      }),
    ]);
    expect([a.kind, b.kind].sort()).toEqual(["pilot", "reuse"]);
    const ids = [a, b].map(item =>
      item.kind === "pilot"
        ? item.taskId
        : item.kind === "reuse"
          ? item.review.taskId
          : undefined
    );
    expect(ids[0]).toBe(ids[1]);
  });

  it("扣费或建任务失败会释放为 failed，下一次得到新任务号", async () => {
    const { markManhuaPilotReservationFailed, prepareManhuaPilotSubmission } =
      await import("./manhuaPilotReview");
    const first = await prepareManhuaPilotSubmission({
      userId: 12,
      submissionRaw: pilotRaw,
      actualVideoModel: "minimax-hailuo-3",
      durationSec: 10,
    });
    expect(first.kind).toBe("pilot");
    if (first.kind !== "pilot") throw new Error("预留失败");
    await markManhuaPilotReservationFailed({
      userId: 12,
      scope: first.scope,
      taskId: first.taskId,
      reason: "测试扣费失败",
    });
    const second = await prepareManhuaPilotSubmission({
      userId: 12,
      submissionRaw: pilotRaw,
      actualVideoModel: "minimax-hailuo-3",
      durationSec: 10,
    });
    expect(second.kind).toBe("pilot");
    if (second.kind === "pilot") expect(second.taskId).not.toBe(first.taskId);
  });

  it("只把当前本人、同项目同引擎的真实成功 10 秒任务变为 generated 并批准", async () => {
    const {
      getManhuaPilotReviewState,
      prepareManhuaPilotSubmission,
      reconcileManhuaPilotTask,
      reviewManhuaPilot,
    } = await import("./manhuaPilotReview");
    const reserved = await prepareManhuaPilotSubmission({
      userId: 17,
      submissionRaw: pilotRaw,
      actualVideoModel: "seedance-2.5",
      durationSec: 10,
    });
    expect(reserved.kind).toBe("pilot");
    if (reserved.kind !== "pilot") throw new Error("预留失败");
    const task = await writeTask(reserved.taskId);
    expect(await reconcileManhuaPilotTask(task)).toMatchObject({
      status: "generated",
      taskId: reserved.taskId,
      outputUrl: task.videoUrl,
    });
    const approved = await reviewManhuaPilot({
      userId: 17,
      decisionRaw: { ...scope, taskId: reserved.taskId, decision: "approve" },
    });
    expect(approved).toMatchObject({
      status: "approved",
      taskId: reserved.taskId,
    });
    expect(
      await reviewManhuaPilot({
        userId: 17,
        decisionRaw: { ...scope, taskId: reserved.taskId, decision: "approve" },
      })
    ).toEqual(approved);
    await expect(
      reviewManhuaPilot({
        userId: 17,
        decisionRaw: { ...scope, taskId: reserved.taskId, decision: "reject" },
      })
    ).rejects.toThrow("不能反向修改");
    expect(
      await getManhuaPilotReviewState({ userId: 17, scopeRaw: scope })
    ).toEqual(approved);

    const full = await prepareManhuaPilotSubmission({
      userId: 17,
      submissionRaw: { ...pilotRaw, segmentIndex: 4, intent: "full" },
      actualVideoModel: "seedance-2.5",
      durationSec: 30,
    });
    expect(full.kind).toBe("full");
  });

  it("任务身份不一致、非10秒或非当前任务时关闭式拒绝审批", async () => {
    const {
      prepareManhuaPilotSubmission,
      reconcileManhuaPilotTask,
      reviewManhuaPilot,
    } = await import("./manhuaPilotReview");
    const reserved = await prepareManhuaPilotSubmission({
      userId: 18,
      submissionRaw: pilotRaw,
      actualVideoModel: "seedance-2.5",
      durationSec: 10,
    });
    if (reserved.kind !== "pilot") throw new Error("预留失败");
    const wrong = await writeTask(reserved.taskId, {
      userId: 18,
      duration: 15,
    });
    expect(await reconcileManhuaPilotTask(wrong)).toMatchObject({
      status: "submitting",
    });
    await expect(
      reviewManhuaPilot({
        userId: 18,
        decisionRaw: { ...scope, taskId: reserved.taskId, decision: "approve" },
      })
    ).rejects.toThrow("尚未成功生成");
    await expect(
      reviewManhuaPilot({
        userId: 18,
        decisionRaw: {
          ...scope,
          taskId: "cv_pilot_other",
          decision: "approve",
        },
      })
    ).rejects.toThrow("试片已更新");
  });

  it("未批准的 full、错误段号和错误时长都在服务端拒绝", async () => {
    const { prepareManhuaPilotSubmission } = await import(
      "./manhuaPilotReview"
    );
    await expect(
      prepareManhuaPilotSubmission({
        userId: 19,
        submissionRaw: { ...pilotRaw, intent: "full" },
        actualVideoModel: "wan-3.0",
        durationSec: 30,
      })
    ).rejects.toThrow("请先审阅并批准");
    await expect(
      prepareManhuaPilotSubmission({
        userId: 20,
        submissionRaw: { ...pilotRaw, segmentIndex: 2 },
        actualVideoModel: "wan-3.0",
        durationSec: 10,
      })
    ).rejects.toThrow("第 1 段");
    await expect(
      prepareManhuaPilotSubmission({
        userId: 21,
        submissionRaw: pilotRaw,
        actualVideoModel: "wan-3.0",
        durationSec: 15,
      })
    ).rejects.toThrow("前 10 秒");
  });

  it("已有 pending 也不能让错误段号或错误时长冒充同一试片复用", async () => {
    const { prepareManhuaPilotSubmission } = await import(
      "./manhuaPilotReview"
    );
    await prepareManhuaPilotSubmission({
      userId: 22,
      submissionRaw: pilotRaw,
      actualVideoModel: "wan-3.0",
      durationSec: 10,
    });
    await expect(
      prepareManhuaPilotSubmission({
        userId: 22,
        submissionRaw: { ...pilotRaw, segmentIndex: 2 },
        actualVideoModel: "wan-3.0",
        durationSec: 10,
      })
    ).rejects.toThrow("第 1 段");
    await expect(
      prepareManhuaPilotSubmission({
        userId: 22,
        submissionRaw: pilotRaw,
        actualVideoModel: "wan-3.0",
        durationSec: 15,
      })
    ).rejects.toThrow("前 10 秒");
  });

  it("预留后长期找不到任务会进入人工核对态，记录损坏也不会被当成未开始覆盖", async () => {
    const { getManhuaPilotReviewState, prepareManhuaPilotSubmission } =
      await import("./manhuaPilotReview");
    const reserved = await prepareManhuaPilotSubmission({
      userId: 23,
      submissionRaw: pilotRaw,
      actualVideoModel: "minimax-hailuo-3",
      durationSec: 10,
    });
    expect(reserved.kind).toBe("pilot");
    const reviewDir = String(process.env.MANHUA_PILOT_REVIEW_DIR);
    const files = (await fs.readdir(reviewDir)).filter(name =>
      name.endsWith(".json")
    );
    const recordFile = (
      await Promise.all(
        files.map(async name => ({
          name,
          text: await fs.readFile(path.join(reviewDir, name), "utf8"),
        }))
      )
    ).find(entry => entry.text.includes('"userId": 23'))?.name;
    expect(recordFile).toBeTruthy();
    const recordPath = path.join(reviewDir, recordFile!);
    const record = JSON.parse(await fs.readFile(recordPath, "utf8"));
    record.state.updatedAt = new Date(Date.now() - 5 * 60_000).toISOString();
    await fs.writeFile(recordPath, JSON.stringify(record));
    const manual = await getManhuaPilotReviewState({
      userId: 23,
      scopeRaw: { ...scope, videoModel: "minimax-hailuo-3" },
    });
    expect(manual).toMatchObject({
      status: "reconcile_manual",
      taskId: reserved.kind === "pilot" ? reserved.taskId : "",
    });
    await expect(
      prepareManhuaPilotSubmission({
        userId: 23,
        submissionRaw: pilotRaw,
        actualVideoModel: "minimax-hailuo-3",
        durationSec: 10,
      })
    ).rejects.toThrow("需要核对");

    await fs.writeFile(recordPath, "{broken");
    await expect(
      getManhuaPilotReviewState({
        userId: 23,
        scopeRaw: { ...scope, videoModel: "minimax-hailuo-3" },
      })
    ).rejects.toThrow("读取失败");
    expect(await fs.readFile(recordPath, "utf8")).toBe("{broken");
  });

  it("同项目不同用户、不同引擎互不继承批准", async () => {
    const { getManhuaPilotReviewState } = await import("./manhuaPilotReview");
    expect(
      await getManhuaPilotReviewState({ userId: 999, scopeRaw: scope })
    ).toEqual({
      status: "not_started",
    });
    expect(
      await getManhuaPilotReviewState({
        userId: 17,
        scopeRaw: { ...scope, videoModel: "wan-3.0" },
      })
    ).toEqual({ status: "not_started" });
  });

  it("两个等待者只会串行回收已确认死亡的旧锁，不会删除新 owner 的锁", async () => {
    const { getManhuaPilotReviewState, prepareManhuaPilotSubmission } =
      await import("./manhuaPilotReview");
    await prepareManhuaPilotSubmission({
      userId: 24,
      submissionRaw: pilotRaw,
      actualVideoModel: "seedance-2.5",
      durationSec: 10,
    });
    const reviewDir = String(process.env.MANHUA_PILOT_REVIEW_DIR);
    const recordFile = (
      await Promise.all(
        (await fs.readdir(reviewDir))
          .filter(name => name.endsWith(".json"))
          .map(async name => ({
            name,
            text: await fs.readFile(path.join(reviewDir, name), "utf8"),
          }))
      )
    ).find(entry => entry.text.includes('"userId": 24'))?.name;
    expect(recordFile).toBeTruthy();
    const lockFile = path.join(reviewDir, `${recordFile}.lock`);
    await fs.writeFile(lockFile, JSON.stringify({ pid: 2_147_483_647 }));
    const old = new Date(Date.now() - 60_000);
    await fs.utimes(lockFile, old, old);

    const [first, second] = await Promise.all([
      getManhuaPilotReviewState({ userId: 24, scopeRaw: scope }),
      getManhuaPilotReviewState({ userId: 24, scopeRaw: scope }),
    ]);
    expect(first.status).toBe("submitting");
    expect(second.status).toBe("submitting");
    await expect(fs.stat(`${lockFile}.recovery`)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});

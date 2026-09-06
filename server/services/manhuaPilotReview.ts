import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  assertManhuaPilotSubmissionAllowed,
  manhuaPilotDecisionSchema,
  manhuaPilotReviewStateSchema,
  manhuaPilotScopeKey,
  manhuaPilotScopeSchema,
  manhuaPilotSubmissionSchema,
  type ManhuaPilotDecision,
  type ManhuaPilotReviewState,
  type ManhuaPilotScope,
  type ManhuaPilotSubmission,
} from "../../shared/manhuaPilotReview.js";
import type { CanvasVideoTaskRecord } from "./canvasVideoTask.js";

const FORMAT = "mv-manhua-pilot-review-server-v1" as const;

type PilotHistoryEntry = {
  taskId: string;
  status: Exclude<ManhuaPilotReviewState["status"], "not_started">;
  createdAt: string;
  updatedAt: string;
  outputUrl?: string;
  failureReason?: string;
};

type PilotRegistryRecord = {
  format: typeof FORMAT;
  userId: number;
  scope: ManhuaPilotScope;
  state: ManhuaPilotReviewState;
  history: PilotHistoryEntry[];
};

export type ManhuaPilotPrepareResult =
  | { kind: "none" }
  | { kind: "full"; scope: ManhuaPilotScope; submission: ManhuaPilotSubmission }
  | {
      kind: "pilot";
      scope: ManhuaPilotScope;
      submission: ManhuaPilotSubmission;
      taskId: string;
      idempotencyKey: string;
    }
  | { kind: "reuse"; scope: ManhuaPilotScope; review: ManhuaPilotReviewState };

function rootDir(): string {
  const configured = String(process.env.MANHUA_PILOT_REVIEW_DIR || "").trim();
  if (configured) return configured;
  const taskRoot = String(
    process.env.CANVAS_VIDEO_TASK_DIR || "/data/growth/canvas-video"
  ).trim();
  return path.join(taskRoot, "manhua-pilot-review");
}

async function ensureRoot(): Promise<string> {
  const primary = rootDir();
  await fs.mkdir(primary, { recursive: true });
  return primary;
}

function recordHash(userId: number, scope: ManhuaPilotScope): string {
  return createHash("sha256")
    .update(manhuaPilotScopeKey(userId, scope))
    .digest("hex");
}

async function recordPath(
  userId: number,
  scope: ManhuaPilotScope
): Promise<string> {
  return path.join(await ensureRoot(), `${recordHash(userId, scope)}.json`);
}

function parseRecord(
  raw: unknown,
  userId: number,
  scope: ManhuaPilotScope
): PilotRegistryRecord | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Partial<PilotRegistryRecord>;
  if (value.format !== FORMAT || value.userId !== userId) return null;
  const parsedScope = manhuaPilotScopeSchema.safeParse(value.scope);
  const parsedState = manhuaPilotReviewStateSchema.safeParse(value.state);
  if (!parsedScope.success || !parsedState.success) return null;
  if (
    manhuaPilotScopeKey(userId, parsedScope.data) !==
    manhuaPilotScopeKey(userId, scope)
  )
    return null;
  if (!Array.isArray(value.history)) return null;
  const allowedStatuses = new Set([
    "submitting",
    "generated",
    "approved",
    "rejected",
    "failed",
    "reconcile_manual",
  ]);
  const history: PilotHistoryEntry[] = [];
  for (const rawEntry of value.history) {
    if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry))
      return null;
    const entry = rawEntry as Partial<PilotHistoryEntry>;
    if (
      typeof entry.taskId !== "string" ||
      !entry.taskId.trim() ||
      typeof entry.status !== "string" ||
      !allowedStatuses.has(entry.status) ||
      typeof entry.createdAt !== "string" ||
      !entry.createdAt ||
      typeof entry.updatedAt !== "string" ||
      !entry.updatedAt
    ) {
      return null;
    }
    if (
      entry.outputUrl != null &&
      !/^https:\/\//i.test(String(entry.outputUrl))
    )
      return null;
    history.push(entry as PilotHistoryEntry);
  }
  return {
    format: FORMAT,
    userId,
    scope: parsedScope.data,
    state: parsedState.data,
    history,
  };
}

async function readRecord(
  userId: number,
  scope: ManhuaPilotScope
): Promise<PilotRegistryRecord | null> {
  try {
    const raw = JSON.parse(
      await fs.readFile(await recordPath(userId, scope), "utf8")
    );
    const parsed = parseRecord(raw, userId, scope);
    if (!parsed) throw new Error("试片审核记录损坏，已停止生成以保护已有结果");
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    if (error instanceof Error && error.message.includes("审核记录损坏"))
      throw error;
    throw new Error("试片审核状态读取失败，已停止生成以保护已有结果");
  }
}

async function writeRecord(record: PilotRegistryRecord): Promise<void> {
  const file = await recordPath(record.userId, record.scope);
  const tmp = `${file}.tmp.${process.pid}.${randomUUID()}`;
  await fs.writeFile(tmp, JSON.stringify(record, null, 2), { mode: 0o600 });
  await fs.rename(tmp, file);
}

async function recoverDeadScopeLock(file: string): Promise<void> {
  const recoveryFile = `${file}.recovery`;
  let recoveryHandle: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    recoveryHandle = await fs.open(recoveryFile, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return;
    throw error;
  }
  try {
    await recoveryHandle.writeFile(
      JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })
    );
    // 必须在拿到回收锁后重新读取：另一个等待者可能已回收旧锁并创建了新锁。
    const stat = await fs.stat(file);
    if (Date.now() - stat.mtimeMs <= 30_000) return;
    const lock = JSON.parse(await fs.readFile(file, "utf8")) as {
      pid?: unknown;
    };
    const ownerPid = Number(lock.pid);
    if (!Number.isInteger(ownerPid) || ownerPid <= 0) return;
    let ownerDefinitelyDead = false;
    try {
      process.kill(ownerPid, 0);
    } catch (error) {
      ownerDefinitelyDead = (error as NodeJS.ErrnoException).code === "ESRCH";
    }
    if (ownerDefinitelyDead) await fs.unlink(file);
  } catch {
    // 无法证明旧 owner 已死亡时不删目标锁；遗留回收锁也不主动偷取。
  } finally {
    await recoveryHandle.close().catch(() => {});
    await fs.unlink(recoveryFile).catch(() => {});
  }
}

async function withScopeLock<T>(
  userId: number,
  scope: ManhuaPilotScope,
  run: () => Promise<T>
): Promise<T> {
  const file = `${await recordPath(userId, scope)}.lock`;
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const candidate = await fs.open(file, "wx", 0o600);
      try {
        await candidate.writeFile(
          JSON.stringify({
            pid: process.pid,
            createdAt: new Date().toISOString(),
          })
        );
      } catch (error) {
        await candidate.close().catch(() => {});
        await fs.unlink(file).catch(() => {});
        throw error;
      }
      handle = candidate;
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (attempt % 20 === 19) {
        await recoverDeadScopeLock(file).catch(() => {});
      }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
  if (!handle) throw new Error("试片审核状态正忙，请稍后重试");
  try {
    return await run();
  } finally {
    await handle.close().catch(() => {});
    await fs.unlink(file).catch(() => {});
  }
}

function scopeFor(
  userId: number,
  submissionRaw: unknown,
  actualVideoModel: string
): { submission: ManhuaPilotSubmission; scope: ManhuaPilotScope } {
  if (!Number.isInteger(userId) || userId <= 0)
    throw new Error("请先登录后再生成成片");
  const parsed = manhuaPilotSubmissionSchema.safeParse(submissionRaw);
  if (!parsed.success) throw new Error("试片项目身份无效，请刷新后重试");
  const scope = manhuaPilotScopeSchema.parse({
    projectVersion: parsed.data.projectVersion,
    episodeIndex: parsed.data.episodeIndex,
    videoModel: actualVideoModel,
  });
  return { submission: parsed.data, scope };
}

function publicState(
  record: PilotRegistryRecord | null
): ManhuaPilotReviewState {
  return record?.state || { status: "not_started" };
}

function taskMatchesPilot(
  task: CanvasVideoTaskRecord,
  userId: number,
  scope: ManhuaPilotScope
): boolean {
  const pilot = task.manhuaPilot;
  return Boolean(
    task.userId === userId &&
      pilot?.intent === "pilot" &&
      pilot.segmentIndex === 1 &&
      pilot.episodeIndex === scope.episodeIndex &&
      pilot.projectVersion === scope.projectVersion &&
      pilot.videoModel === scope.videoModel &&
      task.duration === 10
  );
}

function historyWithState(
  record: PilotRegistryRecord,
  state: ManhuaPilotReviewState,
  failureReason?: string
): PilotHistoryEntry[] {
  if (!state.taskId) return record.history;
  const now = state.updatedAt || new Date().toISOString();
  const previous = record.history.find(entry => entry.taskId === state.taskId);
  const next: PilotHistoryEntry = {
    taskId: state.taskId,
    status: state.status === "not_started" ? "failed" : state.status,
    createdAt: previous?.createdAt || now,
    updatedAt: now,
    ...(state.outputUrl ? { outputUrl: state.outputUrl } : {}),
    ...(failureReason ? { failureReason: failureReason.slice(0, 280) } : {}),
  };
  return [
    ...record.history.filter(entry => entry.taskId !== state.taskId),
    next,
  ];
}

async function reconcileRecordWithTask(
  record: PilotRegistryRecord,
  task: CanvasVideoTaskRecord | null
): Promise<PilotRegistryRecord> {
  const currentTaskId = record.state.taskId;
  if (!currentTaskId || !task || task.taskId !== currentTaskId) return record;
  if (!taskMatchesPilot(task, record.userId, record.scope)) return record;
  if (record.state.status === "approved" || record.state.status === "rejected")
    return record;
  const updatedAt = task.updatedAt || new Date().toISOString();
  let nextState: ManhuaPilotReviewState = record.state;
  if (
    task.status === "succeeded" &&
    /^https:\/\//i.test(String(task.videoUrl || ""))
  ) {
    nextState = {
      status: "generated",
      taskId: task.taskId,
      outputUrl: task.videoUrl!,
      updatedAt,
    };
  } else if (task.status === "reconcile_manual") {
    nextState = { status: "reconcile_manual", taskId: task.taskId, updatedAt };
  } else if (task.status === "failed") {
    nextState = { status: "failed", taskId: task.taskId, updatedAt };
  } else if (record.state.status === "submitting") {
    nextState = { status: "submitting", taskId: task.taskId, updatedAt };
  }
  if (JSON.stringify(nextState) === JSON.stringify(record.state)) return record;
  const next = {
    ...record,
    state: nextState,
    history: historyWithState(record, nextState, task.error),
  };
  await writeRecord(next);
  return next;
}

async function refreshUnderLock(
  userId: number,
  scope: ManhuaPilotScope
): Promise<PilotRegistryRecord | null> {
  const current = await readRecord(userId, scope);
  if (!current?.state.taskId) return current;
  const { peekCanvasVideoTask } = await import("./canvasVideoTask.js");
  const task = await peekCanvasVideoTask(current.state.taskId, userId);
  if (!task && current.state.status === "submitting") {
    const reservedAt = Date.parse(String(current.state.updatedAt || ""));
    const graceMs = Math.min(
      10 * 60_000,
      Math.max(
        60_000,
        Number(process.env.MANHUA_PILOT_RESERVATION_GRACE_MS) || 2 * 60_000
      )
    );
    if (Number.isFinite(reservedAt) && Date.now() - reservedAt >= graceMs) {
      const state: ManhuaPilotReviewState = {
        status: "reconcile_manual",
        taskId: current.state.taskId,
        updatedAt: new Date().toISOString(),
      };
      const next = {
        ...current,
        state,
        history: historyWithState(
          current,
          state,
          "试片任务预留后未找到持久任务，禁止自动重烧"
        ),
      };
      await writeRecord(next);
      return next;
    }
  }
  return reconcileRecordWithTask(current, task);
}

/** 扣费前唯一服务端闸门；试片预留 taskId 与幂等键，pending/未知状态一律复用。 */
export async function prepareManhuaPilotSubmission(input: {
  userId: number;
  submissionRaw: unknown;
  actualVideoModel: string;
  durationSec: number;
}): Promise<ManhuaPilotPrepareResult> {
  if (input.submissionRaw == null) return { kind: "none" };
  const { submission, scope } = scopeFor(
    input.userId,
    input.submissionRaw,
    input.actualVideoModel
  );
  if (submission.intent === "pilot") {
    assertManhuaPilotSubmissionAllowed(
      { status: "not_started" },
      submission,
      input.durationSec
    );
  }
  return withScopeLock(input.userId, scope, async () => {
    const current = await refreshUnderLock(input.userId, scope);
    const state = publicState(current);
    if (submission.intent === "pilot" && state.status === "submitting") {
      return { kind: "reuse", scope, review: state };
    }
    if (submission.intent === "pilot" && state.status === "generated") {
      return { kind: "reuse", scope, review: state };
    }
    assertManhuaPilotSubmissionAllowed(state, submission, input.durationSec);
    if (submission.intent === "full")
      return { kind: "full", scope, submission };

    const taskId = `cv_pilot_${Date.now().toString(36)}_${randomUUID().slice(0, 12)}`;
    const now = new Date().toISOString();
    const nextState: ManhuaPilotReviewState = {
      status: "submitting",
      taskId,
      updatedAt: now,
    };
    const base: PilotRegistryRecord = current || {
      format: FORMAT,
      userId: input.userId,
      scope,
      state: { status: "not_started" },
      history: [],
    };
    const next: PilotRegistryRecord = {
      ...base,
      state: nextState,
      history: historyWithState(base, nextState),
    };
    await writeRecord(next);
    const idempotencyKey = `manhua-pilot:${recordHash(input.userId, scope)}:${taskId}`;
    return { kind: "pilot", scope, submission, taskId, idempotencyKey };
  });
}

export async function markManhuaPilotReservationFailed(input: {
  userId: number;
  scope: ManhuaPilotScope;
  taskId: string;
  reason: string;
}): Promise<ManhuaPilotReviewState> {
  return withScopeLock(input.userId, input.scope, async () => {
    const current = await readRecord(input.userId, input.scope);
    if (
      !current ||
      current.state.taskId !== input.taskId ||
      current.state.status !== "submitting"
    ) {
      return publicState(current);
    }
    const state: ManhuaPilotReviewState = {
      status: "failed",
      taskId: input.taskId,
      updatedAt: new Date().toISOString(),
    };
    await writeRecord({
      ...current,
      state,
      history: historyWithState(current, state, input.reason),
    });
    return state;
  });
}

/** 扣费/任务是否已提交无法确定时锁进人工核对态，绝不释放成可重烧。 */
export async function markManhuaPilotReservationReconcileManual(input: {
  userId: number;
  scope: ManhuaPilotScope;
  taskId: string;
  reason: string;
}): Promise<ManhuaPilotReviewState> {
  return withScopeLock(input.userId, input.scope, async () => {
    const current = await readRecord(input.userId, input.scope);
    if (!current || current.state.taskId !== input.taskId)
      return publicState(current);
    if (current.state.status !== "submitting") return current.state;
    const state: ManhuaPilotReviewState = {
      status: "reconcile_manual",
      taskId: input.taskId,
      updatedAt: new Date().toISOString(),
    };
    await writeRecord({
      ...current,
      state,
      history: historyWithState(current, state, input.reason),
    });
    return state;
  });
}

/** CanvasVideo 状态查询后同步 registry；只认当前 task 且身份完全一致。 */
export async function reconcileManhuaPilotTask(
  task: CanvasVideoTaskRecord
): Promise<ManhuaPilotReviewState | null> {
  const pilot = task.manhuaPilot;
  if (!pilot || pilot.intent !== "pilot") return null;
  const scope = manhuaPilotScopeSchema.parse({
    projectVersion: pilot.projectVersion,
    episodeIndex: pilot.episodeIndex,
    videoModel: pilot.videoModel,
  });
  return withScopeLock(task.userId, scope, async () => {
    const current = await readRecord(task.userId, scope);
    if (!current || current.state.taskId !== task.taskId)
      return publicState(current);
    return publicState(await reconcileRecordWithTask(current, task));
  });
}

export async function getManhuaPilotReviewState(input: {
  userId: number;
  scopeRaw: unknown;
}): Promise<ManhuaPilotReviewState> {
  const scope = manhuaPilotScopeSchema.parse(input.scopeRaw);
  return withScopeLock(input.userId, scope, async () =>
    publicState(await refreshUnderLock(input.userId, scope))
  );
}

export async function reviewManhuaPilot(input: {
  userId: number;
  decisionRaw: unknown;
}): Promise<ManhuaPilotReviewState> {
  const decision: ManhuaPilotDecision = manhuaPilotDecisionSchema.parse(
    input.decisionRaw
  );
  const scope = manhuaPilotScopeSchema.parse({
    projectVersion: decision.projectVersion,
    episodeIndex: decision.episodeIndex,
    videoModel: decision.videoModel,
  });
  return withScopeLock(input.userId, scope, async () => {
    let current = await refreshUnderLock(input.userId, scope);
    if (!current || current.state.taskId !== decision.taskId) {
      throw new Error("试片已更新，请刷新后审阅当前版本");
    }
    const desiredStatus =
      decision.decision === "approve" ? "approved" : "rejected";
    if (current.state.status === desiredStatus) return current.state;
    if (
      current.state.status === "approved" ||
      current.state.status === "rejected"
    ) {
      throw new Error("当前试片已经完成终审，不能反向修改决定");
    }
    if (current.state.status !== "generated" || !current.state.outputUrl) {
      throw new Error("试片尚未成功生成，暂不能提交审核");
    }
    const { peekCanvasVideoTask } = await import("./canvasVideoTask.js");
    const task = await peekCanvasVideoTask(decision.taskId, input.userId);
    if (
      !task ||
      task.status !== "succeeded" ||
      !task.videoUrl ||
      !taskMatchesPilot(task, input.userId, scope)
    ) {
      throw new Error("试片任务身份或成片结果校验失败");
    }
    const nextState: ManhuaPilotReviewState = {
      status: desiredStatus,
      taskId: task.taskId,
      outputUrl: task.videoUrl,
      updatedAt: new Date().toISOString(),
    };
    current = {
      ...current,
      state: nextState,
      history: historyWithState(current, nextState),
    };
    await writeRecord(current);
    return nextState;
  });
}

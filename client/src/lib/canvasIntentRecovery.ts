/**
 * D（0915）刷新恢复的纯逻辑（R1 审查 1464-05 抽出来，便于单测）。
 *
 * 恢复只针对**从持久化读回来**的意图：有意图、没任务号、状态在 submitted / unverified /
 * acknowledged。本会话自己正在驱动的意图**不在此列**——包装层刚把它标成 submitted、
 * POST 还在路上，服务端还没占位；这时去问 canvasIntentStatus 只会拿到 404，
 * 若据此把意图判成 settled，就把一次在途提交的恢复线索抹掉了（刷新后再也接不回任务）。
 * 在途意图的 202 / 断网各自由 runner（resolvePendingCanvasIntentTaskId）与失败回调处理。
 *
 * 每个 intentId 每次挂载最多问一次：503 / 瞬态保持「核实中」，下次挂载再问。
 */

export type CanvasIntentRecoveryBlock = {
  id: string;
  videoIntentId?: string;
  videoIntentStatus?: "pending_submit" | "submitted" | "acknowledged" | "unverified" | "settled";
  videoTaskId?: string;
};

export type CanvasIntentRecoveryCandidate = { blockId: string; intentId: string };

export function selectCanvasIntentRecoveryCandidates(
  blocks: readonly CanvasIntentRecoveryBlock[],
  opts: {
    /** 本会话自己创建/推进过的意图：不恢复，由 runner 负责 */
    sessionIntentIds: ReadonlySet<string>;
    /** 本次挂载已经问过的意图：不重复问 */
    queriedIntentIds: ReadonlySet<string>;
  },
): CanvasIntentRecoveryCandidate[] {
  const out: CanvasIntentRecoveryCandidate[] = [];
  for (const b of blocks) {
    const intentId = String(b.videoIntentId || "").trim();
    if (!intentId || b.videoTaskId) continue;
    if (
      b.videoIntentStatus !== "submitted" &&
      b.videoIntentStatus !== "unverified" &&
      b.videoIntentStatus !== "acknowledged"
    ) {
      continue;
    }
    if (opts.sessionIntentIds.has(intentId) || opts.queriedIntentIds.has(intentId)) continue;
    out.push({ blockId: b.id, intentId });
  }
  return out;
}

export type CanvasIntentStatusReply = {
  ok?: boolean;
  pending?: boolean;
  code?: string;
  taskId?: string;
  status?: string;
  engine?: string;
};

export type CanvasIntentRecoveryResolution =
  /** 服务端说没有这次记录：意图作废，不重发 */
  | { kind: "settle" }
  /** 服务端已建单：接上任务号，交给任务轮询 */
  | {
      kind: "attach";
      patch: {
        videoTaskId: string;
        videoTaskEngine?: string;
        videoTaskStatus: "queued" | "running" | "succeeded" | "failed";
        videoIntentStatus: "acknowledged";
      };
    }
  /** 仍在核实（占位中 / 已扣费未建单 / 503 / 非法回包）：不动 */
  | { kind: "keep" };

export function resolveCanvasIntentStatusReply(
  httpStatus: number,
  httpOk: boolean,
  json: CanvasIntentStatusReply,
): CanvasIntentRecoveryResolution {
  if (httpStatus === 404 && json.code === "intent_not_found") return { kind: "settle" };
  if (!httpOk || !json.ok || json.pending !== false || !json.taskId) return { kind: "keep" };
  const status = json.status;
  return {
    kind: "attach",
    patch: {
      videoTaskId: String(json.taskId),
      videoTaskEngine: json.engine,
      videoTaskStatus:
        status === "succeeded" || status === "failed" || status === "queued" ? status : "running",
      videoIntentStatus: "acknowledged",
    },
  };
}

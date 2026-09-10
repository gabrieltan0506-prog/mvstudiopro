/**
 * 配乐 running 任务的纯恢复判定。
 *
 * repository/startup 负责读写数据库；本模块只决定下一步，方便把最危险的语义用
 * 单测钉住：有上游 task ID 才能安全续轮询；没有 ID 时不知道 POST 是否已成功，
 * 必须转人工核对，绝不能自动重提；GCS 终态已经在手时直接收敛成功。
 *
 * 退款是独立于提交的一段状态（审查 P1）：上游明确拒单＝钱该退，但退款本身可能因为数据库抖动失败。
 * 失败时留 `refund_pending` 并把实际扣费凭据一起落盘，下次处理只做幂等补退，不再扣费、不再 POST。
 */

/** 补退最多自动重试几轮；用尽转人工。runner 与启动恢复共用同一个上限 */
export const MANHUA_BGM_REFUND_RETRY_MAX = 4;

/** 补退前的退避（毫秒）：默认 30 秒，避免数据库故障时队列热循环；回归可置 0 */
export function manhuaBgmRefundRetryDelayMs(): number {
  const raw = Number(process.env.MANHUA_BGM_REFUND_RETRY_DELAY_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : 30_000;
}

export type ManhuaBgmRecoveryDecision =
  | {
      kind: "complete";
      terminalOutput: Record<string, unknown>;
    }
  | {
      kind: "resume";
      upstreamTaskId: string;
      startedAtMs?: number;
    }
  | {
      kind: "refund_pending";
      /** 上游明确拒单时记下的实际扣费凭据；只用于幂等补退 */
      deduct: ManhuaBgmPersistedDeduct;
      refundKey: string;
      reason: string;
    }
  | {
      kind: "reconcile_manual";
      reason: string;
    };

/**
 * 落盘的扣费凭据：只存结算需要的字段，不含任何密钥或鉴权信息。
 * 审查 P1：团队扣费退款必须带 teamId / teamMemberId，缺了真实退款函数会抛 team_refund_metadata_missing，
 * 所以类型按来源分叉——团队来源没有这两个字段就不是一份可用凭据。
 */
export type ManhuaBgmPersistedDeduct = {
  success: true;
  cost: number;
  remainingBalance: number;
} & ({ source: "personal" } | { source: "team"; teamId: number; teamMemberId: number });

export function readManhuaBgmPersistedDeduct(value: unknown): ManhuaBgmPersistedDeduct | null {
  const row = asRecord(value);
  if (!row || row.success !== true) return null;
  const cost = Number(row.cost);
  const source = String(row.source || "").trim();
  if (!Number.isSafeInteger(cost) || cost <= 0) return null;
  if (source !== "personal" && source !== "team") return null;
  const balance = Number(row.remainingBalance);
  // 余额只作日志用；读不出来记 -1，不因为它把整份凭据判废
  const remainingBalance = Number.isFinite(balance) ? balance : -1;
  if (source === "team") {
    const teamId = Number(row.teamId);
    const teamMemberId = Number(row.teamMemberId);
    if (!Number.isSafeInteger(teamId) || teamId <= 0) return null;
    if (!Number.isSafeInteger(teamMemberId) || teamMemberId <= 0) return null;
    return { success: true, cost, source, remainingBalance, teamId, teamMemberId };
  }
  return { success: true, cost, source, remainingBalance };
}

/**
 * 只重试同一份数据库检查点写入，不重新执行建单、轮询、下载或转存。
 * 用注入写函数保持可测，也避免 repository 与恢复判据形成循环依赖。
 */
export async function persistManhuaBgmCheckpointWithRetry(
  write: () => Promise<void>,
  options: { attempts?: number; delayMs?: number } = {}
): Promise<void> {
  const attempts = Math.max(1, Math.min(6, Math.floor(options.attempts ?? 4)));
  const delayMs = Math.max(
    0,
    Math.min(5_000, Math.floor(options.delayMs ?? 250))
  );
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await write();
      return;
    } catch (error) {
      lastError = error;
      if (attempt < attempts && delayMs > 0) {
        await new Promise<void>(resolve =>
          setTimeout(resolve, delayMs * attempt)
        );
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("配乐任务检查点保存失败");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** 终态至少要有上游回执和一条 GCS 变体，临时 CDN/签名链不能冒充完成。 */
export function isPersistedManhuaBgmTerminalOutput(value: unknown): boolean {
  const output = asRecord(value);
  if (!output || !String(output.upstreamTaskId || "").trim()) return false;
  if (!Array.isArray(output.variants) || output.variants.length === 0)
    return false;
  return output.variants.every(variant => {
    const row = asRecord(variant);
    return Boolean(
      row &&
        Number.isInteger(row.index) &&
        String(row.gcsUri || "").startsWith("gs://")
    );
  });
}

export function planInterruptedManhuaBgmRecovery(
  rawOutput: unknown
): ManhuaBgmRecoveryDecision {
  const output = asRecord(rawOutput) ?? {};
  const terminalOutput = asRecord(output.terminalOutput);

  if (
    output.bgmStage === "result_persistence_pending" &&
    terminalOutput &&
    isPersistedManhuaBgmTerminalOutput(terminalOutput)
  ) {
    return { kind: "complete", terminalOutput };
  }

  // 兼容终态 payload 已写进 output、但 status 写入前实例退出的窗口。
  if (isPersistedManhuaBgmTerminalOutput(output)) {
    return { kind: "complete", terminalOutput: output };
  }

  // 退款没做完：只补退，不重新扣费、不再向上游 POST（审查 P1）
  // 凭据不全（尤其团队缺 teamId/teamMemberId）宁可转人工，也不发一笔退不掉的补退
  if (output.bgmStage === "refund_pending") {
    const deduct = readManhuaBgmPersistedDeduct(output.bgmDeduct);
    const refundKey = String(output.bgmRefundKey || "").trim();
    if (deduct && refundKey) {
      return {
        kind: "refund_pending",
        deduct,
        refundKey,
        reason: "配乐建单被上游拒绝，正在补退积分",
      };
    }
    return { kind: "reconcile_manual", reason: "配乐建单被上游拒绝，退款凭据不全，请人工核对" };
  }

  const upstreamTaskId = String(output.upstreamTaskId || "").trim();
  if (upstreamTaskId) {
    const startedAtMs = Number(output.startedAtMs);
    return {
      kind: "resume",
      upstreamTaskId,
      ...(Number.isFinite(startedAtMs) && startedAtMs > 0
        ? { startedAtMs }
        : {}),
    };
  }

  return {
    kind: "reconcile_manual",
    reason: "上游任务状态待核对，未自动重新提交",
  };
}

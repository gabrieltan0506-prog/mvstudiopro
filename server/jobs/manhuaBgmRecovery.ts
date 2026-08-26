/**
 * 配乐 running 任务的纯恢复判定。
 *
 * repository/startup 负责读写数据库；本模块只决定下一步，方便把最危险的语义用
 * 单测钉住：有上游 task ID 才能安全续轮询；没有 ID 时不知道 POST 是否已成功，
 * 必须转人工核对，绝不能自动重提；GCS 终态已经在手时直接收敛成功。
 */

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
      kind: "reconcile_manual";
      reason: string;
    };

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

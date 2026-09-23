import { touchKnowledgeCardDistillActivity } from "./knowledgeCardDistillActivity.js";

/**
 * 0923 用户令：模型服务异常（整条通道链都失败）在代码里隔 30 秒重试 3 次，不直接报到前端。
 * 只包「整条链」这一层：链内换通道照旧，链整体失败才等 30 秒从头再跑。
 */
export const KNOWLEDGE_CARD_CHAIN_RETRY_ROUNDS = 3;
export const KNOWLEDGE_CARD_CHAIN_RETRY_DELAY_MS = 30_000;

/** 等待间隔按调用时读：测试置 0，生产默认 30 秒 */
function chainRetryDelayMs(): number {
  const raw = Number(process.env.KNOWLEDGE_CARD_CHAIN_RETRY_DELAY_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : KNOWLEDGE_CARD_CHAIN_RETRY_DELAY_MS;
}

export function waitAbortable(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal!.reason instanceof Error ? signal!.reason : new Error("已取消"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function retryKnowledgeCardChain<T>(
  run: () => Promise<T>,
  opts: {
    label: string;
    abortSignal?: AbortSignal;
    /** 返回 false＝确定性失败（取消/安全拒答/额度/配置），重试也一样，立刻上抛 */
    isRetryable: (err: unknown) => boolean;
  },
): Promise<T> {
  for (let round = 0; ; round++) {
    try {
      return await run();
    } catch (err) {
      if (opts.abortSignal?.aborted || !opts.isRetryable(err) || round >= KNOWLEDGE_CARD_CHAIN_RETRY_ROUNDS) throw err;
      const delay = chainRetryDelayMs();
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[${opts.label}] 整条通道链失败，${Math.round(delay / 1000)} 秒后第 ${round + 1}/${KNOWLEDGE_CARD_CHAIN_RETRY_ROUNDS} 次重试：${msg.slice(0, 160)}`,
      );
      // 等待期间也算活着：派生/读档任务按「连续无进度」判死，别在等重试时被判卡死
      touchKnowledgeCardDistillActivity();
      await waitAbortable(delay, opts.abortSignal);
      touchKnowledgeCardDistillActivity();
    }
  }
}

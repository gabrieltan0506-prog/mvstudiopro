import { execFile } from "node:child_process";

/** 可取消等待；底层不支持取消的纯计算允许结束，但结果不再被消费。 */
export async function awaitKnowledgeCardAbort<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  let onAbort: () => void = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
  try { return await Promise.race([work, cancelled]); }
  finally { signal.removeEventListener("abort", onAbort); }
}

/** 子进程取消后等待 close，再允许调用方清理临时文件；保留原始取消原因。 */
export async function execKnowledgeCardFile(command: string, args: string[], options: { maxBuffer: number; signal?: AbortSignal }): Promise<{ stdout: string; stderr: string }> {
  options.signal?.throwIfAborted();
  let closed: Promise<void> = Promise.resolve();
  const result = new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = execFile(command, args, options, (error, stdout, stderr) => {
      if (error) reject(error);
      else resolve({ stdout, stderr });
    });
    closed = new Promise<void>(resolve => child.once("close", () => resolve()));
  });
  try { return await result; }
  catch (error) { options.signal?.throwIfAborted(); throw error; }
  finally { await closed; }
}

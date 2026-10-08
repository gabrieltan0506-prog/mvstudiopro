import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { heavyWorkerSplitEnabled, resolveJobWorkerRole } from "./workerRole";

export type HeavyMediaContext = {
  userId: string;
  executionId: string;
  parentJobId?: string;
};
const context = new AsyncLocalStorage<HeavyMediaContext>();
// While preparation is paused, metadata callbacks use its existing worker slot.
// This avoids a child queue waiting behind the parent that is waiting for that callback.
export const heavyMediaCallbackCommand = new AsyncLocalStorage<
  (
    request: import("./heavyMediaQueue").HeavyMetadataRequest
  ) => Promise<import("./heavyMediaQueue").HeavyCommandResult>
>();
export const heavyMediaSignal = new AsyncLocalStorage<AbortSignal>();
export function withHeavyMediaContext<T>(
  value: HeavyMediaContext,
  work: () => T
): T {
  return context.run(value, work);
}
export function withHeavyMediaRequest<T>(
  userId: string | number,
  work: () => T
): T {
  return withHeavyMediaContext(
    { userId: String(userId), executionId: randomUUID() },
    work
  );
}
export function requireHeavyMediaContext(): HeavyMediaContext {
  const value = context.getStore();
  if (!value || !/^[1-9][0-9]*$/.test(value.userId))
    throw new Error("媒体处理缺少已验证的任务归属");
  return value;
}
export function shouldDispatchHeavyMedia(): boolean {
  return heavyWorkerSplitEnabled() && resolveJobWorkerRole() === "app";
}

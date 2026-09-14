import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { executePrune } from "../../scripts/vercel-prune-preview-deployments.mjs";

type RunResult = Awaited<ReturnType<typeof executePrune>>;
type DailyState = {
  day: string;
  status: "running" | "completed" | "partial" | "deferred" | "failed";
  updatedAt: string;
  nextAttemptAt?: number;
  result?: RunResult;
  reason?: string;
  receipt?: string;
};

// 原定每日 UTC 02:40，即北京时间 10:40；日期键也按北京时间生成。
export function scheduledDay(now: number): string | null {
  const local = new Date(now + 8 * 60 * 60_000);
  if (local.getUTCHours() * 60 + local.getUTCMinutes() < 10 * 60 + 40) return null;
  return local.toISOString().slice(0, 10);
}

export function createPreviewPruneTick({
  root = "/data/vercel-prune-audit",
  now = Date.now,
  run = executePrune,
  log = (state: DailyState) => console.info("[vercel.prune]", JSON.stringify(state)),
}: {
  root?: string;
  now?: () => number;
  run?: typeof executePrune;
  log?: (state: DailyState) => void;
} = {}) {
  let busy = false;
  let stopped = false;
  let controller: AbortController | undefined;
  const write = (state: DailyState) => {
    const file = join(root, `daily-${state.day}.json`);
    const temp = `${file}.${randomUUID()}.tmp`;
    writeFileSync(temp, JSON.stringify(state), { mode: 0o600, flush: true });
    renameSync(temp, file);
    log(state);
  };
  return {
    stop() { stopped = true; controller?.abort(); },
    async tick() {
      if (stopped || busy) return;
      const day = scheduledDay(now());
      if (!day) return;
      busy = true;
      try {
        mkdirSync(root, { recursive: true });
        let previous: DailyState | undefined;
        try { previous = JSON.parse(readFileSync(join(root, `daily-${day}.json`), "utf8")); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        if (previous && (previous.day !== day || !["running", "completed", "partial", "deferred", "failed"].includes(previous.status))) throw Error("每日清理状态格式无效");
        // 已执行或结果未决的当天批次不重放；只有零 DELETE 的在途部署延期可重试。
        if (previous && (previous.status !== "deferred" || !previous.nextAttemptAt || previous.nextAttemptAt > now())) return;
        write({ day, status: "running", updatedAt: new Date(now()).toISOString() });
        controller = new AbortController();
        try {
          const result = await run({ apply: true, signal: controller.signal, root });
          write({ day, status: result.remaining ? "partial" : "completed", updatedAt: new Date(now()).toISOString(), result });
        } catch (error) {
          const failure = error as { code?: string; attemptedDelete?: boolean; receipt?: string };
          const deferred = failure.code === "PRUNE_DEFERRED" && failure.attemptedDelete === false;
          // 不持久化任意异常文本或上游响应，避免环境/请求内容进入日志。
          write({ day, status: deferred ? "deferred" : "failed", updatedAt: new Date(now()).toISOString(),
            reason: deferred ? "active-deployment" : stopped ? "shutdown" : "prune-failed-check-receipt",
            ...(deferred ? { nextAttemptAt: now() + 15 * 60_000 } : {}),
            ...(failure.receipt ? { receipt: failure.receipt } : {}) });
        }
      } finally { busy = false; controller = undefined; }
    },
  };
}

let stopScheduler: (() => void) | undefined;
export function startVercelPreviewScheduler() {
  if (stopScheduler || process.env.FLY_APP_NAME !== "mvstudiopro" || process.env.FLY_PROCESS_GROUP !== "app" || !process.env.FLY_MACHINE_ID) return;
  const job = createPreviewPruneTick();
  const tick = () => void job.tick().catch(() => console.error("[vercel.prune] 调度状态无法读写，请检查 /data/vercel-prune-audit"));
  const timer = setInterval(tick, 60_000);
  timer.unref();
  stopScheduler = () => { clearInterval(timer); job.stop(); };
  console.info("[vercel.prune] 每日北京时间10:40；7天预览/1天失败保留；启动补查当天状态");
  tick();
}

export function stopVercelPreviewScheduler() { stopScheduler?.(); }

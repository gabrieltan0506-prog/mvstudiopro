/**
 * 同源架构：探针打当前 Origin 的 `/api/health`（与前端同主机或同反代目标），
 * 避免在后端不健康时对长链路 tRPC 堆请求。
 */

const FLY_HEALTH_TIMEOUT_MS = 120_000;
const FLY_HEALTH_POLL_MS = 1_000;
const FLY_HEALTH_ASSUME_OK_MS = 1_500;

const inflightWaitByOrigin = new Map<string, Promise<void>>();
const healthyUntilByOrigin = new Map<string, number>();

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function trpcBaseUrlToOrigin(): string {
  return typeof window !== "undefined" ? window.location.origin : "";
}

async function probeApiHealth(origin: string): Promise<boolean> {
  try {
    const r = await fetch(`${origin}/api/health`, {
      method: "GET",
      cache: "no-store",
      credentials: "omit",
    });
    if (!r.ok) return false;
    const text = await r.text();
    return text.trim() === "ok";
  } catch {
    return false;
  }
}

async function waitUntilHealthyLoop(origin: string): Promise<void> {
  const t0 = Date.now();
  let loggedWait = false;
  while (Date.now() - t0 < FLY_HEALTH_TIMEOUT_MS) {
    if (await probeApiHealth(origin)) {
      if (loggedWait) {
        console.info(`[FlyHealth] ${origin}/api/health is healthy again`);
      }
      return;
    }
    if (!loggedWait) {
      console.warn(`[FlyHealth] ${origin}/api/health not ready; blocking tRPC until healthy…`);
      loggedWait = true;
    }
    await delay(FLY_HEALTH_POLL_MS);
  }
  throw new Error(
    `[FlyHealth] Timed out after ${FLY_HEALTH_TIMEOUT_MS}ms waiting for ${origin}/api/health`,
  );
}

export async function ensureFlyAppReady(origin: string): Promise<void> {
  const until = healthyUntilByOrigin.get(origin) ?? 0;
  if (Date.now() < until) return;

  if (await probeApiHealth(origin)) {
    healthyUntilByOrigin.set(origin, Date.now() + FLY_HEALTH_ASSUME_OK_MS);
    return;
  }

  healthyUntilByOrigin.delete(origin);

  let wait = inflightWaitByOrigin.get(origin);
  if (!wait) {
    wait = waitUntilHealthyLoop(origin).finally(() => {
      inflightWaitByOrigin.delete(origin);
    });
    inflightWaitByOrigin.set(origin, wait);
  }
  await wait;
  healthyUntilByOrigin.set(origin, Date.now() + FLY_HEALTH_ASSUME_OK_MS);
}

export async function withFlyHealthGate<T>(origin: string, run: () => Promise<T>): Promise<T> {
  await ensureFlyAppReady(origin);
  return run();
}

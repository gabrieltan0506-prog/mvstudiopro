/**
 * Before browser → Fly direct tRPC (`mvAnalysisLongTrpcUrl`), probe `/api/health` until `ok`
 * so we don't pile requests onto a machine that Fly health checks have marked unhealthy.
 */

const FLY_HEALTH_TIMEOUT_MS = 120_000;
const FLY_HEALTH_POLL_MS = 1_000;
/** After a successful probe, skip re-checking for this many ms (parallel Fly-direct calls share one gate). */
const FLY_HEALTH_ASSUME_OK_MS = 1_500;

const inflightWaitByOrigin = new Map<string, Promise<void>>();
const healthyUntilByOrigin = new Map<string, number>();

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function trpcBaseUrlToOrigin(trpcBaseUrl: string): string {
  return new URL(trpcBaseUrl).origin;
}

async function probeFlyHealth(flyOrigin: string): Promise<boolean> {
  try {
    const r = await fetch(`${flyOrigin}/api/health`, {
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

async function waitUntilFlyHealthyLoop(flyOrigin: string): Promise<void> {
  const t0 = Date.now();
  let loggedWait = false;
  while (Date.now() - t0 < FLY_HEALTH_TIMEOUT_MS) {
    if (await probeFlyHealth(flyOrigin)) {
      if (loggedWait) {
        console.info(`[FlyHealth] ${flyOrigin} is healthy again`);
      }
      return;
    }
    if (!loggedWait) {
      console.warn(`[FlyHealth] ${flyOrigin}/api/health not ready; blocking Fly-direct tRPC until healthy…`);
      loggedWait = true;
    }
    await delay(FLY_HEALTH_POLL_MS);
  }
  throw new Error(
    `[FlyHealth] Timed out after ${FLY_HEALTH_TIMEOUT_MS}ms waiting for ${flyOrigin}/api/health`,
  );
}

/**
 * Resolves when Fly `/api/health` returns plain `ok`. Concurrent requests share one poll loop per origin.
 */
export async function ensureFlyAppReady(flyOrigin: string): Promise<void> {
  const until = healthyUntilByOrigin.get(flyOrigin) ?? 0;
  if (Date.now() < until) return;

  if (await probeFlyHealth(flyOrigin)) {
    healthyUntilByOrigin.set(flyOrigin, Date.now() + FLY_HEALTH_ASSUME_OK_MS);
    return;
  }

  healthyUntilByOrigin.delete(flyOrigin);

  let wait = inflightWaitByOrigin.get(flyOrigin);
  if (!wait) {
    wait = waitUntilFlyHealthyLoop(flyOrigin).finally(() => {
      inflightWaitByOrigin.delete(flyOrigin);
    });
    inflightWaitByOrigin.set(flyOrigin, wait);
  }
  await wait;
  healthyUntilByOrigin.set(flyOrigin, Date.now() + FLY_HEALTH_ASSUME_OK_MS);
}

export async function withFlyHealthGate<T>(flyOrigin: string, run: () => Promise<T>): Promise<T> {
  await ensureFlyAppReady(flyOrigin);
  return run();
}

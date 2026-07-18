/**
 * 长请求前的健康探针：短轮询后**软放行**，不再 120s 硬挡导致「清单根本没发出去」。
 * www 直连 api 子域时，同时试同源 `/api/health`（Vercel rewrite → Fly），降低 CORS/冷启动误判。
 */

const FLY_HEALTH_SOFT_ATTEMPTS = 4;
const FLY_HEALTH_POLL_MS = 700;
const FLY_HEALTH_PROBE_TIMEOUT_MS = 4_500;
const FLY_HEALTH_ASSUME_OK_MS = 2_500;

const inflightWaitByOrigin = new Map<string, Promise<void>>();
const healthyUntilByOrigin = new Map<string, number>();

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function trpcBaseUrlToOrigin(): string {
  return typeof window !== "undefined" ? window.location.origin : "";
}

function probeOrigins(preferred: string): string[] {
  const out: string[] = [];
  const push = (o: string) => {
    const v = String(o || "").trim().replace(/\/+$/, "");
    if (v && !out.includes(v)) out.push(v);
  };
  push(preferred);
  if (typeof window !== "undefined") push(window.location.origin);
  return out;
}

async function probeApiHealth(origin: string): Promise<boolean> {
  if (!origin) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FLY_HEALTH_PROBE_TIMEOUT_MS);
  try {
    const r = await fetch(`${origin}/api/health`, {
      method: "GET",
      cache: "no-store",
      credentials: "omit",
      signal: controller.signal,
    });
    if (!r.ok) return false;
    const text = await r.text();
    return text.trim() === "ok";
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function softWaitUntilHealthy(preferredOrigin: string): Promise<void> {
  const origins = probeOrigins(preferredOrigin);
  for (let attempt = 0; attempt < FLY_HEALTH_SOFT_ATTEMPTS; attempt++) {
    for (const origin of origins) {
      if (await probeApiHealth(origin)) {
        if (attempt > 0) {
          console.info(`[FlyHealth] ${origin}/api/health ok (attempt ${attempt + 1})`);
        }
        return;
      }
    }
    if (attempt === 0) {
      console.warn(
        `[FlyHealth] health not ready on ${origins.join(" | ")}; soft-polling then proceed…`,
      );
    }
    await delay(FLY_HEALTH_POLL_MS);
  }
  console.warn(
    `[FlyHealth] soft-pass after ${FLY_HEALTH_SOFT_ATTEMPTS} probes; sending request anyway (${preferredOrigin})`,
  );
}

export async function ensureFlyAppReady(origin: string): Promise<void> {
  const key = String(origin || "").trim() || trpcBaseUrlToOrigin();
  if (!key) return;

  const until = healthyUntilByOrigin.get(key) ?? 0;
  if (Date.now() < until) return;

  for (const o of probeOrigins(key)) {
    if (await probeApiHealth(o)) {
      healthyUntilByOrigin.set(key, Date.now() + FLY_HEALTH_ASSUME_OK_MS);
      return;
    }
  }

  healthyUntilByOrigin.delete(key);

  let wait = inflightWaitByOrigin.get(key);
  if (!wait) {
    wait = softWaitUntilHealthy(key).finally(() => {
      inflightWaitByOrigin.delete(key);
    });
    inflightWaitByOrigin.set(key, wait);
  }
  await wait;
  healthyUntilByOrigin.set(key, Date.now() + FLY_HEALTH_ASSUME_OK_MS);
}

export async function withFlyHealthGate<T>(origin: string, run: () => Promise<T>): Promise<T> {
  await ensureFlyAppReady(origin);
  return run();
}

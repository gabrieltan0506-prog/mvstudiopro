/**
 * 0917 PR-B：Fly Machines API 最小客户端（只做 list/start/stop）。
 *
 * 用途：rig 进程组（Blender 绑骨/白模）常驻 4 核 8G 是纯成本，用户目前无进账。
 * 有 Blender 任务排队时由 app 机把 rig 机拉起来，rig 空闲若干分钟后自己停机。
 *
 * 纪律（写死在这里，别放宽）：
 * - **不改 fly.toml**，只用 Machines API 启停已存在的 rig 机（fly.toml 仍声明 rig 进程组，
 *   保证部署时机器存在、镜像跟着更新；这里只负责它平时是 started 还是 stopped）。
 * - 只碰 `fly_process_group === "rig"` 的机器，永远不碰 app 机。
 * - 没有 FLY_API_TOKEN（密钥只在 Fly env，本机/CI 都没有）时整条链路静默降级为 no-op，
 *   行为与 PR-B 之前完全一致：rig 机维持现状，任务照跑。
 */
export type FlyMachineState =
  | "created" | "starting" | "started" | "stopping" | "stopped"
  | "suspending" | "suspended" | "replacing" | "destroying" | "destroyed" | string;

export type FlyMachine = {
  id: string;
  name?: string;
  state: FlyMachineState;
  processGroup: string;
};

export type FlyMachinesConfig = { appName: string; token: string; baseUrl: string };

const DEFAULT_BASE_URL = "https://api.machines.dev/v1";

export function resolveFlyMachinesConfig(env: NodeJS.ProcessEnv = process.env): FlyMachinesConfig | null {
  const token = String(env.FLY_API_TOKEN || "").trim();
  const appName = String(env.FLY_APP_NAME || "").trim();
  if (!token || !appName) return null;
  const baseUrl = String(env.FLY_MACHINES_API_URL || "").trim() || DEFAULT_BASE_URL;
  return { appName, token, baseUrl: baseUrl.replace(/\/+$/, "") };
}

/** 本机自己的机器 ID（Fly 运行时自动注入）；本机开发时为空。 */
export function resolveSelfMachineId(env: NodeJS.ProcessEnv = process.env): string {
  return String(env.FLY_MACHINE_ID || "").trim();
}

export class FlyMachinesError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "FlyMachinesError";
    this.status = status;
  }
}

async function callFly(
  cfg: FlyMachinesConfig,
  path: string,
  init: { method: "GET" | "POST"; timeoutMs?: number },
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1_000, init.timeoutMs ?? 15_000));
  try {
    const res = await fetch(`${cfg.baseUrl}${path}`, {
      method: init.method,
      headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new FlyMachinesError(`Fly Machines ${init.method} ${path} ${res.status}: ${text.slice(0, 300)}`, res.status);
    if (!text) return null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return null;
    }
  } finally {
    clearTimeout(timer);
  }
}

function normalizeMachine(raw: unknown): FlyMachine | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const id = String(row.id || "").trim();
  if (!id) return null;
  const config = (row.config && typeof row.config === "object" ? (row.config as Record<string, unknown>) : {}) as Record<string, unknown>;
  const metadata = (config.metadata && typeof config.metadata === "object" ? (config.metadata as Record<string, unknown>) : {}) as Record<string, unknown>;
  return {
    id,
    name: typeof row.name === "string" ? row.name : undefined,
    state: String(row.state || "").trim(),
    processGroup: String(metadata.fly_process_group || "").trim(),
  };
}

export async function listFlyMachines(cfg: FlyMachinesConfig): Promise<FlyMachine[]> {
  const body = await callFly(cfg, `/apps/${encodeURIComponent(cfg.appName)}/machines`, { method: "GET" });
  if (!Array.isArray(body)) return [];
  return body.map(normalizeMachine).filter((m): m is FlyMachine => m !== null);
}

export async function listRigMachines(cfg: FlyMachinesConfig): Promise<FlyMachine[]> {
  return (await listFlyMachines(cfg)).filter((m) => m.processGroup === "rig");
}

export async function startFlyMachine(cfg: FlyMachinesConfig, machineId: string): Promise<void> {
  await callFly(cfg, `/apps/${encodeURIComponent(cfg.appName)}/machines/${encodeURIComponent(machineId)}/start`, { method: "POST", timeoutMs: 30_000 });
}

export async function stopFlyMachine(cfg: FlyMachinesConfig, machineId: string): Promise<void> {
  await callFly(cfg, `/apps/${encodeURIComponent(cfg.appName)}/machines/${encodeURIComponent(machineId)}/stop`, { method: "POST", timeoutMs: 30_000 });
}

/** 停机的机器才需要拉起；starting/started 不重复发命令。 */
export function needsStart(state: FlyMachineState): boolean {
  return state === "stopped" || state === "suspended" || state === "created";
}

/**
 * 维护模式（Maintenance Mode）— 部署前的手动闸门
 *
 * ── 为什么存在 ───────────────────────────────────────────────────────────────
 *  上帝视角研报 / Agent 场景（platform_ip_matrix / competitor_radar / VIP）
 *  / 平台数据分析 等付费任务一次启动会烧掉数美元的 Google Deep Research /
 *  Vertex 算力。在准备 fly deploy / 紧急回滚 / DB 切换的时间窗口里，我们必须
 *  能**只用一个 flag 文件**，让前端「启动新任务」的入口立刻 503，避免新任务
 *  在错误时机被扣费扣算力。
 *
 *  设计要点：
 *   1. **唯一真理**：/data/maintenance.flag JSON 文件存在 ⇒ 维护模式开启
 *   2. **fail-open**：读 flag 任何 IO 异常（permission/磁盘故障）都默认放行 —
 *      绝不能因为读不到 flag 就把所有生产流量都 503
 *   3. **正在跑的任务不受影响**：只在新任务的 launch mutation 入口处拦
 *   4. **不退现金、不碰支付**：本模块不参与积分账本，只是「拦不拦」的开关
 *   5. **持久卷存储**：fly machine 重启后维护模式仍然生效
 */

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { TRPCError } from "@trpc/server";

// ── flag 文件位置 ────────────────────────────────────────────────────────────
// 主路径：fly 持久卷 /data/maintenance.flag。
// 本地 / CI 环境可通过 MAINTENANCE_FLAG_PATH 覆盖到 tmpdir，方便单元测试。
const PRIMARY_FLAG_PATH =
  process.env.MAINTENANCE_FLAG_PATH || "/data/maintenance.flag";

let resolvedFlagPath: string | null = null;
let warnedFallback = false;

async function getFlagPath(): Promise<string> {
  if (resolvedFlagPath) return resolvedFlagPath;
  // 探测主路径所在目录是否可写；不可写则降级到 os.tmpdir()。
  const dir = path.dirname(PRIMARY_FLAG_PATH);
  try {
    await fs.mkdir(dir, { recursive: true });
    // 试写一个探针确认目录可写
    const probe = path.join(dir, ".maintenance-write-probe");
    await fs.writeFile(probe, String(Date.now()));
    await fs.unlink(probe).catch(() => {});
    resolvedFlagPath = PRIMARY_FLAG_PATH;
    return resolvedFlagPath;
  } catch (e: any) {
    const fallback = path.join(os.tmpdir(), "mvstudiopro-maintenance.flag");
    if (!warnedFallback) {
      console.warn(
        `[maintenanceMode] ⚠️  primary path ${PRIMARY_FLAG_PATH} not writable (${e?.message}); ` +
          `falling back to ${fallback}. **维护模式状态将不会跨进程重启留存** — ` +
          `仅在本地开发 / CI 环境可接受。生产部署必须挂载 /data 持久卷。`,
      );
      warnedFallback = true;
    }
    await fs.mkdir(path.dirname(fallback), { recursive: true });
    resolvedFlagPath = fallback;
    return resolvedFlagPath;
  }
}

// ── 状态结构 ─────────────────────────────────────────────────────────────────

export interface MaintenanceState {
  /** 是否处于维护模式。flag 文件不存在或读取异常时一律为 false（fail-open）。 */
  enabled: boolean;
  /** 由谁开启（admin 邮箱 / userId）。仅 enabled=true 时有意义。 */
  enabledBy?: string;
  /** 开启时记录的可选业务说明，比如「DB 切换 · 预计 10 分钟」。 */
  reason?: string;
  /** 开启时的 ISO 时间戳。 */
  enabledAt?: string;
}

interface FlagFileShape {
  enabled: true;
  enabledAt: string;
  enabledBy?: string;
  reason?: string;
}

// ── 读取状态（fail-open） ───────────────────────────────────────────────────

/**
 * 读 flag 返回当前维护状态。**任何 IO 异常**（permission / 磁盘满 / JSON 损坏）
 * 都退化成 `enabled=false`，绝不允许因为读不到 flag 就把生产流量全部 503。
 */
export async function getMaintenanceState(): Promise<MaintenanceState> {
  let flagPath: string;
  try {
    flagPath = await getFlagPath();
  } catch {
    return { enabled: false };
  }
  let raw: string;
  try {
    raw = await fs.readFile(flagPath, "utf-8");
  } catch (e: any) {
    // 文件不存在（ENOENT）才是正常情况，其他错误（EACCES / EIO）打 warn 但仍 fail-open
    if (e?.code !== "ENOENT") {
      console.warn(
        `[maintenanceMode] flag read error code=${e?.code} msg=${e?.message} → fail-open (enabled=false)`,
      );
    }
    return { enabled: false };
  }
  if (!raw.trim()) return { enabled: false };
  try {
    const parsed = JSON.parse(raw) as FlagFileShape;
    if (!parsed || parsed.enabled !== true) return { enabled: false };
    return {
      enabled: true,
      enabledAt: parsed.enabledAt,
      enabledBy: parsed.enabledBy,
      reason: parsed.reason,
    };
  } catch (e: any) {
    console.warn(
      `[maintenanceMode] flag JSON parse failed: ${e?.message} → fail-open (enabled=false)`,
    );
    return { enabled: false };
  }
}

// ── 写入 / 关闭 ──────────────────────────────────────────────────────────────

/**
 * 开启维护模式。supervisor 面板 / curl admin endpoint 用。
 * - by：审计字段，建议传 `admin:${email|userId}`
 * - reason：可选业务说明
 *
 * 严令：本函数**不**触碰积分账本 / 支付网关。仅写一份 JSON 标记文件。
 */
export async function enableMaintenance(
  by: string,
  reason?: string,
): Promise<MaintenanceState> {
  const flagPath = await getFlagPath();
  const payload: FlagFileShape = {
    enabled: true,
    enabledAt: new Date().toISOString(),
    enabledBy: by,
    ...(reason ? { reason } : {}),
  };
  // 原子写：先写 .tmp 再 rename，避免读到半文件
  const tmp = `${flagPath}.tmp.${process.pid}.${Date.now()}`;
  await fs.writeFile(tmp, JSON.stringify(payload, null, 2));
  await fs.rename(tmp, flagPath);
  console.warn(
    `[maintenanceMode] 🚧 维护模式已开启 by=${by} reason="${reason ?? ""}"`,
  );
  return {
    enabled: true,
    enabledAt: payload.enabledAt,
    enabledBy: payload.enabledBy,
    reason: payload.reason,
  };
}

/**
 * 关闭维护模式（删除 flag 文件）。重复调用幂等 no-op。
 */
export async function disableMaintenance(by: string): Promise<MaintenanceState> {
  const flagPath = await getFlagPath();
  try {
    await fs.unlink(flagPath);
    console.warn(`[maintenanceMode] ✅ 维护模式已关闭 by=${by}`);
  } catch (e: any) {
    if (e?.code !== "ENOENT") {
      console.warn(`[maintenanceMode] flag unlink failed code=${e?.code} msg=${e?.message}`);
    }
  }
  return { enabled: false };
}

// ── 拦截器：付费任务的 launch mutation 必须在主体逻辑第一行调 ─────────────

/**
 * 在维护模式开启时抛 SERVICE_UNAVAILABLE，拦住新付费任务启动。
 * 已经在跑的任务不受影响（不会被反向取消）。
 *
 * 用法：在每个付费任务的 launch mutation 主体逻辑**第一行**调用：
 *   await assertMaintenanceOff("上帝视角研报");
 *
 * @param taskLabel 仅用于日志 / 错误信息，不影响判定结果
 */
export async function assertMaintenanceOff(taskLabel?: string): Promise<void> {
  const state = await getMaintenanceState();
  if (!state.enabled) return;
  const reasonLine = state.reason ? `（${state.reason}）` : "";
  console.warn(
    `[maintenanceMode] 🚫 拦截 task=${taskLabel ?? "unknown"} ` +
      `enabledBy=${state.enabledBy ?? "?"} reason="${state.reason ?? ""}"`,
  );
  throw new TRPCError({
    code: "SERVICE_UNAVAILABLE",
    message: `系统正在升级维护${reasonLine}，预计 10 分钟内恢复，请稍后再启动任务`,
  });
}

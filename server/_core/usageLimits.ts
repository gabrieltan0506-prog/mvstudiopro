/**
 * 入口用量闸门：每分钟限流 + 每日上限（按用户 / IP / 会话）+ 全站每日总量。
 *
 * 用于「会花钱」或「会写数据」的入口（调模型、渲染、发邮件、写存储）。
 * - 数值写成常量，可用 env 覆盖：`USAGE_LIMIT_<NAME>_PER_MIN`、`USAGE_LIMIT_<NAME>_PER_DAY`、`USAGE_LIMIT_<NAME>_GLOBAL_PER_DAY`
 *   （NAME 为 spec.name 大写、非字母数字换成下划线；设 0 表示该维度不限）。
 * - 计数在本进程内存（固定窗口：分钟窗 + 北京时间自然日）。**局限**：多台机器各算各的，实际上限 ≈ 数值 × 机器数；
 *   进程重启清零。当前 Fly 主站单机，够用；扩机时换持久层（实现 UsageCounterStore 接口即可，见 setUsageCounterStore）。
 * - 先查全部维度、都通过才统一记数，被拒的请求不占额度。
 */
import { TRPCError } from "@trpc/server";

export type UsageLimitSpec = {
  /** 入口名（日志、env 覆盖、计数键前缀）。 */
  name: string;
  /** 每个主体（用户 / IP / 会话）每分钟最多次数；0 = 不限。 */
  perMinute: number;
  /** 每个主体每个自然日（北京时间）最多次数；0 = 不限。 */
  perDay: number;
  /** 全站每日总量（所有主体合计）；0 / 缺省 = 不限。 */
  globalPerDay?: number;
};

export type UsageLimitDecision =
  | { ok: true }
  | { ok: false; reason: "per_minute" | "per_day" | "global_per_day"; retryAfterSec: number; message: string };

/** 计数存储；缺省为进程内存。 */
export interface UsageCounterStore {
  get(key: string, now: number): number;
  incr(key: string, resetAt: number, now: number): void;
}

const MAX_KEYS = 50_000;

class MemoryUsageCounterStore implements UsageCounterStore {
  private readonly map = new Map<string, { count: number; resetAt: number }>();
  get(key: string, now: number): number {
    const hit = this.map.get(key);
    if (!hit) return 0;
    if (hit.resetAt <= now) {
      this.map.delete(key);
      return 0;
    }
    return hit.count;
  }
  incr(key: string, resetAt: number, now: number): void {
    const hit = this.map.get(key);
    if (hit && hit.resetAt > now) {
      hit.count += 1;
      return;
    }
    this.map.delete(key);
    // 内存上界：超过上限先淘汰最早写入的键（Map 保持插入顺序）
    while (this.map.size >= MAX_KEYS) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
    this.map.set(key, { count: 1, resetAt });
  }
  prune(now: number): void {
    this.map.forEach((value, key) => {
      if (value.resetAt <= now) this.map.delete(key);
    });
  }
  clear(): void {
    this.map.clear();
  }
}

const memoryStore = new MemoryUsageCounterStore();
let store: UsageCounterStore = memoryStore;

const pruneTimer = setInterval(() => memoryStore.prune(Date.now()), 5 * 60_000);
(pruneTimer as { unref?: () => void }).unref?.();

/** 换持久层（多机部署时）。 */
export function setUsageCounterStore(next: UsageCounterStore | null): void {
  store = next ?? memoryStore;
}

/** 仅测试用：清空内存计数。 */
export function resetUsageLimitsForTest(): void {
  memoryStore.clear();
  store = memoryStore;
}

const BEIJING_OFFSET_MS = 8 * 60 * 60_000;

function dayWindow(now: number): { id: string; resetAt: number } {
  const local = now + BEIJING_OFFSET_MS;
  const dayStart = Math.floor(local / 86_400_000) * 86_400_000;
  return { id: new Date(dayStart).toISOString().slice(0, 10), resetAt: dayStart + 86_400_000 - BEIJING_OFFSET_MS };
}

function minuteWindow(now: number): { id: number; resetAt: number } {
  const start = Math.floor(now / 60_000) * 60_000;
  return { id: start, resetAt: start + 60_000 };
}

function envKey(name: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

function envNumber(raw: string | undefined, fallback: number): number {
  if (raw == null || String(raw).trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

/** 常量 + env 覆盖后的实际数值。 */
export function resolveUsageLimit(spec: UsageLimitSpec, env: NodeJS.ProcessEnv = process.env): Required<UsageLimitSpec> {
  const key = envKey(spec.name);
  return {
    name: spec.name,
    perMinute: envNumber(env[`USAGE_LIMIT_${key}_PER_MIN`], spec.perMinute),
    perDay: envNumber(env[`USAGE_LIMIT_${key}_PER_DAY`], spec.perDay),
    globalPerDay: envNumber(env[`USAGE_LIMIT_${key}_GLOBAL_PER_DAY`], spec.globalPerDay ?? 0),
  };
}

/**
 * 记一次用量；任一维度超限即拒绝且不记数。
 * subjects：本次请求的主体键（如 `u:7`、`ip:1.2.3.4`、`s:<会话>`），每个主体各自计数，任一超限即拒。
 */
export function consumeUsage(spec: UsageLimitSpec, subjects: string[], now = Date.now()): UsageLimitDecision {
  const limit = resolveUsageLimit(spec);
  const minute = minuteWindow(now);
  const day = dayWindow(now);
  const uniq = Array.from(new Set(subjects.filter(Boolean)));
  const pending: Array<{ key: string; resetAt: number }> = [];

  if (limit.globalPerDay > 0) {
    const key = `usage:${limit.name}:global:${day.id}`;
    if (store.get(key, now) >= limit.globalPerDay) {
      return deny("global_per_day", Math.ceil((day.resetAt - now) / 1000));
    }
    pending.push({ key, resetAt: day.resetAt });
  }
  for (const subject of uniq) {
    if (limit.perMinute > 0) {
      const key = `usage:${limit.name}:${subject}:m:${minute.id}`;
      if (store.get(key, now) >= limit.perMinute) return deny("per_minute", Math.ceil((minute.resetAt - now) / 1000));
      pending.push({ key, resetAt: minute.resetAt });
    }
    if (limit.perDay > 0) {
      const key = `usage:${limit.name}:${subject}:d:${day.id}`;
      if (store.get(key, now) >= limit.perDay) return deny("per_day", Math.ceil((day.resetAt - now) / 1000));
      pending.push({ key, resetAt: day.resetAt });
    }
  }
  for (const item of pending) store.incr(item.key, item.resetAt, now);
  return { ok: true };
}

function deny(reason: "per_minute" | "per_day" | "global_per_day", retryAfterSec: number): UsageLimitDecision {
  const message =
    reason === "per_minute"
      ? "操作太频繁，请稍后再试"
      : reason === "per_day"
        ? "今日使用次数已达上限，请明天再试"
        : "今日服务额度已用完，请明天再试";
  return { ok: false, reason, retryAfterSec: Math.max(1, retryAfterSec), message };
}

type RequestLike = {
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string | null };
};

/** 客户端 IP：Express 已设 trust proxy 1，优先 req.ip；Fly 边缘另带 fly-client-ip。 */
export function clientIpOf(req: RequestLike | null | undefined): string {
  if (!req) return "unknown";
  const fly = req.headers?.["fly-client-ip"];
  const flyIp = Array.isArray(fly) ? fly[0] : fly;
  return String(req.ip || flyIp || req.socket?.remoteAddress || "unknown").trim() || "unknown";
}

/** 抛 tRPC 429。 */
export function assertUsageOrThrow(spec: UsageLimitSpec, subjects: string[]): void {
  const decision = consumeUsage(spec, subjects);
  if (!decision.ok) {
    console.warn(`[usageLimits] ${spec.name} 拒绝：${decision.reason}`, subjects.join(","));
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: decision.message });
  }
}

/** tRPC 主体：登录用户按用户 + IP 计，未登录按 IP 计。 */
export function trpcUsageSubjects(ctx: { user?: { id?: number | string | null } | null; req?: unknown }): string[] {
  const subjects = [`ip:${clientIpOf(ctx.req as RequestLike)}`];
  const uid = ctx.user?.id;
  if (uid != null && String(uid) !== "") subjects.unshift(`u:${uid}`);
  return subjects;
}

// ─── 各入口数值（常量；可用 env 覆盖） ─────────────────────────────

export const USAGE_LIMITS = {
  /** /api/google?op=geminiScript：画布文案（登录后）。 */
  geminiScript: { name: "gemini_script", perMinute: 10, perDay: 200, globalPerDay: 5000 },
  /** 成长营 / 平台：getGrowthSnapshot（非交互模式会调两次 LLM）。 */
  growthSnapshot: { name: "growth_snapshot", perMinute: 4, perDay: 60, globalPerDay: 3000 },
  /** 平台看板 LLM。 */
  platformDashboard: { name: "platform_dashboard", perMinute: 3, perDay: 40, globalPerDay: 2000 },
  /** 平台文案（同步兼容入口）LLM。 */
  platformContent: { name: "platform_content", perMinute: 3, perDay: 30, globalPerDay: 1500 },
  /** 工作台新闻（联网检索）：按坐标粗粒度缓存后，未命中缓存才调模型。 */
  ambientNews: { name: "ambient_news", perMinute: 6, perDay: 120, globalPerDay: 2000 },
  /** 工作台天气 / 路况。 */
  ambientLive: { name: "ambient_live", perMinute: 12, perDay: 400 },
  /** AI 客服对话。 */
  customerServiceChat: { name: "customer_service_chat", perMinute: 6, perDay: 60, globalPerDay: 3000 },
  /** 客服转人工 / 联络表单 / 邀请码申请 / 教育咨询 / 留言（会发通知或写库）。 */
  contactNotify: { name: "contact_notify", perMinute: 2, perDay: 10, globalPerDay: 500 },
  /** 同步 PDF 渲染（pdf-worker）。 */
  pdfRender: { name: "pdf_render", perMinute: 4, perDay: 80, globalPerDay: 4000 },
  /** /api/export 分镜 / 报告导出。 */
  storyboardExport: { name: "storyboard_export", perMinute: 4, perDay: 60, globalPerDay: 3000 },
  /** 成长营同步分析入口（analyzeVideo / analyzeGrowthCampImages / synthesizeGrowthCampAnalyses），目前不扣费。 */
  growthCampAnalyze: { name: "growth_camp_analyze", perMinute: 3, perDay: 30, globalPerDay: 1500 },
  /** 服务端直收上传（/api/upload 等）。 */
  serverUpload: { name: "server_upload", perMinute: 20, perDay: 300 },
  /** 账号密码登录失败前的尝试（按 IP + 邮箱）。 */
  passwordLogin: { name: "password_login", perMinute: 10, perDay: 100 },
} as const satisfies Record<string, UsageLimitSpec>;

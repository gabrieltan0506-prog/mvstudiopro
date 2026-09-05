import { z } from "zod";
import { manhuaCreativeAdvisorContextSchema } from "@shared/manhuaCreativeAdvisor";

export type AdvisorMessage = { id: string; role: "user" | "advisor"; text: string };

const pendingRequestSchema = z.object({
  requestId: z.string().uuid(),
  question: z.string().min(2).max(4000),
  rawQuestion: z.string().min(2).max(1200),
  label: z.string().max(1000),
  manhuaContext: manhuaCreativeAdvisorContextSchema.optional(),
}).strict();
const recoverySchema = z.object({
  format: z.literal("manhua-advisor-pending-v1"),
  request: pendingRequestSchema,
  confirmPaid: z.boolean(),
}).strict();
export type AdvisorPendingRequest = z.infer<typeof pendingRequestSchema>;
export type AdvisorPendingRecovery = z.infer<typeof recoverySchema>;

type AdvisorStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type AdvisorRecoveryLoadResult = {
  value: AdvisorPendingRecovery | null;
  error: string;
  quarantineKey?: string;
};

export type AdvisorMessagesLoadResult = {
  turns: AdvisorMessage[];
  error: string;
  writable: boolean;
  quarantineKey?: string;
};

/** 待回执也按同一账户/已确认项目版本隔离；恢复只展示按钮，不自动发起请求。 */
export function parseAdvisorPendingRecovery(raw: string | null): AdvisorPendingRecovery | null {
  return raw ? recoverySchema.parse(JSON.parse(raw)) : null;
}

/**
 * 坏的在途记录先原样隔离，再释放活动槽位。不能让一条旧坏记录永久阻止新请求保存。
 * 若隔离本身失败则保留原记录，避免以“恢复”为名静默丢数据。
 */
export function loadAdvisorPendingRecovery(
  storage: AdvisorStorage,
  recoveryKey: string,
  now = Date.now(),
): AdvisorRecoveryLoadResult {
  const raw = storage.getItem(recoveryKey);
  if (!raw) return { value: null, error: "" };
  try {
    return { value: parseAdvisorPendingRecovery(raw), error: "" };
  } catch {
    const quarantineKey = `${recoveryKey}:invalid:${now}`;
    try {
      storage.setItem(quarantineKey, raw);
      storage.removeItem(recoveryKey);
      return {
        value: null,
        error: "上次问答的坏恢复记录已隔离；原文仍保留，本次可以继续提问。",
        quarantineKey,
      };
    } catch {
      return {
        value: null,
        error: "上次问答的恢复记录无法读取或隔离；原记录未覆盖，本次恢复编号不能安全保存。",
      };
    }
  }
}

export function makeAdvisorPendingRecovery(request: AdvisorPendingRequest, confirmPaid: boolean): AdvisorPendingRecovery {
  return recoverySchema.parse({ format: "manhua-advisor-pending-v1", request, confirmPaid });
}

/** 按用户与已确认项目版本隔离；旧版仅按剧名的记录归属不明，不自动迁入。 */
export function manhuaAdvisorSessionKey(userId: string, confirmedProjectVersion: string): string {
  if (!userId.trim() || !confirmedProjectVersion.trim()) throw new Error("缺少已确认项目身份，顾问历史不能持久化。");
  return `mvs:manhua-advisor:v2:${encodeURIComponent(userId)}:${encodeURIComponent(confirmedProjectVersion)}`;
}

/** 未确认稿只使用内存会话；原稿改变后不沿用上一份未确认稿的在途答复。 */
export function manhuaAdvisorMountKey(userId: string | undefined, confirmedProjectVersion: string | undefined, draft: unknown): string {
  return JSON.stringify([userId || "guest", confirmedProjectVersion || null,
    confirmedProjectVersion ? null : draft]);
}

export function parseAdvisorMessages(raw: string | null): AdvisorMessage[] {
  if (!raw) return [];
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value)) throw new Error("顾问会话格式不可读取，原记录未覆盖");
  if (!value.every((item) => item && typeof item.id === "string" &&
    (item.role === "user" || item.role === "advisor") && typeof item.text === "string")) {
    throw new Error("顾问会话格式不可读取，原记录未覆盖");
  }
  return value;
}

/**
 * 会话坏记录与 pending 同口径：先原样隔离，成功后才开放新会话写入。
 * 隔离失败时保留活动键原文，并由 UI 关闭新问答，不能用新结果覆盖旧数据。
 */
export function loadAdvisorMessages(
  storage: AdvisorStorage,
  sessionKey: string,
  now = Date.now(),
): AdvisorMessagesLoadResult {
  const raw = storage.getItem(sessionKey);
  if (!raw) return { turns: [], error: "", writable: true };
  try {
    return { turns: parseAdvisorMessages(raw), error: "", writable: true };
  } catch {
    const quarantineKey = `${sessionKey}:invalid:${now}`;
    try {
      storage.setItem(quarantineKey, raw);
      storage.removeItem(sessionKey);
      return {
        turns: [],
        error: "旧顾问历史格式损坏，原文已隔离保存；本次从新会话继续。",
        writable: true,
        quarantineKey,
      };
    } catch {
      return {
        turns: [],
        error: "旧顾问历史损坏且无法安全隔离。为保护原文，已停止新的问答与扣点；请清理浏览器存储空间后刷新。",
        writable: false,
      };
    }
  }
}

export function advisorQuestionTurnId(requestId: string): string {
  return `${requestId}:question`;
}

export function advisorAnswerTurnId(requestId: string): string {
  return `${requestId}:answer`;
}

/** 同一个 requestId 的恢复回执可重放，但历史只能出现一问一答。 */
export function mergeAdvisorCompletedExchange(
  turns: AdvisorMessage[],
  request: Pick<AdvisorPendingRequest, "requestId" | "label" | "rawQuestion">,
  answer?: string,
): AdvisorMessage[] {
  const next = [...turns];
  const questionId = advisorQuestionTurnId(request.requestId);
  if (!next.some((turn) => turn.id === questionId)) {
    next.push({ id: questionId, role: "user", text: `${request.label}\n${request.rawQuestion}` });
  }
  const answerText = answer?.trim();
  const answerId = advisorAnswerTurnId(request.requestId);
  if (answerText && !next.some((turn) => turn.id === answerId)) {
    next.push({ id: answerId, role: "advisor", text: answerText });
  }
  return next;
}

/**
 * 回包必须写回请求发起时捕获的 sessionKey；成功落盘后调用方才可删除 pending。
 * 这里不吞坏历史，避免用一条新答复覆盖不可读的旧会话。
 */
export function persistAdvisorCompletedExchange(
  storage: AdvisorStorage,
  sessionKey: string,
  request: Pick<AdvisorPendingRequest, "requestId" | "label" | "rawQuestion">,
  answer: string,
): AdvisorMessage[] {
  const existing = parseAdvisorMessages(storage.getItem(sessionKey));
  const next = mergeAdvisorCompletedExchange(existing, request, answer);
  storage.setItem(sessionKey, JSON.stringify(next));
  return next;
}

/** 历史只作追问上下文；完整会话仍保留。节选显式标记，不改写原文。 */
export function advisorRecentHistory(turns: AdvisorMessage[]) {
  return turns.slice(-8).map((turn) => ({
    role: turn.role === "advisor" ? "assistant" as const : "user" as const,
    content: turn.text.length > 1500 ? `${turn.text.slice(0, 1490)}…[历史节选]` : turn.text,
  }));
}

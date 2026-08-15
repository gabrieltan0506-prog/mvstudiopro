import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { HttpError } from "@shared/_core/errors";
import { sdk } from "./sdk";
import { readSupervisorSession, type SupervisorSession } from "../services/supervisor-session";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  /** 已验签、未过期且与当前登录 user.id 一致的监管会话。 */
  supervisorSession?: SupervisorSession;
  /**
   * `user` 为空的原因是鉴权依赖挂了（库连不上等），而不是没带/带错凭证。
   * 调用方应回 503 让客户端重试，**不要**提示用户重新登录。
   */
  authUnavailable?: boolean;
  /**
   * When the HTTP client disconnects (tab close, proxy timeout, etc.), this signal aborts.
   * Long LLM calls should pass this into `invokeLLM({ abortSignal })` to stop burning provider quota.
   */
  clientDisconnected: AbortSignal;
  /**
   * 仅由持久 jobs worker 注入：趋势报告已在入队时完成扣费与账本登记。
   * 浏览器请求无法设置该字段，防止公开 input 绕过计费。
   */
  prepaidPlatformTrendJobId?: string;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  const disconnect = new AbortController();
  const req = opts.req as NodeJS.EventEmitter & { once?: unknown };
  if (typeof req.once === "function") {
    const onDisconnect = () => {
      try {
        disconnect.abort();
      } catch {
        /* noop */
      }
    };
    req.once("close", onDisconnect);
    req.once("aborted", onDisconnect);
  }

  let user: User | null = null;
  let authUnavailable = false;

  try {
    user = await sdk.authenticateRequest(opts.req, { silentMissing: true });
  } catch (error) {
    // Authentication is optional for public procedures.
    user = null;
    authUnavailable = error instanceof HttpError && error.statusCode >= 500;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
    supervisorSession: user
      ? readSupervisorSession({
          cookieHeader: opts.req.headers.cookie,
          expectedUserId: user.id,
        })
      : undefined,
    authUnavailable,
    clientDisconnected: disconnect.signal,
  };
}

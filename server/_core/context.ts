import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  /**
   * When the HTTP client disconnects (tab close, proxy timeout, etc.), this signal aborts.
   * Long LLM calls should pass this into `invokeLLM({ abortSignal })` to stop burning provider quota.
   */
  clientDisconnected: AbortSignal;
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

  try {
    user = await sdk.authenticateRequest(opts.req, { silentMissing: true });
  } catch (error) {
    // Authentication is optional for public procedures.
    user = null;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
    clientDisconnected: disconnect.signal,
  };
}

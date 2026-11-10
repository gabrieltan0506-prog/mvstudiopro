/**
 * 服务端自调网关（/api/jobs 等）的内部身份：
 * - 进程内直接调 handler：给合成的 req 打进程内标记（WeakSet，外部请求无法伪造）。
 * - 服务端经 HTTP 回调自己：带时间戳 + HMAC 签名头（密钥取服务端已有的会话签名密钥，不新增配置；
 *   只传签名不传密钥），5 分钟内有效。没有密钥时不产出签名，验证一律不过。
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const inProcessRequests = new WeakSet<object>();
export const INTERNAL_GATEWAY_TS_HEADER = "x-mvs-internal-ts";
export const INTERNAL_GATEWAY_SIG_HEADER = "x-mvs-internal-sig";
const MAX_SKEW_MS = 5 * 60_000;

export function markInProcessGatewayRequest<T extends object>(req: T): T {
  inProcessRequests.add(req);
  return req;
}

function secret(): string {
  return String(process.env.JWT_SECRET || "").trim();
}

function sign(ts: string, key: string): string {
  return createHmac("sha256", key).update(`mvs-internal-gateway:v1:${ts}`).digest("base64url");
}

export function buildInternalGatewayHeaders(nowMs: number = Date.now()): Record<string, string> {
  const key = secret();
  if (!key) return {};
  const ts = String(nowMs);
  return { [INTERNAL_GATEWAY_TS_HEADER]: ts, [INTERNAL_GATEWAY_SIG_HEADER]: sign(ts, key) };
}

function header(headers: unknown, name: string): string {
  const value = (headers as Record<string, unknown> | undefined)?.[name];
  return String(Array.isArray(value) ? value[0] ?? "" : value ?? "").trim();
}

export function isInternalGatewayRequest(req: unknown, nowMs: number = Date.now()): boolean {
  if (req && typeof req === "object" && inProcessRequests.has(req)) return true;
  const key = secret();
  if (!key) return false;
  const headers = (req as { headers?: unknown } | null)?.headers;
  const ts = header(headers, INTERNAL_GATEWAY_TS_HEADER);
  const sig = header(headers, INTERNAL_GATEWAY_SIG_HEADER);
  if (!/^\d{10,16}$/.test(ts) || !sig) return false;
  if (Math.abs(nowMs - Number(ts)) > MAX_SKEW_MS) return false;
  const expected = Buffer.from(sign(ts, key));
  const supplied = Buffer.from(sig);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

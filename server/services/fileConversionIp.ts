import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import type { Request } from "express";

export function conversionDay(now = new Date()) { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(now); }
export function normalizeConversionIp(value: string) {
  let ip = value.trim().toLowerCase();
  if (!isIP(ip)) throw new Error("无法确认来源地址，请从正式页面重新进入");
  if (isIP(ip) === 6) {
    ip = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
    if (ip.startsWith("::ffff:")) {
      const tail = ip.slice(7).split(":");
      if (tail.length === 2) {
        const first = parseInt(tail[0]!, 16), second = parseInt(tail[1]!, 16);
        ip = `${first >>> 8}.${first & 255}.${second >>> 8}.${second & 255}`;
      }
    }
  }
  return ip;
}
/** 转换API直达Fly；不接受任意XFF、客户端IP字段或前端配额。仅保存按日HMAC。 */
export function fileConversionIpHash(req: Request, day: string, env: NodeJS.ProcessEnv = process.env) {
  const secret = env.JWT_SECRET;
  if (!secret) throw new Error("来源验证暂不可用，请稍后再试");
  const raw = env.FLY_APP_NAME ? req.headers["fly-client-ip"] : req.socket.remoteAddress;
  if (typeof raw !== "string") throw new Error("无法确认来源地址，请从正式页面重新进入");
  return createHmac("sha256", secret).update(`file-conversion-ip/v1/${day}/${normalizeConversionIp(raw)}`).digest("hex");
}

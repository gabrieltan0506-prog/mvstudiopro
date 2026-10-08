import { describe, expect, it } from "vitest";
import type { Request } from "express";
import { conversionDay, fileConversionIpHash, normalizeConversionIp } from "./fileConversionIp";
const req = (headers: Record<string,string>, remoteAddress="127.0.0.1") => ({ headers, socket: { remoteAddress } }) as Request;
describe("免费转换来源与自然日", () => {
 it("上海零点重置", () => { expect(conversionDay(new Date("2026-10-08T15:59:59Z"))).toBe("2026-10-08"); expect(conversionDay(new Date("2026-10-08T16:00:00Z"))).toBe("2026-10-09"); });
 it("IPv4映射和IPv6等价写法归一", () => { expect(normalizeConversionIp("::ffff:192.0.2.5")).toBe("192.0.2.5"); expect(normalizeConversionIp("2001:0db8:0000:0000:0000:0000:0000:0001")).toBe("2001:db8::1"); expect(() => normalizeConversionIp("1.2.3.4, 5.6.7.8")).toThrow(); });
 it("Fly只信平台头，忽略可伪造XFF；每日不同HMAC不记录明文", () => { const env={JWT_SECRET:"test-only-not-a-real-secret",FLY_APP_NAME:"test"}; const a=fileConversionIpHash(req({"fly-client-ip":"192.0.2.5","x-forwarded-for":"1.1.1.1"}),"2026-10-09",env); expect(a).toHaveLength(64); expect(a).toBe(fileConversionIpHash(req({"fly-client-ip":"::ffff:192.0.2.5","x-forwarded-for":"8.8.8.8"}),"2026-10-09",env)); expect(a).not.toBe(fileConversionIpHash(req({"fly-client-ip":"192.0.2.5"}),"2026-10-10",env)); expect(() => fileConversionIpHash(req({"x-forwarded-for":"1.1.1.1"}),"2026-10-09",env)).toThrow(); });
 it("本地只读socket，缺密钥明确失败", () => { expect(() => fileConversionIpHash(req({}),"2026-10-09",{})).toThrow(); expect(fileConversionIpHash(req({"fly-client-ip":"8.8.8.8"}),"2026-10-09",{JWT_SECRET:"test-key"})).toBe(fileConversionIpHash(req({}),"2026-10-09",{JWT_SECRET:"test-key"})); });
});

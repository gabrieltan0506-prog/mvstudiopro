/** 直接驱动 jobs，证明素材拒绝发生在扣费、建单之前；不访问真实服务。 */
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ auth: vi.fn(), charge: vi.fn(), preflight: vi.fn(), create: vi.fn() }));
vi.mock("../_core/sdk.js", () => ({ sdk: { authenticateRequest: h.auth } }));
vi.mock("../credits.js", () => ({ getUserPlan: async () => "pro", deductCreditsAmount: h.charge, refundCredits: vi.fn(), InsufficientCreditsError: class extends Error {} }));
vi.mock("../db.js", () => ({ getDb: async () => null }));
vi.mock("../services/openrouterHailuoVideo.js", () => ({ isOpenRouterHailuoConfigured: () => true }));
vi.mock("../services/evolinkHailuoVideo.js", async original => ({ ...await original<typeof import("../services/evolinkHailuoVideo.js")>(), isEvolinkH3Configured: () => true }));
vi.mock("../services/hailuoReferencePreflight.js", () => ({ preflightH3ReferenceMedia: h.preflight }));
vi.mock("../services/canvasVideoAudioReference.js", () => ({ resolveCanvasVideoAudioReference: async ({ reference }: { reference: string }) => ({ storedReference: reference, url: reference }) }));
vi.mock("../services/canvasVideoTask.js", () => ({ createCanvasVideoTask: h.create }));
let handler: typeof import("../../api/jobs").default;
beforeAll(async () => {
 vi.stubGlobal("fetch", vi.fn(() => { throw new Error("禁止真实网络"); }));
 handler = (await import("../../api/jobs")).default;
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => { vi.clearAllMocks(); h.auth.mockResolvedValue({ id: 71, role: "admin" }); h.preflight.mockResolvedValue(undefined); });
async function request(body: Record<string, unknown>) {
 const out = { status: 0, body: {} as any };
 const res = { setHeader() { return res; }, status(code: number) { out.status = code; return res; }, json(value: unknown) { out.body = value; return res; }, end() { return res; } };
 await handler({ method: "POST", query: { op: "hailuo3Video" }, headers: {}, body: { prompt: "人物行走", duration: 5, resolution: "768p", ...body } } as never, res as never);
 expect(h.charge).not.toHaveBeenCalled(); expect(h.create).not.toHaveBeenCalled();
 return out;
}
it("未登录不检查素材、不扣费", async () => {
 h.auth.mockRejectedValue(new Error("未登录"));
 expect((await request({ audioUrls: ["https://example.test/a.wav"] })).status).toBe(401);
 expect(h.preflight).not.toHaveBeenCalled();
});
it("第四条音频在下载和扣费前拒绝", async () => {
 expect((await request({ audioUrls: [1,2,3,4].map(i => `https://example.test/${i}.wav`) })).status).toBe(400);
 expect(h.preflight).not.toHaveBeenCalled();
});
it("真实媒体预检失败不扣费或建单", async () => {
 h.preflight.mockRejectedValue(new Error("合计超过15秒"));
 const result = await request({ videoUrls: ["https://example.test/a.mp4"] });
 expect(result.status).toBe(400); expect(result.body.error).toContain("未扣费"); expect(h.preflight).toHaveBeenCalledTimes(1);
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** 1111 收口：/api/export 须登录 + 用量闸门；图片只代取本站与自有存储；水印按服务端会员权益；失败不泄漏。离线替身。 */
const h = vi.hoisted(() => ({ auth: vi.fn(), pdf: vi.fn(), word: vi.fn(), snap: vi.fn(), watermark: vi.fn() }));
vi.mock("../_core/sdk.js", () => ({ sdk: { authenticateRequest: h.auth } }));
vi.mock("../storyboard-export.js", () => ({ exportToPDF: h.pdf, exportToWord: h.word, exportSnapshotImageToPDF: h.snap }));
vi.mock("./tier-provider-routing.js", () => ({ resolveWatermark: h.watermark }));
import handler from "../../api/export";
import { resetUsageLimitsForTest, USAGE_LIMITS } from "../_core/usageLimits";

async function call(body: Record<string, unknown>, op = "storyboard-pdf", method = "POST") {
  let status = 0, result: any;
  const response = { status(code: number) { status = code; return this; }, json(value: unknown) { result = value; return this; }, send(value: unknown) { result = value; return this; }, setHeader() { return this; } };
  await handler({ method, headers: {}, ip: "10.0.0.1", query: { op }, body } as never, response as never);
  return { status, body: result };
}
const scenes = [{ sceneIndex: 1, scenePrompt: "开场", imageUrls: [
  "https://www.mvstudiopro.com/api/canvas-media/a.png",
  "https://storage.googleapis.com/mv-studio-pro-vertex-video-temp/u7/b.png",
  "http://169.254.169.254/computeMetadata/v1/",
  "https://evil.example/x.png",
  "https://127.0.0.1/y.png",
] }];

beforeEach(() => {
  resetUsageLimitsForTest();
  h.auth.mockReset().mockResolvedValue({ id: 7, role: "user" });
  h.pdf.mockReset().mockResolvedValue({ url: "https://storage.googleapis.com/b/out.pdf", message: "ok" });
  h.word.mockReset().mockResolvedValue({ url: "https://storage.googleapis.com/b/out.docx", message: "ok" });
  h.snap.mockReset().mockResolvedValue({ buffer: Buffer.from("%PDF") });
  h.watermark.mockReset().mockResolvedValue(true);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("/api/export", () => {
  it("未登录 401，不导出", async () => {
    h.auth.mockResolvedValue(null);
    expect((await call({ scenes })).status).toBe(401);
    expect(h.pdf).not.toHaveBeenCalled();
  });

  it("登录放行：站外 / 内网图片地址被略过不代取，只留本站与自有存储", async () => {
    const result = await call({ scenes });
    expect(result.status).toBe(200);
    expect(result.body.skippedImages).toBe(3);
    const sent = h.pdf.mock.calls[0][0].scenes[0].previewImageUrls;
    expect(sent).toEqual([
      "https://www.mvstudiopro.com/api/canvas-media/a.png",
      "https://storage.googleapis.com/mv-studio-pro-vertex-video-temp/u7/b.png",
    ]);
  });

  it("水印按服务端会员权益：客户端 isPaidUser=true 无效；付费用户免水印；管理员免水印", async () => {
    await call({ scenes, isPaidUser: true });
    expect(h.pdf.mock.calls[0][1]).toEqual({ addWatermark: true });
    h.watermark.mockResolvedValue(false);
    await call({ scenes }, "storyboard-docx");
    expect(h.word.mock.calls[0][1]).toEqual({ addWatermark: false });
    h.auth.mockResolvedValue({ id: 1, role: "admin" });
    h.watermark.mockResolvedValue(true);
    await call({ scenes });
    expect(h.pdf.mock.calls[1][1]).toEqual({ addWatermark: false });
  });

  it("场次过多 400；截图只收图片 data URL", async () => {
    expect((await call({ scenes: Array.from({ length: 61 }, () => scenes[0]) })).status).toBe(400);
    expect((await call({ imageDataUrl: "https://evil.example/a.png" }, "analysis-page-pdf")).status).toBe(400);
    expect((await call({ imageDataUrl: "data:image/png;base64,AAAA" }, "analysis-page-pdf")).status).toBe(200);
  });

  it("超限 429", async () => {
    for (let i = 0; i < USAGE_LIMITS.storyboardExport.perMinute; i++) expect((await call({ scenes })).status).toBe(200);
    expect((await call({ scenes })).status).toBe(429);
  });

  it("导出失败：报错脱敏", async () => {
    h.pdf.mockRejectedValue(new Error("Vercel blob put failed https://x.blob.vercel-storage.com token=abc"));
    const result = await call({ scenes });
    expect(result.status).toBe(500);
    expect(result.body.message).not.toMatch(/vercel|https?:|token=/i);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

/** 接口级：越权/匿名加固（真实 appRouter；任务入库替换成替身，不连库、不调任何上游）。 */
const h = vi.hoisted(() => ({ createJob: vi.fn() }));
vi.mock("./jobs/repository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./jobs/repository")>()),
  createJob: h.createJob,
}));
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function ctx(user: { id: number; role: string } | null): TrpcContext {
  return {
    user: user ? ({ openId: `open-${user.id}`, name: "测试", email: null, ...user } as never) : null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
    clientDisconnected: new AbortController().signal,
  };
}
const caller = (user: { id: number; role: string } | null) => appRouter.createCaller(ctx(user));

beforeEach(() => {
  h.createJob.mockReset().mockResolvedValue(undefined);
  vi.stubEnv("GCS_PDF_EXPORT_BUCKET", "test-bucket");
  vi.stubEnv("GCS_USER_UPLOAD_BUCKET", "test-bucket");
});

describe("mvAnalysis.queuePdfFromHtml 入队核验", () => {
  it.each([
    ["别人前缀", "gs://test-bucket/pdf-async/html/8/1-abc.html"],
    ["别的桶", "gs://other-bucket/pdf-async/html/7/1-abc.html"],
    ["本桶任意对象", "gs://test-bucket/uploads/u7/secret.mp4"],
    ["越界段", "gs://test-bucket/pdf-async/html/7/../8/1.html"],
    ["任意 gs://", "gs://some-bucket/any/object.json"],
  ])("%s → FORBIDDEN，不入队", async (_name, htmlGcsUri) => {
    await expect(caller({ id: 7, role: "user" }).mvAnalysis.queuePdfFromHtml({ htmlGcsUri })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(h.createJob).not.toHaveBeenCalled();
  });

  it("未登录 → UNAUTHORIZED，不入队", async () => {
    await expect(caller(null).mvAnalysis.queuePdfFromHtml({ htmlGcsUri: "gs://test-bucket/pdf-async/html/7/1-abc.html" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(h.createJob).not.toHaveBeenCalled();
  });

  it("本人前缀快照 → 入队，落库的是规范地址与会话用户", async () => {
    const result = await caller({ id: 7, role: "user" }).mvAnalysis.queuePdfFromHtml({ htmlGcsUri: " gs://test-bucket/pdf-async/html/7/1762-AbC.html ".trim() });
    expect(result.status).toBe("queued");
    expect(h.createJob).toHaveBeenCalledTimes(1);
    expect(h.createJob.mock.calls[0][0]).toMatchObject({
      userId: "7", type: "pdf_export",
      input: { action: "render_html", params: { htmlGcsUri: "gs://test-bucket/pdf-async/html/7/1762-AbC.html" } },
    });
  });
});

describe("mvAnalysis.createPlatformQAJob 附件核验", () => {
  const base = { question: "怎么涨粉", windowDays: 15, snapshot: {} };
  it("未登录 → UNAUTHORIZED，不入队", async () => {
    await expect(caller(null).mvAnalysis.createPlatformQAJob(base)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(h.createJob).not.toHaveBeenCalled();
  });
  it.each([
    "gs://test-bucket/platform-qa/u8/1-a.pdf",
    "gs://test-bucket/platform-qa/1-a.pdf",
    "gs://other-bucket/platform-qa/u7/1-a.pdf",
    "gs://test-bucket/uploads/u7/secret.mp4",
    "https://evil.example/a.pdf",
  ])("附件 %s → FORBIDDEN，不入队", async (fileUri) => {
    await expect(caller({ id: 7, role: "user" }).mvAnalysis.createPlatformQAJob({ ...base, fileUri })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(h.createJob).not.toHaveBeenCalled();
  });
  it("本人附件与无附件 → 入队", async () => {
    await caller({ id: 7, role: "user" }).mvAnalysis.createPlatformQAJob({ ...base, fileUri: "gs://test-bucket/platform-qa/u7/1-a.pdf", fileMimeType: "application/pdf" });
    await caller({ id: 7, role: "user" }).mvAnalysis.createPlatformQAJob(base);
    expect(h.createJob).toHaveBeenCalledTimes(2);
    expect(h.createJob.mock.calls[0][0].input.params.fileUri).toBe("gs://test-bucket/platform-qa/u7/1-a.pdf");
    expect(h.createJob.mock.calls[1][0].input.params.fileUri).toBeUndefined();
  });
});

describe("原先匿名可触发付费上游的接口须登录", () => {
  it("未登录一律 UNAUTHORIZED（在任何上游调用之前）", async () => {
    const anon = caller(null) as any;
    for (const [path, input] of [
      ["mvAnalysis.analyzeFrame", { imageBase64: "AAAA", mimeType: "image/jpeg" }],
      ["mvAnalysis.analyzeDocument", {}],
      ["mvAnalysis.buildPremiumRemix", {}],
      ["mvAnalysis.generatePremiumRemixAssets", {}],
      ["mvAnalysis.askPlatformFollowUp", {}],
      ["mvAnalysis.createPlatformAnalysisJob", {}],
      ["mvAnalysis.analyzeSegment", {}],
      ["mvAnalysis.generateReport", {}],
      ["openaiImage.analyze", {}],
    ] as const) {
      const [ns, name] = path.split(".");
      await expect(anon[ns!][name!](input), path).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    }
  });
  it("openaiImage.edit 只供监管/管理员：未登录与普通用户 FORBIDDEN", async () => {
    await expect((caller(null) as any).openaiImage.edit({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect((caller({ id: 7, role: "user" }) as any).openaiImage.edit({})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

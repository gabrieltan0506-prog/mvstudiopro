import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** 1111 收口：同步 PDF 渲染须登录 + 用量闸门；提交的 HTML 先净化再转发渲染端；失败不回渲染端原文。离线替身。 */
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { consumeUsage, resetUsageLimitsForTest, USAGE_LIMITS } from "./_core/usageLimits";

function ctx(user: { id: number; role: string } | null): TrpcContext {
  return {
    user: user ? ({ openId: `open-${user.id}`, name: "测试", email: null, ...user } as never) : null,
    req: { protocol: "https", headers: {}, ip: "10.0.0.1" } as unknown as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
    clientDisconnected: new AbortController().signal,
  };
}
const caller = (user: { id: number; role: string } | null) => appRouter.createCaller(ctx(user));
const USER = { id: 7, role: "user" };
const fetchMock = vi.fn();
const HTML = `<html><head></head><body><div id="r">${"报告正文".repeat(30)}</div>
  <img src="http://169.254.169.254/computeMetadata/v1/"><iframe src="http://10.0.0.1/"></iframe><script>fetch("http://localhost")</script></body></html>`;

beforeEach(() => {
  resetUsageLimitsForTest();
  fetchMock.mockReset().mockResolvedValue(new Response(new Uint8Array([37, 80, 68, 70]), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("CLOUD_RUN_PDF_URL", "https://pdf-worker.test");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe.each(["downloadPlatformPdf", "downloadAnalysisPdf"] as const)("mvAnalysis.%s", name => {
  const run = (c: ReturnType<typeof caller>, html = HTML) => c.mvAnalysis[name]({ html });

  it("未登录 → UNAUTHORIZED，不转发渲染端", async () => {
    await expect(run(caller(null))).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("登录放行：转发的 HTML 已去掉脚本 / 框架 / 内网地址并带 CSP", async () => {
    const result = await run(caller(USER));
    expect(result.success).toBe(true);
    const sent = JSON.parse(String(fetchMock.mock.calls[0][1].body)).html as string;
    expect(sent).not.toMatch(/169\.254|10\.0\.0\.1|localhost|<script|<iframe/i);
    expect(sent).toContain("Content-Security-Policy");
    expect(sent).toContain("报告正文");
  });

  it("超过大小上限 → PAYLOAD_TOO_LARGE，不转发", async () => {
    await expect(run(caller(USER), `<p>${"x".repeat(9 * 1024 * 1024)}</p>`)).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("超限 → TOO_MANY_REQUESTS", async () => {
    for (let i = 0; i < USAGE_LIMITS.pdfRender.perMinute; i++) consumeUsage(USAGE_LIMITS.pdfRender, ["u:7"]);
    await expect(run(caller(USER))).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("渲染端失败：只回固定文案，不带渲染端原文与地址", async () => {
    fetchMock.mockResolvedValue(new Response("puppeteer crashed at http://10.1.2.3 pdf-worker", { status: 500 }));
    const error = await run(caller(USER)).catch(e => e);
    expect(error.message).toBe("PDF 生成失败，请稍后重试");
  });
});

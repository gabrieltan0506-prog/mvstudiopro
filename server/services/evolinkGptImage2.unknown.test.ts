import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("EvoLink gpt-image-2 · 轮询到点按 unknown 上抛，不吞成 null", () => {
  it("任务一直 processing 到墙钟 → rejects kind=unknown，且不回 null", async () => {
    vi.stubEnv("EVOLINK_API_KEY", "k");
    vi.stubEnv("EVOLINK_GPT_IMAGE2_TIMEOUT_MS", "60000");
    vi.stubEnv("EVOLINK_GPT_IMAGE2_POLL_MS", "1000");
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/v1/images/generations")) {
          return new Response(JSON.stringify({ id: "task-1", status: "pending" }), { status: 200 });
        }
        if (String(url).includes("/v1/tasks/")) {
          return new Response(JSON.stringify({ id: "task-1", status: "processing", progress: 40 }), { status: 200 });
        }
        throw new Error(`unexpected ${url}`);
      }),
    );
    const { postEvolinkGptImage2AndUpload } = await import("./evolinkGptImage2");
    const err: { message?: string } = {};
    const pending = postEvolinkGptImage2AndUpload("一张图", "test-sub", { aspectRatio: "16:9", captureError: err });
    const outcome = pending.then(
      (v) => ({ ok: true as const, v }),
      (e) => ({ ok: false as const, e }),
    );
    await vi.advanceTimersByTimeAsync(65_000);
    const result = await outcome;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect((result.e as { kind?: string }).kind).toBe("unknown");
      expect(String((result.e as Error).message)).toMatch(/poll timeout/);
    }
    expect(err.message).toMatch(/poll timeout/);
  });
});

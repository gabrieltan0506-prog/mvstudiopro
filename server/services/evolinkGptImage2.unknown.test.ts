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

describe("EvoLink 模型档位（0910）", () => {
  it("默认 gpt-image-2.5-flare，开关 sunburst；env 全名整体覆盖；2.5 也走 n=1 + 比例 resolution", async () => {
    vi.stubEnv("EVOLINK_GPT_IMAGE2_MODEL", "");
    const { resolveEvolinkGptImageModel, buildEvolinkRequestBody, isEvolinkGptImageFamily } = await import("./evolinkGptImage2");
    expect(resolveEvolinkGptImageModel()).toBe("gpt-image-2.5-flare");
    expect(resolveEvolinkGptImageModel("sunburst")).toBe("gpt-image-2.5-sunburst");
    expect(isEvolinkGptImageFamily("gpt-image-2.5-sunburst")).toBe(true);
    const body = buildEvolinkRequestBody("gpt-image-2.5-flare", "p", "16:9", "xhigh", undefined, undefined, "4K");
    expect(body).toMatchObject({ model: "gpt-image-2.5-flare", n: 1, size: "16:9", resolution: "4K", quality: "xhigh" });
    vi.stubEnv("EVOLINK_GPT_IMAGE2_MODEL", "gpt-image-2");
    vi.resetModules();
    const again = await import("./evolinkGptImage2");
    expect(again.resolveEvolinkGptImageModel("sunburst")).toBe("gpt-image-2");
  });
});

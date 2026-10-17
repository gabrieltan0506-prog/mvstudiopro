import { describe, expect, it, vi } from "vitest";
import {
  quoteWavespeedOmniHuman,
  submitWavespeedOmniHuman,
  pollWavespeedOmniHuman,
  type OmniProviderDeps,
} from "./wavespeedOmniHuman";

const context = { userId: 7, requestId: "test-request-001" };
const input = {
  image: "https://example.test/portrait.png",
  audio: "https://example.test/voice.wav",
  prompt: "自然讲述",
};
function setup(body: unknown, status = 200) {
  const saved: Array<{ name: string; text: string }> = [];
  const deps: OmniProviderDeps = {
    key: async () => "test-key",
    fetch: vi.fn(
      async () => new Response(JSON.stringify(body), { status })
    ) as unknown as typeof fetch,
    persist: vi.fn(async (name, bytes) => {
      saved.push({ name, text: bytes.toString() });
    }),
  };
  return { deps, saved };
}

describe("音频驱动人物供应商合同", () => {
  it("按完整素材核价，原始与解析回执分别留存，不提交生成", async () => {
    const { deps, saved } = setup({
      code: 200,
      data: { price: 1.5, discounted_price: 1.2 },
    });
    const result = await quoteWavespeedOmniHuman(context, input, deps);
    expect(result).toMatchObject({ priceUsd: 1.5, discountedPriceUsd: 1.2 });
    expect(deps.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = vi.mocked(deps.fetch).mock.calls[0];
    expect(url).toBe("https://api.wavespeed.ai/api/v3/model/price");
    expect(JSON.parse(options!.body as string)).toEqual({
      model: "bytedance/omni-human-2.0",
      inputs: input,
    });
    expect(saved).toHaveLength(4);
    expect(saved[0].name).toMatch(/\.raw\.json$/);
    expect(saved[2].name).toMatch(/\.parsed\.json$/);
    expect(JSON.parse(saved[1].text)).toMatchObject({
      bytes: result.evidence.raw.bytes,
      sha256: result.evidence.raw.sha256,
    });
    expect(result.evidence.raw.bytes).toBe(Buffer.byteLength(saved[0].text));
    expect(saved.map(s => s.text).join("")).not.toContain("test-key");
  });
  it.each([
    { code: 4005, data: { price: 0, discounted_price: 0 } },
    { code: 200, data: { price: "1.5", discounted_price: 1.5 } },
    { code: 200, data: { price: 1.5 } },
  ])("HTTP成功不代表有效报价 %j", async body => {
    await expect(
      quoteWavespeedOmniHuman(context, input, setup(body).deps)
    ).rejects.toThrow("报价未能确认");
  });
  it("缺少完整音频时不发起基础价查询", async () => {
    const { deps } = setup({});
    await expect(
      quoteWavespeedOmniHuman(context, { ...input, audio: "" }, deps)
    ).rejects.toThrow();
    expect(deps.fetch).not.toHaveBeenCalled();
  });
  it("原始响应保存失败时不得消费任务ID，也不得再次提交", async () => {
    const { deps } = setup({ code: 200, data: { id: "provider-1" } });
    deps.persist = vi.fn(async () => {
      throw new Error("storage failure");
    });
    await expect(
      submitWavespeedOmniHuman(context, input, deps)
    ).rejects.toMatchObject({ kind: "unknown" });
    expect(deps.fetch).toHaveBeenCalledTimes(1);
  });
  it("提交只包含单图、原声和表演提示，不伪造分辨率或多图参考", async () => {
    const { deps } = setup({ code: 200, data: { id: "provider-1" } });
    expect(
      (await submitWavespeedOmniHuman(context, input, deps)).predictionId
    ).toBe("provider-1");
    expect(
      JSON.parse(vi.mocked(deps.fetch).mock.calls[0][1]!.body as string)
    ).toEqual(input);
  });
  it.each([401, 404, 429, 500])(
    "查询HTTP%s不冒充生成失败或触发新提交",
    async status => {
      const { deps } = setup({ code: status }, status);
      expect(
        (await pollWavespeedOmniHuman(context, "provider-1", deps)).state
      ).toBe("running");
      expect(vi.mocked(deps.fetch).mock.calls[0][1]!.method).toBe("GET");
      expect(deps.fetch).toHaveBeenCalledTimes(1);
    }
  );
  it("只消费同一任务的正式终态，拒绝另一任务回执", async () => {
    const { deps } = setup({
      code: 200,
      data: { id: "other-id", status: "failed" },
    });
    expect(
      (await pollWavespeedOmniHuman(context, "provider-1", deps)).state
    ).toBe("running");
  });
  it("原任务明确失败与可下载成片分别处理", async () => {
    expect(
      (
        await pollWavespeedOmniHuman(
          context,
          "provider-1",
          setup({ code: 200, data: { id: "provider-1", status: "failed" } })
            .deps
        )
      ).state
    ).toBe("failed");
    expect(
      await pollWavespeedOmniHuman(
        context,
        "provider-1",
        setup({
          code: 200,
          data: {
            id: "provider-1",
            status: "completed",
            outputs: ["https://static.wavespeed.ai/result.mp4"],
          },
        }).deps
      )
    ).toEqual({
      state: "completed",
      sourceUrl: "https://static.wavespeed.ai/result.mp4",
    });
  });
  it("格式损坏仍先保存原始响应", async () => {
    const { deps, saved } = setup({});
    deps.fetch = vi.fn(
      async () => new Response("not-json")
    ) as unknown as typeof fetch;
    await expect(
      quoteWavespeedOmniHuman(context, input, deps)
    ).rejects.toThrow();
    expect(saved).toHaveLength(2);
    expect(saved[0].text).toBe("not-json");
  });
});

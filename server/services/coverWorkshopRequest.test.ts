import { afterEach, expect, it, vi } from "vitest";
import sharp from "sharp";
import { postOpenAiGptImage2AndUpload } from "./openaiGptImage2";
vi.mock("./openaiImageKeyPool.js", () => ({
  resolveOpenAiImageKeyChain: () => [{ key: "test-key", slot: "test" }],
  shouldRetryOpenAiImageWithOtherKey: () => false,
}));
vi.mock("./evolinkGptImage2.js", () => ({
  uploadBufferToPlatformStorage: async () => "https://test.invalid/saved.png",
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it.each(["draft", "final"] as const)(
  "封面%s实际HTTP请求锁定模型、2K和质量，保留全部参考与回执",
  async stage => {
    vi.stubEnv("OPENAI_GPT_IMAGE2_MODEL", "gpt-image-2-2026-04-21");
    const png = await sharp({
      create: { width: 1152, height: 2048, channels: 3, background: "#e2d5c2" },
    })
      .png()
      .toBuffer();
    const receipt = vi.fn();
    let posts = 0;
    const model =
        stage === "draft" ? "gpt-image-2.5-flare" : "gpt-image-2.5-sunburst",
      quality = stage === "draft" ? "medium" : "high";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "https://test.invalid/ref")
          return new Response(new Uint8Array(png));
        expect(new URL(url).hostname).toBe("api.openai.com");
        posts++;
        if (stage === "draft")
          expect(JSON.parse(String(init?.body))).toMatchObject({
            model,
            size: "1152x2048",
            quality,
          });
        else {
          const form = await new Response(init?.body, {
            headers: init?.headers,
          }).formData();
          expect(form.get("model")).toBe(model);
          expect(form.get("size")).toBe("1152x2048");
          expect(form.get("quality")).toBe(quality);
          expect(form.getAll("image[]")).toHaveLength(1);
          expect(form.has("input_fidelity")).toBe(false);
        }
        return Response.json({
          data: [{ b64_json: png.toString("base64") }],
          usage: { output_tokens: 17 },
        });
      })
    );
    expect(
      await postOpenAiGptImage2AndUpload(
        "测试封面文字，不截断",
        "cover-workshop",
        {
          exactModel: model,
          size: "1152x2048",
          quality,
          imageUrls: stage === "final" ? ["https://test.invalid/ref"] : [],
          strictRequest: true,
          persistResponse: receipt,
        }
      )
    ).toBe("https://test.invalid/saved.png");
    expect(posts).toBe(1);
    expect(receipt).toHaveBeenCalledOnce();
    expect(JSON.parse(receipt.mock.calls[0][0].body).usage.output_tokens).toBe(
      17
    );
  }
);

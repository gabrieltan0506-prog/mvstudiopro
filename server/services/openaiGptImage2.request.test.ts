import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { postOpenAiGptImage2AndUpload } from "./openaiGptImage2";

vi.mock("./openaiImageKeyPool.js", () => ({
  resolveOpenAiImageKeyChain: () => [{ key: "test-key", slot: "test" }],
  shouldRetryOpenAiImageWithOtherKey: () => false,
}));
const { store } = vi.hoisted(() => ({ store: vi.fn() }));
vi.mock("./evolinkGptImage2.js", () => ({ uploadBufferToPlatformStorage: store }));
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

const models = ["gpt-image-2.5-flare", "gpt-image-2.5-sunburst",
  "gpt-image-2.5-flare-2026-09-08", "gpt-image-2.5-sunburst-2026-09-08",
  "gpt-image-2", "gpt-image-2-2026-04-21"];

describe("官方图片请求体参数兼容", () => {
  it.each(models)("%s 改图不发送input_fidelity，图片、蒙版与质量保留", async (model) => {
    vi.stubEnv("OPENAI_GPT_IMAGE2_MODEL", model);
    vi.stubEnv("OPENAI_GPT_IMAGE2_INPUT_FIDELITY", "low");
    const png = await sharp({ create: { width: 64, height: 64, channels: 4, background: "red" } }).png().toBuffer();
    let form: FormData | undefined;
    let posts = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "https://test.invalid/ref" || url === "https://test.invalid/mask") return new Response(new Uint8Array(png));
      expect(new URL(url).pathname).toBe("/v1/images/edits");
      posts++;
      form = await new Response(init!.body, { headers: init!.headers }).formData();
      if (form.has("input_fidelity")) return Response.json({ error: { message: "model does not support input_fidelity" } }, { status: 400 });
      return Response.json({ data: [{ b64_json: png.toString("base64") }] });
    }));
    store.mockResolvedValue("https://test.invalid/result.png");
    const flowLog: string[] = [];
    const result = await postOpenAiGptImage2AndUpload("修复旧照片，保留人物身份与构图", "home-photo-restored", {
      imageUrls: ["https://test.invalid/ref"], maskUrl: "https://test.invalid/mask", size: "1024x1024",
      quality: "high", inputFidelity: "high", flowLog,
    });
    expect(result).toBe("https://test.invalid/result.png");
    expect(posts).toBe(1);
    expect(form!.has("input_fidelity")).toBe(false);
    expect(form!.get("model")).toBe(model);
    expect(form!.get("quality")).toBe("high");
    expect(form!.get("size")).toBe("1024x1024");
    expect(form!.get("output_format")).toBe("png");
    expect(form!.get("prompt")).toContain("保留人物身份与构图");
    const reference = form!.get("image[]") as File;
    expect((await sharp(Buffer.from(await reference.arrayBuffer())).metadata()).width).toBe(1024);
    expect(Buffer.from(await (form!.get("mask") as File).arrayBuffer())).toEqual(png);
    expect(store).toHaveBeenCalledWith(png, "home-photo-restored", flowLog);
    expect(flowLog.join("\n")).not.toMatch(/input_fidelity=(high|low)/);
  });

  it("文生图仍用generations且失败不存假结果", async () => {
    vi.stubEnv("OPENAI_GPT_IMAGE2_MODEL", "gpt-image-2.5-flare");
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      expect(new URL(url).pathname).toBe("/v1/images/generations");
      expect(JSON.parse(String(init!.body))).toMatchObject({ model: "gpt-image-2.5-flare", quality: "high", size: "1024x1024" });
      expect(JSON.parse(String(init!.body))).not.toHaveProperty("input_fidelity");
      return Response.json({ error: { message: "test upstream rejection" } }, { status: 400 });
    });
    vi.stubGlobal("fetch", fetcher);
    const captureError: { message?: string } = {};
    expect(await postOpenAiGptImage2AndUpload("测试图片", "test", { size: "1024x1024", quality: "high", captureError })).toBeNull();
    expect(captureError.message).toContain("test upstream rejection");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(store).not.toHaveBeenCalled();
  });
});

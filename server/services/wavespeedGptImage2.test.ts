import { afterEach, describe, expect, it, vi } from "vitest";
import { SubmitUnknownError } from "./submitOutcomeErrors";
import {
  WAVESPEED_GPT_IMAGE2_EDIT_PATH,
  WAVESPEED_GPT_IMAGE2_T2I_PATH,
  buildWavespeedGptImage2Body,
  normalizeWavespeedGptImage2Resolution,
  postWavespeedGptImage2AndUpload,
} from "./wavespeedGptImage2";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("wavespeedGptImage2", () => {
  it("无参考图走 text-to-image，有参考图走 edit；字段是比例+resolution+quality，没有像素 size", () => {
    const t2i = buildWavespeedGptImage2Body({ prompt: "p", aspectRatio: "16:9", resolution: "4k", quality: "high" });
    expect(t2i.path).toBe(WAVESPEED_GPT_IMAGE2_T2I_PATH);
    expect(t2i.body).toEqual({ prompt: "p", aspect_ratio: "16:9", resolution: "4k", quality: "high", output_format: "png" });
    expect("size" in t2i.body).toBe(false);
    const edit = buildWavespeedGptImage2Body({ prompt: "p", aspectRatio: "9:16", resolution: "2k", quality: "medium", imageUrls: ["https://x/a.png", " ", "https://x/b.png"] });
    expect(edit.path).toBe(WAVESPEED_GPT_IMAGE2_EDIT_PATH);
    expect(edit.body.images).toEqual(["https://x/a.png", "https://x/b.png"]);
  });
  it("resolution 归一化：EvoLink 口径的 4K → 4k，未知 → 2k", () => {
    expect(normalizeWavespeedGptImage2Resolution("4K")).toBe("4k");
    expect(normalizeWavespeedGptImage2Resolution(undefined)).toBe("2k");
    expect(normalizeWavespeedGptImage2Resolution("8k")).toBe("2k");
  });
  it("带遮罩直接跳过（edit 端点无 mask），不发请求，原因写进 captureError", async () => {
    vi.stubEnv("WAVESPEED_API_KEY", "k");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const err: { message?: string } = {};
    const out = await postWavespeedGptImage2AndUpload("p", "sub", { imageUrls: ["https://x/a.png"], maskUrl: "https://x/m.png", captureError: err });
    expect(out).toBeNull();
    expect(err.message).toMatch(/遮罩/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("未配置密钥直接跳过", async () => {
    vi.stubEnv("WAVESPEED_API_KEY", "");
    expect(await postWavespeedGptImage2AndUpload("p", "sub", {})).toBeNull();
  });
  it("提交结果未知（POST 超时/5xx）时上抛 unknown，不回 null 让上层回落双花", async () => {
    vi.stubEnv("WAVESPEED_API_KEY", "k");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("socket hang up"); }));
    await expect(postWavespeedGptImage2AndUpload("p", "sub", {})).rejects.toBeInstanceOf(SubmitUnknownError);
  });
  it("明确 4xx 拒绝回 null（可换下一家）", async () => {
    vi.stubEnv("WAVESPEED_API_KEY", "k");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "bad prompt" }), { status: 422 })));
    const err: { message?: string } = {};
    expect(await postWavespeedGptImage2AndUpload("p", "sub", { captureError: err })).toBeNull();
    expect(err.message).toMatch(/bad prompt/);
  });
});

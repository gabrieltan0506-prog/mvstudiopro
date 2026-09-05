import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  render: vi.fn(),
  put: vi.fn(),
  readFile: vi.fn(),
  rm: vi.fn(),
  mkdtemp: vi.fn(),
}));
vi.mock("./renderSourceAudio.js", () => ({ renderSourceAudioFinal: mocks.render }));
vi.mock("@vercel/blob", () => ({ put: mocks.put }));
vi.mock("node:fs", () => ({ promises: { readFile: mocks.readFile, rm: mocks.rm, mkdtemp: mocks.mkdtemp } }));
import { renderWorkflowFinalVideo } from "./render";

describe("原声合成的上传与失败清理", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("MVSP_READ_WRITE_TOKEN", "test-key");
    mocks.mkdtemp.mockResolvedValue("/test-only/manhua-render-job");
    mocks.render.mockResolvedValue("/test-only/manhua-render-job/final.mp4");
    mocks.readFile.mockResolvedValue(Buffer.from("test-media"));
    mocks.put.mockResolvedValue({ url: "https://test.invalid/final.mp4" });
    mocks.rm.mockResolvedValue(undefined);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("上传成功后返回真实上传器结果，且只清理本次独占目录", async () => {
    const input = { preserveSourceAudio: true, sceneVideos: [{ sceneIndex: 1, url: "https://test.invalid/input.mp4", duration: "10s" }], resolution: "720x1280" };
    expect(await renderWorkflowFinalVideo(input)).toBe("https://test.invalid/final.mp4");
    expect(mocks.render).toHaveBeenCalledWith(input, { width: 720, height: 1280 }, "/test-only/manhua-render-job");
    expect(mocks.put).toHaveBeenCalledWith(expect.stringMatching(/^renders\//), Buffer.from("test-media"), expect.objectContaining({ token: "test-key", contentType: "video/mp4" }));
    expect(mocks.rm).toHaveBeenCalledOnce();
    expect(mocks.rm).toHaveBeenCalledWith("/test-only/manhua-render-job", { recursive: true, force: true });
  });

  it.each(["render", "put"] as const)("%s 失败不假报成片，保留原始错误并清理临时媒体", async (phase) => {
    mocks[phase].mockRejectedValueOnce(new Error("test-failure"));
    await expect(renderWorkflowFinalVideo({ preserveSourceAudio: true, sceneVideos: [] })).rejects.toThrow("test-failure");
    expect(mocks.rm).toHaveBeenCalledOnce();
    if (phase === "render") expect(mocks.put).not.toHaveBeenCalled();
  });
});

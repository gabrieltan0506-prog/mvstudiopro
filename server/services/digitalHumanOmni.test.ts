import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const f = vi.hoisted(() => ({
  resolve: vi.fn(),
  download: vi.fn(),
  audio: vi.fn(),
  quote: vi.fn(),
  create: vi.fn(),
  peek: vi.fn(),
}));
vi.mock("./postProdMediaSource", () => ({
  resolveRegisteredPostProdMediaSource: f.resolve,
}));
vi.mock("./postProduction", () => ({
  fetchPostProdSourceToFile: f.download,
  probeAudio: f.audio,
}));
vi.mock("./gcs", () => ({
  signGsUriV4ReadUrl: (uri: string) =>
    `https://example.test/${encodeURIComponent(uri)}`,
}));
vi.mock("./wavespeedOmniHuman", () => ({ quoteWavespeedOmniHuman: f.quote }));
vi.mock("./canvasVideoTask", () => ({
  createCanvasVideoTask: f.create,
  peekCanvasVideoTask: f.peek,
}));
vi.mock("sharp", () => ({
  default: () => ({
    metadata: async () => ({ width: 640, height: 960, format: "png" }),
    stats: async () => ({}),
  }),
}));
import {
  prepareDigitalHumanOmni,
  quoteDigitalHumanOmni,
  queueDigitalHumanOmni,
  getDigitalHumanOmni,
} from "./digitalHumanOmni";

const input = {
  image: "gs://test-bucket/uploads/u7/p.png",
  audio: "gs://test-bucket/post-prod/7/a.wav",
  prompt: "测试人物自然讲述",
};
const requestId = "20000000-0000-4000-8000-000000000001";
let dir: string;
beforeEach(async () => {
  Object.values(f).forEach(mock => mock.mockReset());
  dir = await mkdtemp(join(tmpdir(), "omni-intent-test-"));
  vi.stubEnv("CANVAS_VIDEO_TASK_DIR", dir);
  f.resolve.mockImplementation(async ({ source }) => source);
  f.download.mockImplementation(async (_source, file) =>
    writeFile(file, "fictional-test-media-bytes")
  );
  f.audio.mockResolvedValue(45);
  f.quote.mockResolvedValue({
    priceUsd: 4.5,
    discountedPriceUsd: 4.5,
    evidence: {},
  });
  f.create.mockImplementation(async value => ({ ...value, status: "running" }));
  f.peek.mockResolvedValue(null);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});
async function submission() {
  return {
    ...input,
    requestId,
    confirmed: true,
    quote: (await quoteDigitalHumanOmni(7, input)).quote,
  };
}

describe("数字人口播服务端输入、报价与原单恢复", () => {
  it("校验本人两项素材，真实时长进入完整报价，核价不创建任务", async () => {
    const result = await quoteDigitalHumanOmni(7, input);
    expect(result.quote).toMatchObject({
      durationSec: 45,
      priceUsd: 4.5,
      discountedPriceUsd: 4.5,
    });
    expect(f.resolve.mock.calls).toEqual([
      [{ userId: "7", source: input.image }],
      [{ userId: "7", source: input.audio }],
    ]);
    expect(f.quote).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 7 }),
      expect.objectContaining({
        image: expect.stringContaining("https://"),
        audio: expect.stringContaining("https://"),
        prompt: input.prompt,
      })
    );
    expect(f.create).not.toHaveBeenCalled();
  });
  it("归属失败或者音频超出300秒时不查询费用也不创建视频", async () => {
    f.resolve.mockRejectedValueOnce(new Error("不属于当前账号"));
    await expect(prepareDigitalHumanOmni(7, input)).rejects.toThrow(
      "不属于当前账号"
    );
    f.audio.mockResolvedValue(301);
    await expect(quoteDigitalHumanOmni(7, input)).rejects.toThrow("4至300秒");
    expect(f.quote).not.toHaveBeenCalled();
    expect(f.create).not.toHaveBeenCalled();
  });
  it("同一请求并发只有一个任务，永久身份与费用上限进入异步任务", async () => {
    const request = await submission();
    await Promise.all([
      queueDigitalHumanOmni(7, request),
      queueDigitalHumanOmni(7, request),
    ]);
    expect(f.create).toHaveBeenCalledTimes(1);
    expect(f.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 7,
        engine: "omnihuman2-wavespeed",
        creditsCharged: 0,
        omni: expect.objectContaining({
          image: input.image,
          audio: input.audio,
          durationSec: 45,
          requestId,
          maxPriceUsd: 4.5,
        }),
      })
    );
    await queueDigitalHumanOmni(7, request);
    expect(f.create).toHaveBeenCalledTimes(1);
    await expect(
      queueDigitalHumanOmni(7, { ...request, prompt: "另一内容" })
    ).rejects.toThrow("其他输入");
  });
  it("费用上涨在占位内记录明确未提交，刷新恢复失败结果而不重新生成", async () => {
    const request = await submission();
    f.quote.mockResolvedValue({ priceUsd: 5, discountedPriceUsd: 5 });
    expect(await queueDigitalHumanOmni(7, request)).toMatchObject({
      status: "failed",
      error: expect.stringContaining("高于"),
    });
    expect(await getDigitalHumanOmni(7, requestId)).toMatchObject({
      status: "failed",
    });
    await queueDigitalHumanOmni(7, request);
    expect(f.create).not.toHaveBeenCalled();
    expect(f.quote).toHaveBeenCalledTimes(2);
  });
  it("创建回执异常后保持原占位，不从头重建任务", async () => {
    const request = await submission();
    f.create.mockRejectedValueOnce(new Error("response lost"));
    await expect(queueDigitalHumanOmni(7, request)).rejects.toThrow(
      "response lost"
    );
    expect(await queueDigitalHumanOmni(7, request)).toMatchObject({
      status: "reconcile_manual",
    });
    expect(f.create).toHaveBeenCalledTimes(1);
    expect(await getDigitalHumanOmni(8, requestId)).toBeNull();
  });
});

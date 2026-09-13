import { afterEach, expect, it, vi } from "vitest";
vi.mock("./longJobsFlyOrigin", () => ({
  withLongJobsFlyDirect: (url: string) => url,
}));
import {
  probeVideoDurationSec,
  startVideoUpscale,
  VideoUpscaleSubmitError,
} from "./videoUpscaleApi";
import { parsePhotoVideoMetadata } from "../../../server/services/photoMediaInput";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it.each([0.2, 10.08, 10.51, 15.072])(
  "旧画布/工坊probe与API计费契约一致 %s",
  async duration => {
    vi.useFakeTimers();
    const video = {
      duration,
      onloadedmetadata: null as null | (() => void),
      onerror: null,
      src: "",
      preload: "",
      crossOrigin: "",
    };
    vi.stubGlobal("document", { createElement: () => video });
    vi.stubGlobal("window", { setTimeout });
    const result = probeVideoDurationSec("https://example.com/a.mp4");
    video.onloadedmetadata?.();
    const measured = parsePhotoVideoMetadata(
      JSON.stringify({
        format: { duration },
        streams: [{ codec_type: "video", width: 1280, height: 720 }],
      })
    );
    expect(await result).toBe(measured.durationSec);
  }
);
it.each([400, 401, 402, 403, 409, 502, 503])(
  "提交错误保留HTTP状态，仅明确拒绝可重试 %s",
  async status => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status,
        json: async () => ({ ok: false, error: "拒绝" }),
      }))
    );
    const e = await startVideoUpscale({
      videoUrl: "https://example.com/a.mp4",
      target: "2k",
      durationSec: 10,
    }).catch(e => e);
    expect(e).toBeInstanceOf(VideoUpscaleSubmitError);
    expect(e.httpStatus).toBe(status);
    expect(e.definitelyNotStarted).toBe(status < 500);
  }
);
it("代理错误页和网络中断不能认作明确未提交", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => {
        throw new Error("HTML");
      },
    }))
  );
  const input = {
    videoUrl: "https://example.com/a.mp4",
    target: "2k" as const,
    durationSec: 10,
  };
  expect(
    (await startVideoUpscale(input).catch(e => e)).definitelyNotStarted
  ).toBe(false);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("失联");
    })
  );
  await expect(startVideoUpscale(input)).rejects.toThrow("失联");
});

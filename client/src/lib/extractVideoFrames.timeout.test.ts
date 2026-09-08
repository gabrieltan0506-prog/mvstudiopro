import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  VIDEO_FRAME_LOAD_TIMEOUT_MS,
  extractVideoTailFramesFromUrl,
} from "./extractVideoFrames";

/** 假 <video>：永不触发 loadedmetadata，复现跨域签名视频拿不到元数据的挂死场景。 */
function fakeVideoElement() {
  return {
    crossOrigin: "",
    muted: false,
    playsInline: false,
    preload: "",
    src: "",
    duration: 0,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    removeAttribute: vi.fn(),
    load: vi.fn(),
  };
}

describe("extractVideoTailFramesFromUrl 超时", () => {
  const video = fakeVideoElement();
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("document", { createElement: vi.fn(() => video) });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("元数据永不回调时在硬超时后拒绝，并释放 video，不再无限挂起", async () => {
    let state = "pending";
    const settled = extractVideoTailFramesFromUrl(
      "https://test.invalid/previs.mp4",
      {
        frameCount: 2,
        tailWindowSec: 4,
      }
    ).then(
      () => {
        state = "resolved";
      },
      (error: Error) => {
        state = `rejected:${error.message}`;
      }
    );
    await vi.advanceTimersByTimeAsync(VIDEO_FRAME_LOAD_TIMEOUT_MS - 5);
    expect(state).toBe("pending");
    await vi.advanceTimersByTimeAsync(10);
    await settled;
    expect(state).toBe(
      `rejected:video_load_timeout_${VIDEO_FRAME_LOAD_TIMEOUT_MS}ms`
    );
    expect(video.removeAttribute).toHaveBeenCalledWith("src");
    expect(video.load).toHaveBeenCalledTimes(1);
  });
});

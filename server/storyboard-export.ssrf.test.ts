import { afterEach, beforeEach, expect, it, vi } from "vitest";

/** 1111：分镜导出代取图片只限本站与自有存储；站内地址跳转时逐跳复核。离线替身，不发真实请求。 */
const h = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock("axios", () => ({ default: { get: h.get } }));
vi.mock("./storage", () => ({ storagePut: h.put, storageGet: vi.fn() }));
import { exportToPDF } from "./storyboard-export";

const board = (urls: string[]) => ({
  title: "t",
  musicInfo: { bpm: 100, emotion: "e", style: "s", key: "C" },
  scenes: [{ sceneNumber: 1, timestamp: "0", duration: "5s", description: "d", cameraMovement: "c", mood: "m", visualElements: [], previewImageUrls: urls }],
  summary: "s",
});

beforeEach(() => {
  h.get.mockReset().mockRejectedValue(new Error("offline"));
  h.put.mockReset().mockResolvedValue({ key: "k", url: "https://x/out.pdf" });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

it("站外 / 内网图片地址不发起请求", async () => {
  await exportToPDF(board(["http://169.254.169.254/x", "https://evil.example/a.png", "https://10.0.0.1/a.png"]) as never, { addWatermark: true }).catch(() => null);
  expect(h.get).not.toHaveBeenCalled();
});

it("自有地址发起请求，且带跳转复核：跳到站外即中止", async () => {
  await exportToPDF(board(["https://www.mvstudiopro.com/api/canvas-media/a.png"]) as never, { addWatermark: true }).catch(() => null);
  expect(h.get).toHaveBeenCalledTimes(1);
  const opts = h.get.mock.calls[0][1];
  expect(opts.maxRedirects).toBe(3);
  expect(() => opts.beforeRedirect({ href: "http://169.254.169.254/latest" })).toThrow();
  expect(() => opts.beforeRedirect({ href: "https://storage.googleapis.com/mv-studio-pro-vertex-video-temp/a.png?X-Goog-Signature=1" })).not.toThrow();
});

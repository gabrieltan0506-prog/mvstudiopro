import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ owned: vi.fn(), fetch: vi.fn(), probe: vi.fn() }));
vi.mock("./postProdMediaSource", () => ({ resolveRegisteredPostProdMediaSource: mocks.owned }));
vi.mock("./postProduction", () => ({ fetchPostProdSourceToFile: mocks.fetch, probeAudio: mocks.probe }));
import { inspectDigitalHumanNarration } from "./digitalHumanRecording";
describe("本人完整旁白服务端核验", () => {
 it("使用归属核验后的持久地址和真实时长，不采信客户端时长", async () => {
  mocks.owned.mockResolvedValue("gs://test/uploads/u7/a.wav"); mocks.probe.mockResolvedValue(92.75);
  expect(await inspectDigitalHumanNarration("7", "https://example.test/source")).toEqual({ source: "gs://test/uploads/u7/a.wav", durationSec: 92.75 });
  expect(mocks.owned).toHaveBeenLastCalledWith({ userId: "7", source: "https://example.test/source" });
  expect(mocks.fetch.mock.calls.at(-1)?.[0]).toBe("gs://test/uploads/u7/a.wav");
 });
 it("跨账号素材先拒绝，不下载；无效时长不采用", async () => {
  mocks.fetch.mockClear(); mocks.owned.mockRejectedValueOnce(new Error("素材不属于当前账号"));
  await expect(inspectDigitalHumanNarration("8", "gs://other/a.wav")).rejects.toThrow("当前账号");
  expect(mocks.fetch).not.toHaveBeenCalled();
  for (const seconds of [2, 301]) { mocks.probe.mockResolvedValue(seconds); await expect(inspectDigitalHumanNarration("7", "gs://test/a.wav")).rejects.toThrow("3秒至5分钟"); }
 });
});

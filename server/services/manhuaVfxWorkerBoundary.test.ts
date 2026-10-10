import { afterEach, expect, it, vi } from "vitest";
import { renderManhuaVfx } from "./manhuaVfxRender";
afterEach(() => vi.unstubAllEnvs());
it("生产机在下载、证据上传和渲染之前拒绝特效执行", async () => {
  vi.stubEnv("JOB_WORKER_ROLE", "app");
  vi.stubEnv("FLY_MACHINE_ID", "test-production");
  vi.stubEnv("MANHUA_HEAVY_MACHINE_ID", "test-worker");
  const effect = vi.fn();
  await expect(renderManhuaVfx({}, "test-user", new AbortController().signal, {
    fetch: effect, upload: effect, runMedia: effect, runBlender: effect, uploadResult: effect,
  })).rejects.toThrow("不回退生产机");
  expect(effect).not.toHaveBeenCalled();
});

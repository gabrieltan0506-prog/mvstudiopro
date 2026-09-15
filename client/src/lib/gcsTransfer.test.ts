import { afterEach, expect, it, vi } from "vitest";
import { gcsTransferUrl } from "./gcsTransfer";
import { downloadRemoteFile } from "./downloadRemoteFile";
afterEach(() => vi.unstubAllGlobals());
it("非GCS本地与旧Blob保持原路径", () => {
  expect(gcsTransferUrl("blob:local")).toBe("blob:local");
  expect(gcsTransferUrl("https://example.test/a")).toBe(
    "https://example.test/a"
  );
});
it("下载失败不偷偷退回GCS直连或新开窗口", async () => {
  const open = vi.fn();
  vi.stubGlobal("window", { location: { hostname: "mvstudiopro.com" }, open });
  const f = vi.fn(
    async (_u: unknown, _o: unknown) => new Response("expired", { status: 403 })
  );
  vi.stubGlobal("fetch", f);
  const u = "https://storage.googleapis.com/test/file.zip";
  await expect(downloadRemoteFile(u, "archive")).rejects.toThrow("403");
  expect(f.mock.calls[0][0]).toBe(
    `https://api.mvstudiopro.com/api/gcs-transfer?url=${encodeURIComponent(u)}`
  );
  expect(open).not.toHaveBeenCalled();
});

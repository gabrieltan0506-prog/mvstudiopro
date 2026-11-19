// 审查回归（1120）：生产租约存储读取与心跳改写竞态——取 generation 与按 generation 下载之间对象被改写，不算读错。
import { expect, it, vi } from "vitest";
const g = vi.hoisted(() => ({ download: vi.fn() }));
vi.mock("./gcs", async importOriginal => ({ ...await importOriginal<any>(), downloadGcsObjectVersioned: g.download, getGcsBucketName: () => "test" }));
import { gcsTaskStore } from "./knowledgePublicationExportTasks";

it("取到 generation 后对象被改写（按旧 generation 下载 404）：重读最新版本，不让等待中的导出失败", async () => {
  g.download.mockReset()
    .mockRejectedValueOnce(Error("gcs_download_failed:404"))
    .mockResolvedValueOnce({ buffer: Buffer.from(JSON.stringify({ holder: "A", status: "running" })), generation: "8" });
  const store = await gcsTaskStore();
  expect(await store.read("x.json")).toEqual({ value: { holder: "A", status: "running" }, generation: "8" });
  expect(g.download).toHaveBeenCalledTimes(2);
});
it("对象不存在仍为 null；其他读错照常抛出；一直 404 有上限", async () => {
  const store = await gcsTaskStore();
  g.download.mockReset().mockRejectedValue(Error("gcs_stat_failed:404"));
  expect(await store.read("x.json")).toBeNull();
  g.download.mockReset().mockRejectedValue(Error("gcs_stat_failed:503"));
  await expect(store.read("x.json")).rejects.toThrow("503");
  g.download.mockReset().mockRejectedValue(Error("gcs_download_failed:404"));
  await expect(store.read("x.json")).rejects.toThrow("gcs_download_failed:404");
  expect(g.download).toHaveBeenCalledTimes(5);
});

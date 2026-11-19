// 1119 E1：审校读图按 generation 锁版本、带回版本元数据；指纹只建不改，写失败不影响读图。
import { beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
const g = vi.hoisted(() => ({ stat: vi.fn(), inspect: vi.fn(), create: vi.fn() }));
vi.mock("./gcs", async importOriginal => ({ ...await importOriginal<any>(), statGcsObjectVersion: g.stat, inspectGcsObjectBounded: g.inspect, uploadBufferToGcsIfAbsent: g.create, getGcsBucketName: () => "test" }));
import { knowledgeImageFingerprintName, parseKnowledgeImageFingerprint, readKnowledgeImage, recordKnowledgeImageFingerprint } from "./knowledgePublicationAdvisor";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
const sha = createHash("sha256").update(png).digest("hex");
const serve = (generation?: string) => async (p: any) => { p.onChunk(png); return { bucket: "test", objectName: "x.png", byteLength: png.length, header: png.subarray(0, 12), sha256: sha, ...(p.generation ? { generation: p.generation } : {}) }; };
beforeEach(() => { g.stat.mockReset(); g.inspect.mockReset(); g.create.mockReset(); });

it("先取版本再锁该 generation 下载：带回 generation / crc32c / 字节数", async () => {
  g.stat.mockResolvedValue({ bucket: "test", objectName: "x.png", generation: "55", crc32c: "AAA=", byteLength: png.length });
  g.inspect.mockImplementation(serve());
  const image = await readKnowledgeImage("gs://test/x.png");
  expect(g.inspect.mock.calls[0]![0].generation).toBe("55");
  expect(image).toMatchObject({ sha256: sha, generation: "55", crc32c: "AAA=", byteLength: png.length, width: 1, height: 1 });
});
it("下载时对象已换版（412）：退回原先不锁版本下载，不带版本（不记指纹）", async () => {
  g.stat.mockResolvedValue({ generation: "55", byteLength: png.length });
  g.inspect.mockImplementationOnce(async () => { throw Error("gcs_download_failed:412"); }).mockImplementation(serve());
  const image = await readKnowledgeImage("gs://test/x.png");
  expect(g.inspect).toHaveBeenCalledTimes(2);
  expect(g.inspect.mock.calls[1]![0].generation).toBeUndefined();
  expect(image.sha256).toBe(sha);
  expect((image as any).generation).toBeUndefined();
});
it("取版本失败：与原先一样不锁版本下载；其他下载错误照常抛出", async () => {
  g.stat.mockRejectedValue(Error("fetch failed"));
  g.inspect.mockImplementation(serve());
  expect((await readKnowledgeImage("gs://test/x.png") as any).generation).toBeUndefined();
  g.stat.mockResolvedValue({ generation: "55", byteLength: png.length });
  g.inspect.mockReset().mockRejectedValue(Error("gcs_download_too_large"));
  await expect(readKnowledgeImage("gs://test/x.png")).rejects.toThrow("too_large");
});
it("登记大小与实读字节数不符：不带版本", async () => {
  g.stat.mockResolvedValue({ generation: "55", byteLength: png.length + 1 });
  g.inspect.mockImplementation(serve());
  expect((await readKnowledgeImage("gs://test/x.png") as any).generation).toBeUndefined();
});
it("指纹按 (对象, generation) 条件创建；无版本不写；写失败返回 false 不抛", async () => {
  g.create.mockResolvedValue({ created: true });
  expect(await recordKnowledgeImageFingerprint("gs://test/x.png", { sha256: sha, generation: "55", crc32c: "AAA=", byteLength: 68 })).toBe(true);
  const [args] = g.create.mock.calls[0]!;
  expect(args.objectName).toBe(knowledgeImageFingerprintName("gs://test/x.png", "55"));
  const saved = JSON.parse(args.buffer.toString("utf8"));
  expect(parseKnowledgeImageFingerprint(saved, "gs://test/x.png", "55")).toMatchObject({ sha256: sha, byteLength: 68, crc32c: "AAA=" });
  expect(parseKnowledgeImageFingerprint(saved, "gs://test/y.png", "55")).toBeUndefined();
  expect(parseKnowledgeImageFingerprint(saved, "gs://test/x.png", "56")).toBeUndefined();
  expect(await recordKnowledgeImageFingerprint("gs://test/x.png", { sha256: sha })).toBe(false);
  expect(g.create).toHaveBeenCalledTimes(1);
  g.create.mockRejectedValue(Error("gcs_conditional_upload_failed:503"));
  expect(await recordKnowledgeImageFingerprint("gs://test/x.png", { sha256: sha, generation: "55", byteLength: 68 })).toBe(false);
});

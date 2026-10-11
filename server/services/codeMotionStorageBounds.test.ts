import { expect, it, vi } from "vitest";

const backing = vi.hoisted(() => ({ body: Buffer.from("{}"), generation: "1" }));
const upload = vi.hoisted(() => vi.fn(async ({ buffer }: { buffer: Buffer }) => {
  backing.body = Buffer.from(buffer);
  backing.generation = String(Number(backing.generation) + 1);
  return { generation: backing.generation };
}));
vi.mock("./gcs", () => ({
  getGcsBucketName: () => "test-bucket",
  statGcsObjectVersion: async () => ({ generation: backing.generation }),
  inspectGcsObjectBounded: async ({ maxBytes, onChunk }: { maxBytes: number; onChunk: (b: Buffer) => void }) => {
    if (backing.body.length > maxBytes) throw Error("超过读取上限");
    onChunk(backing.body);
  },
  uploadBufferToGcs: upload,
  listGcsObjectNamesByPrefix: async () => [],
}));
import { codeMotionStorage, CODE_MOTION_PROJECT_MAX_BYTES } from "./codeMotionStore";

it("共用台账写入超过读取上限时不上传，原记录仍可恢复；边界大小可读写", async () => {
  const name = "code-motion/u7/revisions/test.json";
  const valid = Buffer.from('"' + "x".repeat(CODE_MOTION_PROJECT_MAX_BYTES - 2) + '"');
  const generation = await codeMotionStorage.write(name, valid, "1");
  expect((await codeMotionStorage.read(name))?.body).toEqual(valid);
  await expect(codeMotionStorage.write(name, Buffer.alloc(CODE_MOTION_PROJECT_MAX_BYTES + 1), generation))
    .rejects.toThrow("原版本已保留");
  expect(upload).toHaveBeenCalledTimes(1);
  const restored = await codeMotionStorage.read(name);
  expect(restored?.body).toEqual(valid);
  expect(restored?.generation).toBe(generation);
});

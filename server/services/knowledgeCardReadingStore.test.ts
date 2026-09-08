import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ inspect: vi.fn(), upload: vi.fn() }));
vi.mock("./gcs.js", () => ({ getGcsBucketName: () => "test-bucket", inspectGcsObjectBounded: mocks.inspect, uploadBufferToGcsIfAbsent: mocks.upload }));
import { readKnowledgeReadingObject, saveKnowledgeReadingObject, claimKnowledgeReadingCall, knowledgeReadingPrefix } from "./knowledgeCardReadingStore";
describe("阅读证据不可变存储", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.upload.mockResolvedValue({ created: true }); });
  it("只将确切404视为不存在，其余故障保持失败", async () => {
    mocks.inspect.mockRejectedValueOnce(new Error("gcs_download_failed:404"));
    expect(await readKnowledgeReadingObject("test/object")).toBeNull();
    for (const message of ["gcs_download_failed:403", "timeout", "prefix gcs_download_failed:404"]) {
      mocks.inspect.mockRejectedValueOnce(new Error(message));
      await expect(readKnowledgeReadingObject("test/object")).rejects.toThrow(message);
    }
  });
  it("相同内容可复用，不同内容不能覆盖", async () => {
    mocks.upload.mockResolvedValue({ created: false }); mocks.inspect.mockImplementation(async ({ onChunk }) => onChunk(Buffer.from("原证据")));
    expect(await saveKnowledgeReadingObject("test/object", Buffer.from("原证据"))).toMatchObject({ gcsUri: "gs://test-bucket/test/object" });
    await expect(saveKnowledgeReadingObject("test/object", Buffer.from("不同证据"))).rejects.toThrow("身份冲突");
  });
  it("请求占用只接受首次创建", async () => {
    expect(await claimKnowledgeReadingCall("test/claim")).toBe(true);
    mocks.upload.mockResolvedValue({ created: false }); expect(await claimKnowledgeReadingCall("test/claim")).toBe(false);
  });
  it("拒绝非法账号路径", () => {
    for (const id of [0, -1, 1.5, NaN, Infinity]) expect(() => knowledgeReadingPrefix(id)).toThrow();
    expect(knowledgeReadingPrefix(7)).toBe("knowledge-card-reading/u7/");
  });
});

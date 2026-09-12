import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertCompletedManhuaLocalVideoUpload,
  MANHUA_LOCAL_VIDEO_CHUNK_BYTES,
  MANHUA_LOCAL_VIDEO_MAX_BYTES,
  MANHUA_LOCAL_VIDEO_UPLOAD_PATH,
  parseManhuaLocalVideoUpload,
  uploadManhuaLocalVideo,
  type ManhuaLocalVideoUpload,
  type ManhuaLocalVideoUploadAttempt,
} from "./manhuaLocalVideoUpload";

const uploadId = "12345678-1234-4123-8123-123456789abc";
const sha256 = "a".repeat(64);
const complete = { uploadId, status: "completed", fileName: "原片.mp4", bytes: 3, offset: 3,
  sha256, durationSec: 12.5, sourceRef: `manhua-upload://u7/${uploadId}/${sha256}` };

function serverFor(file: File) {
  let row: ManhuaLocalVideoUpload = { uploadId, status: "uploading", fileName: file.name, bytes: file.size, offset: 0 };
  const chunks: Buffer[] = [];
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let losePutResponse = false;
  let loseCompleteResponse = false;
  const request = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    expect(url.startsWith(MANHUA_LOCAL_VIDEO_UPLOAD_PATH)).toBe(true);
    expect(init.credentials).toBe("same-origin");
    expect(new Headers(init.headers).get("X-Manhua-Upload")).toBe("1");
    init.signal?.throwIfAborted();
    if (init.method === "PUT") {
      const offset = Number(new URL(url, "https://test.invalid").searchParams.get("offset"));
      expect(offset).toBe(row.offset);
      expect(init.body).toBeInstanceOf(Blob);
      const bytes = Buffer.from(await (init.body as Blob).arrayBuffer());
      expect(bytes.length).toBeLessThanOrEqual(MANHUA_LOCAL_VIDEO_CHUNK_BYTES);
      chunks.push(bytes);
      row = { ...row, offset: row.offset + bytes.length };
      if (losePutResponse) { losePutResponse = false; throw new TypeError("test-lost-ack"); }
    } else if (url.endsWith("/complete")) {
      const digest = createHash("sha256").update(Buffer.concat(chunks)).digest("hex");
      row = { ...row, status: "completed", sha256: digest, durationSec: 21.25,
        sourceRef: `manhua-upload://u7/${uploadId}/${digest}` };
      if (loseCompleteResponse) { loseCompleteResponse = false; throw new TypeError("test-lost-complete"); }
    }
    return new Response(JSON.stringify(row), { status: 200 });
  });
  return { request, calls, chunks,
    losePut: () => { losePutResponse = true; },
    loseComplete: () => { loseCompleteResponse = true; } };
}

afterEach(() => vi.restoreAllMocks());

describe("本地原片仅分块上传到同源服务器", () => {
  it("2MiB分块无丢尾，进度以服务端偏移为准，完整字节SHA一致", async () => {
    const bytes = Buffer.alloc(2 * MANHUA_LOCAL_VIDEO_CHUNK_BYTES + 17, 9);
    bytes[bytes.length - 1] = 31;
    const file = new File([bytes], "原片.mp4");
    const server = serverFor(file);
    const offsets: number[] = [];
    const result = await uploadManhuaLocalVideo({ file, userKey: "7", request: server.request,
      onCheckpoint: () => {}, onProgress: offset => offsets.push(offset) });
    expect(server.calls.map(call => call.init.method)).toEqual(["POST", "PUT", "PUT", "PUT", "POST"]);
    expect(server.chunks.map(chunk => chunk.length)).toEqual([2_097_152, 2_097_152, 17]);
    expect(Buffer.concat(server.chunks).equals(bytes)).toBe(true);
    expect(result.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(offsets).toEqual([0, 2_097_152, 4_194_304, 4_194_321, 4_194_321]);
  });

  it("分块已被服务器接收但回包丢失，继续同ID先GET偏移，不重复建上传", async () => {
    const file = new File([Buffer.alloc(MANHUA_LOCAL_VIDEO_CHUNK_BYTES + 7, 3)], "原片.mp4");
    const server = serverFor(file);
    let previous: ManhuaLocalVideoUploadAttempt | null = null;
    const options = { file, userKey: "7", request: server.request,
      onCheckpoint: (next: ManhuaLocalVideoUploadAttempt) => { previous = next; }, onProgress: () => {} };
    server.losePut();
    await expect(uploadManhuaLocalVideo(options)).rejects.toThrow("核对原上传进度");
    const result = await uploadManhuaLocalVideo({ ...options, previous });
    expect(result.status).toBe("completed");
    expect(server.calls.filter(call => call.url === MANHUA_LOCAL_VIDEO_UPLOAD_PATH)).toHaveLength(1);
    expect(server.calls[2].init.method).toBe("GET");
    expect(server.calls.filter(call => call.init.method === "PUT").map(call => call.url.split("offset=")[1]))
      .toEqual(["0", String(MANHUA_LOCAL_VIDEO_CHUNK_BYTES)]);
  });

  it("完成回包丢失只查询原ID，已完成视频不会重新上传或重复complete", async () => {
    const file = new File(["真实测试片字节"], "原片.mp4");
    const server = serverFor(file);
    let previous: ManhuaLocalVideoUploadAttempt | null = null;
    const options = { file, userKey: "7", request: server.request,
      onCheckpoint: (next: ManhuaLocalVideoUploadAttempt) => { previous = next; }, onProgress: () => {} };
    server.loseComplete();
    await expect(uploadManhuaLocalVideo(options)).rejects.toThrow("核对原上传进度");
    expect((await uploadManhuaLocalVideo({ ...options, previous })).status).toBe("completed");
    expect(server.calls.map(call => call.init.method)).toEqual(["POST", "PUT", "POST", "GET"]);
  });

  it("暂停后保留原File及上传ID，恢复先核对偏移", async () => {
    const file = new File([Buffer.alloc(MANHUA_LOCAL_VIDEO_CHUNK_BYTES + 1)], "原片.mp4");
    const server = serverFor(file);
    const controller = new AbortController();
    let previous: ManhuaLocalVideoUploadAttempt | null = null;
    await expect(uploadManhuaLocalVideo({ file, userKey: "7", request: server.request, signal: controller.signal,
      onCheckpoint: next => { previous = next; }, onProgress: offset => {
        if (offset) controller.abort(new DOMException("test-pause", "AbortError"));
      } })).rejects.toMatchObject({ name: "AbortError" });
    await uploadManhuaLocalVideo({ file, previous, userKey: "7", request: server.request,
      onCheckpoint: () => {}, onProgress: () => {} });
    expect(server.calls.map(call => call.init.method)).toEqual(["POST", "PUT", "GET", "PUT", "POST"]);
  });

  it("同名同大小同mtime的新File不能拼接旧上传，拒绝发生在任何请求前", async () => {
    const first = new File(["abc"], "原片.mp4", { lastModified: 1 });
    const second = new File(["def"], "原片.mp4", { lastModified: 1 });
    const request = vi.fn();
    await expect(uploadManhuaLocalVideo({ file: second, userKey: "7", request,
      previous: { file: first, upload: { ...complete, status: "uploading", offset: 1 } },
      onCheckpoint: () => {}, onProgress: () => {} })).rejects.toThrow("不能拼接旧上传");
    expect(request).not.toHaveBeenCalled();
  });

  it.each([0, MANHUA_LOCAL_VIDEO_MAX_BYTES + 1])("非法文件大小%d不创建上传", async size => {
    const request = vi.fn();
    await expect(uploadManhuaLocalVideo({ file: { size } as File, userKey: "7", request,
      onCheckpoint: () => {}, onProgress: () => {} })).rejects.toThrow("800MB");
    expect(request).not.toHaveBeenCalled();
  });

  it("缺SHA/错偏移/异账号/尚未完成均不能成为学习来源，不携带服务端路径", () => {
    expect(assertCompletedManhuaLocalVideoUpload(complete, "7").sourceRef).toBe(complete.sourceRef);
    expect(() => assertCompletedManhuaLocalVideoUpload(complete, "8")).toThrow("当前账号");
    expect(() => assertCompletedManhuaLocalVideoUpload({ ...complete, status: "uploading" }, "7")).toThrow("还未完成");
    expect(() => parseManhuaLocalVideoUpload({ ...complete, sha256: undefined })).toThrow("完整校验");
    expect(() => parseManhuaLocalVideoUpload({ ...complete, offset: 2 })).toThrow("完整校验");
    expect(parseManhuaLocalVideoUpload({ ...complete, absolutePath: "/data/private/test" })).not.toHaveProperty("absolutePath");
  });

  it.each([[422, "不是可读取"], [507, "空间不足"], [404, "记录不存在"]] as const)(
    "HTTP %d 返回可行动的固定提示，不展示服务端路径", async (status, expected) => {
      const request = vi.fn(async () => new Response(JSON.stringify({ error: "/data/private/internal-error" }), { status }));
      await expect(uploadManhuaLocalVideo({ file: new File(["abc"], "原片.mp4"), userKey: "7", request,
        onCheckpoint: () => {}, onProgress: () => {} })).rejects.toThrow(expected);
      expect(request).toHaveBeenCalledOnce();
    },
  );
});

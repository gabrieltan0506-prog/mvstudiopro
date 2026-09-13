import { Readable } from "node:stream";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  lookup: vi.fn(),
  chunks: [Buffer.from("hello")],
  pinned: [] as unknown[],
}));
vi.mock("node:dns/promises", () => ({ lookup: state.lookup }));
vi.mock("node:https", () => ({
  default: {
    get: (_url: URL, options: any, callback: any) => {
      options.lookup("example.com", { all: true }, (...args: unknown[]) =>
        state.pinned.push(args)
      );
      const response = Readable.from(state.chunks) as any;
      response.statusCode = 200;
      response.headers = {};
      queueMicrotask(() => callback(response));
      return new EventEmitter();
    },
  },
}));
import { downloadPhotoMedia } from "./photoMediaInput";
describe("安全媒体下载", () => {
  it("请求绑定已验证的DNS地址，不再依赖fetch二次解析", async () => {
    state.lookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
    state.pinned = [];
    state.chunks = [Buffer.from("hello")];
    expect(
      (await downloadPhotoMedia("https://example.com/a", 10)).toString()
    ).toBe("hello");
    expect(state.pinned[0]).toEqual([
      null,
      [{ address: "8.8.8.8", family: 4 }],
      4,
    ]);
  });
  it("无Content-Length仍逐块限额", async () => {
    state.lookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
    state.chunks = [Buffer.alloc(6), Buffer.alloc(6)];
    await expect(
      downloadPhotoMedia("https://example.com/a", 10)
    ).rejects.toThrow("image_too_large");
  });
  it("DNS返回IPv6映射内网时发送前拒绝", async () => {
    state.lookup.mockResolvedValue([{ address: "::ffff:7f00:1", family: 6 }]);
    state.pinned = [];
    await expect(
      downloadPhotoMedia("https://example.com/a", 10)
    ).rejects.toThrow("媒体地址不安全");
    expect(state.pinned).toEqual([]);
  });
});

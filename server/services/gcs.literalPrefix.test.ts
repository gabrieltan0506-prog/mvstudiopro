/**
 * 锁住 literalPrefix：目录前缀模式会给末尾补 `/`，
 * 用文件名前缀查 `tpl_native_abc_ep` 会被改写成 `tpl_native_abc_ep/`，
 * 永远匹配不到 `ep001.json` —— 断点续跑因此恒返回空集、每次重跑都重烧。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../utils/vertex.js", () => ({
  getVertexAccessToken: async () => "test-token",
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function capturePrefix(params: { prefix: string; literalPrefix?: boolean }) {
  let requested = "";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      requested = String(input);
      return { ok: true, status: 200, json: async () => ({ items: [] }) };
    }),
  );
  const { listGcsObjectNamesByPrefix } = await import("./gcs");
  await listGcsObjectNamesByPrefix({ bucket: "bucket-a", ...params });
  return new URL(requested).searchParams.get("prefix");
}

describe("listGcsObjectNamesByPrefix literalPrefix", () => {
  it("文件名前缀不自动补斜线，能匹配 ep001.json", async () => {
    await expect(
      capturePrefix({
        prefix: "manhua-template-learn/proposals/tpl_native_abc_ep",
        literalPrefix: true,
      }),
    ).resolves.toBe("manhua-template-learn/proposals/tpl_native_abc_ep");
  });

  it("默认仍按目录前缀补斜线，既有调用点行为不变", async () => {
    await expect(
      capturePrefix({ prefix: "manhua-template-learn/proposals" }),
    ).resolves.toBe("manhua-template-learn/proposals/");
  });
});

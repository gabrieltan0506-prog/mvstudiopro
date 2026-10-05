import { afterEach, expect, it, vi } from "vitest";
vi.mock("../utils/vertex", () => ({ getVertexAccessToken: async () => "test-only-token" }));
import { readGcsPrefixRevision } from "./gcs";
afterEach(() => vi.unstubAllGlobals());
it("只取元数据并读完分页；原对象更新 generation 也改变目录版本", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ items: [{ name: "approved/a.json", generation: "1" }], nextPageToken: "next" }))
    .mockResolvedValueOnce(Response.json({ items: [{ name: "approved/b.json", generation: "2" }] }))
    .mockResolvedValueOnce(Response.json({ items: [{ name: "approved/b.json", generation: "2" }, { name: "approved/a.json", generation: "1" }] }))
    .mockResolvedValueOnce(Response.json({ items: [{ name: "approved/b.json", generation: "3" }, { name: "approved/a.json", generation: "1" }] }));
  vi.stubGlobal("fetch", fetcher);
  const first = await readGcsPrefixRevision("approved/");
  expect(new URL(String(fetcher.mock.calls[0][0])).searchParams.get("fields")).toBe("items(name,generation),nextPageToken");
  expect(new URL(String(fetcher.mock.calls[1][0])).searchParams.get("pageToken")).toBe("next");
  expect(await readGcsPrefixRevision("approved/")).toBe(first);
  expect(await readGcsPrefixRevision("approved/")).not.toBe(first);
});
it("分页失败不能当作成功版本或空目录", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ items: [{ name: "approved/a.json", generation: "1" }], nextPageToken: "next" }))
    .mockResolvedValueOnce(new Response("denied", { status: 403 })));
  await expect(readGcsPrefixRevision("approved/")).rejects.toThrow("403");
});

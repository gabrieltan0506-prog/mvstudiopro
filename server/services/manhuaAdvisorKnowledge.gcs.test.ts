import { afterEach, expect, it, vi } from "vitest";
vi.mock("../utils/vertex", () => ({ getVertexAccessToken: async () => "synthetic-test-only" }));
import { listGcsObjectVersions } from "./gcs";
afterEach(() => vi.unstubAllGlobals());
it("knowledge metadata returns every generation without fetching object bodies", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ items: [{ name: "approved/b.json", generation: "9" }], nextPageToken: "two" }))
    .mockResolvedValueOnce(Response.json({ items: [{ name: "approved/a.json", generation: "10" }, { name: "approved/ignore.txt", generation: "11" }] }));
  vi.stubGlobal("fetch", fetcher);
  expect(await listGcsObjectVersions("approved/")).toEqual([{ name: "approved/a.json", generation: "10" }, { name: "approved/b.json", generation: "9" }]);
  expect(fetcher).toHaveBeenCalledTimes(2);
  for (const [url] of fetcher.mock.calls) expect(new URL(String(url)).searchParams.has("alt")).toBe(false);
});
it("duplicated object names across pages reject the entire metadata snapshot", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ items: [{ name: "approved/a.json", generation: "1" }], nextPageToken: "two" }))
    .mockResolvedValueOnce(Response.json({ items: [{ name: "approved/a.json", generation: "2" }] })));
  await expect(listGcsObjectVersions("approved/")).rejects.toThrow("duplicate");
});

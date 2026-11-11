import { expect, it } from "vitest";
import { KnowledgeTtlCache } from "./knowledgePublicationCache";

it("同键并发只加载一次；过期与容量淘汰；失败不进缓存", async () => {
  let now = 0, loads = 0;
  const cache = new KnowledgeTtlCache<number>(2, 1000, () => now);
  const load = async () => { loads++; return loads; };
  expect(await Promise.all([cache.get("a", load), cache.get("a", load)])).toEqual([1, 1]);
  expect(loads).toBe(1);
  now = 1001;
  expect(await cache.get("a", load)).toBe(2);
  await cache.get("b", load); await cache.get("c", load);
  expect(cache.size).toBe(2);
  expect(cache.has("a")).toBe(false);
  await expect(cache.get("x", async () => { throw Error("读取失败"); })).rejects.toThrow("读取失败");
  await Promise.resolve();
  expect(cache.has("x")).toBe(false);
  expect(await cache.get("x", async () => 9)).toBe(9);
});

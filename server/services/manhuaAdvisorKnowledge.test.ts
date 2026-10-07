import { describe, expect, it, vi } from "vitest";
import { createManhuaAdvisorKnowledge } from "./manhuaAdvisorKnowledge";
import type { GcsObjectVersion } from "./gcs";

const prefix = "manhua-template-learn/approved/";
const object = (id: string, generation = "1"): GcsObjectVersion => ({ name: `${prefix}tpl_${id}.json`, generation });
const body = (id: string, publicCode = id.toUpperCase()) => Buffer.from(JSON.stringify({
  id: `tpl_${id}`, publicCode, nameZh: "PRIVATE SOURCE NAME", laneZh: "古言种田", status: "approved",
  summaryZh: "PRIVATE METHOD", reusableZh: "NEVER CACHE LEARNED BODY", beatGrid: [],
  updatedAt: "2026-10-07T00:00:00Z",
}));
function setup(initial = [object("a123"), object("b456")]) {
  let objects = initial;
  const list = vi.fn(async () => objects);
  const read = vi.fn(async (item: GcsObjectVersion) => ({ buffer: body(item.name.slice(prefix.length + 4, -5)), generation: item.generation }));
  const store = createManhuaAdvisorKnowledge({ list, read, now: () => new Date("2026-10-07T01:00:00Z") });
  return { ...store, list, read, set: (next: GcsObjectVersion[]) => { objects = next; } };
}

describe("explicit low-load advisor knowledge snapshot", () => {
  it("inspect never reads storage; cold scan stores all anonymous summaries, no private methods or locations", async () => {
    const store = setup();
    expect(store.inspect()).toEqual({ status: "not_scanned", refreshing: false });
    expect(store.list).not.toHaveBeenCalled(); expect(store.read).not.toHaveBeenCalled();
    const result = await store.refresh();
    expect(result.status).toBe("ready"); expect(result.snapshot?.templates.map(row => row.publicId)).toEqual(["mt_a123", "mt_b456"]);
    expect(result.changes).toMatchObject({ added: ["mt_a123", "mt_b456"], downloadedCards: 2 });
    const text = JSON.stringify(result);
    for (const secret of ["PRIVATE", "NEVER CACHE", "tpl_a123", prefix]) expect(text).not.toContain(secret);
    expect(result.snapshot?.templates.every(row => /^[a-f0-9]{64}$/.test(row.contentSha256))).toBe(true);
    expect(result.snapshot?.directors.length).toBeGreaterThan(0);
    expect(result.snapshot?.capabilities.effects.screen).toHaveLength(12);
    expect(result.snapshot?.capabilities.effects.scene).toHaveLength(5);
    result.snapshot!.templates.length = 0;
    expect(store.inspect().snapshot?.templates).toHaveLength(2);
    expect(store.read).toHaveBeenCalledTimes(2);
  });

  it("same generation fetches zero bodies; changed/new/deleted IDs fully reconcile with stable hashes", async () => {
    const store = setup(); const first = await store.refresh(); store.read.mockClear();
    const same = await store.refresh();
    expect(store.read).not.toHaveBeenCalled(); expect(same.snapshot?.revision).toBe(first.snapshot?.revision);
    expect(same.changes).toMatchObject({ unchangedCount: 2, downloadedCards: 0 });
    store.set([object("a123", "2"), object("c789")]);
    const next = await store.refresh();
    expect(store.read.mock.calls.map(([row]) => row.name)).toEqual([object("a123").name, object("c789").name]);
    expect(next.changes).toEqual({ added: ["mt_c789"], updated: ["mt_a123"], deleted: ["mt_b456"], unchangedCount: 0, downloadedCards: 2 });
    expect(next.snapshot?.revision).not.toBe(first.snapshot?.revision);
    store.set([]); store.read.mockClear();
    expect((await store.refresh()).changes?.deleted).toEqual(["mt_a123", "mt_c789"]);
    expect(store.read).not.toHaveBeenCalled();
  });

  it("simultaneous refresh shares one operation; inspect exposes pending state without new storage work", async () => {
    const store = setup(); let finish!: (items: GcsObjectVersion[]) => void;
    store.list.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const first = store.refresh(), second = store.refresh();
    expect(second).toBe(first); expect(store.inspect().refreshing).toBe(true);
    finish([object("a123")]); await first;
    expect(store.list).toHaveBeenCalledTimes(1); expect(store.read).toHaveBeenCalledTimes(1);
    expect(store.inspect().refreshing).toBe(false);
  });

  it("metadata failure preserves old snapshot as stale; recovery reuses unchanged summaries", async () => {
    const store = setup(); const first = await store.refresh(); store.read.mockClear();
    store.list.mockRejectedValueOnce(new Error("private upstream URL or credential"));
    const failure = await store.refresh();
    expect(failure.status).toBe("stale"); expect(failure.snapshot).toEqual(first.snapshot);
    expect(failure.error).not.toContain("private upstream"); expect(failure.changes).toBeUndefined();
    expect((await store.refresh()).status).toBe("ready"); expect(store.read).not.toHaveBeenCalled();
  });

  it("generation races and partial failures never publish a mixed snapshot or start overlapping workers", async () => {
    const store = setup([object("a123")]); const first = await store.refresh();
    store.set([object("a123", "2"), object("b456")]);
    let finish!: () => void;
    store.read.mockImplementation(async item => {
      if (item.name === object("a123").name) return { buffer: body("a123"), generation: "3" };
      await new Promise<void>(resolve => { finish = resolve; });
      return { buffer: body("b456"), generation: item.generation };
    });
    const pending = store.refresh(); await Promise.resolve(); await Promise.resolve();
    expect(store.refresh()).toBe(pending); expect(store.inspect().refreshing).toBe(true);
    finish(); const failure = await pending;
    expect(failure.status).toBe("stale"); expect(failure.snapshot).toEqual(first.snapshot);
    expect(failure.error).toContain("版本发生变化");
  });

  it("cold failure reports not_scanned and duplicate public identities fail closed", async () => {
    const store = setup(); store.read.mockResolvedValueOnce({ buffer: Buffer.from("{"), generation: "1" });
    const first = await store.refresh(); expect(first.status).toBe("not_scanned"); expect(first.snapshot).toBeUndefined();
    store.read.mockImplementation(async item => ({ buffer: body(item.name.slice(prefix.length + 4, -5), "AAAA"), generation: item.generation }));
    expect((await store.refresh()).error).toContain("公开编号重复");
    expect(store.inspect().snapshot).toBeUndefined();
  });

  it("untrusted metadata cannot make reads escape approved prefix", async () => {
    const store = setup([{ name: "learning/raw.json", generation: "1" }]);
    expect((await store.refresh()).status).toBe("not_scanned"); expect(store.read).not.toHaveBeenCalled();
    store.set([object("a123"), object("a123")]);
    expect((await store.refresh()).error).toContain("重复身份"); expect(store.read).not.toHaveBeenCalled();
  });
});

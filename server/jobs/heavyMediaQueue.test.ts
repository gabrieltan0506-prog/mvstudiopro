import { describe, expect, it, vi } from "vitest";
import { withHeavyMediaContext } from "./heavyMediaContext";
import {
  dispatchHeavyMedia,
  heavyMediaJobId,
  type HeavyMediaStore,
  type HeavyMediaRequest,
} from "./heavyMediaQueue";
const request: HeavyMediaRequest = {
  kind: "final_render",
  input: { sceneVideos: [{ url: "https://fixture.invalid/shot.mp4" }] },
};
const owner = { userId: "7", executionId: "parent-7", parentJobId: "parent-7" };
const row = (status: string, output: unknown = null) => ({
  id: "fixture",
  userId: "7",
  status,
  input: {},
  output,
  error: null,
  updatedAt: new Date(),
});
describe("media child orchestration", () => {
  it("uses a database-compatible stable ID isolated by input and parent", () => {
    expect(heavyMediaJobId("a", request)).toHaveLength(64);
    expect(heavyMediaJobId("a", request)).toBe(heavyMediaJobId("a", request));
    expect(heavyMediaJobId("b", request)).not.toBe(
      heavyMediaJobId("a", request)
    );
  });
  it("persists before polling, preserves the original parent and full subtitle result through a read outage", async () => {
    const result = {
      url: "https://fixture.invalid/final.mp4",
      subtitleTimeline: {
        cues: Array.from({ length: 140 }, (_, i) => ({
          text: `line-${i}`,
          fromSec: i,
        })),
      },
    };
    const get = vi
      .fn()
      .mockRejectedValueOnce(new Error("db outage"))
      .mockResolvedValueOnce(
        row("running", { progress: { message: "uploading" } })
      )
      .mockResolvedValueOnce(row("succeeded", { result }));
    const store: HeavyMediaStore = {
      enqueue: vi.fn(async () => {}),
      get,
      cancel: vi.fn(),
    };
    const progress = vi.fn(async () => {});
    expect(
      await withHeavyMediaContext(owner, () =>
        dispatchHeavyMedia(request, {
          store,
          wait: async () => {},
          onProgress: progress,
        })
      )
    ).toEqual(result);
    expect(store.enqueue).toHaveBeenCalledOnce();
    expect(store.enqueue).toHaveBeenCalledWith(
      expect.any(String),
      "7",
      expect.objectContaining({ parentJobId: "parent-7" })
    );
    expect(store.cancel).not.toHaveBeenCalled();
    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({ message: "uploading" }),
      expect.any(Function)
    );
  });
  it("refuses missing ownership before any enqueue", async () => {
    const store = { enqueue: vi.fn(), get: vi.fn(), cancel: vi.fn() };
    await expect(dispatchHeavyMedia(request, { store })).rejects.toThrow(
      "归属"
    );
    expect(store.enqueue).not.toHaveBeenCalled();
  });
  it("durably cancels callback failure without creating a replacement", async () => {
    const store = {
      enqueue: vi.fn(),
      get: vi.fn(async () => row("running", { progress: { groups: [] } })),
      cancel: vi.fn(),
    };
    await expect(
      withHeavyMediaContext(owner, () =>
        dispatchHeavyMedia(request, {
          store,
          onProgress: async () => {
            throw new Error("consumer failed");
          },
        })
      )
    ).rejects.toThrow("consumer failed");
    expect(store.cancel).toHaveBeenCalledOnce();
    expect(store.enqueue).toHaveBeenCalledOnce();
  });
  it("cancels a waiting task under the same user and identity", async () => {
    const c = new AbortController();
    const store = {
      enqueue: vi.fn(),
      get: vi.fn(async () => row("queued")),
      cancel: vi.fn(),
    };
    await expect(
      withHeavyMediaContext(owner, () =>
        dispatchHeavyMedia(request, {
          store,
          signal: c.signal,
          wait: async () => {
            c.abort();
          },
        })
      )
    ).rejects.toThrow();
    expect(store.cancel).toHaveBeenCalledWith(
      heavyMediaJobId("7/parent-7", request),
      "7"
    );
  });
});

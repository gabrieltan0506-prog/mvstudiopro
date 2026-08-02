import { describe, expect, it } from "vitest";
import {
  clearShortlistExpandPersist,
  readShortlistExpandPersist,
  writeShortlistExpandPersist,
} from "./platformShortlistExpandPersist";
import type { PlatformTopicShortlistItem } from "@shared/platformTopicShortlist";

function memoryStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
}

function sampleTopic(id: string): PlatformTopicShortlistItem {
  return {
    id: id.length >= 4 ? id : `topic-${id}`,
    title: `选题标题足够长 ${id}`,
    hookSketch: "钩子草稿示意",
    conveyGoal: "传达目标示意",
    skillsUsed: ["生活节奏"],
    primaryLane: "default",
    formatHint: "图文",
    dedupeKey: `dk-${id}`,
    commentHook: "想要",
    linkedCampaigns: [],
  };
}

describe("platformShortlistExpandPersist", () => {
  it("round-trips topics + expanded blueprints for same user", () => {
    const storage = memoryStorage();
    const topics = [sampleTopic("t1"), sampleTopic("t2")];
    const bps = [
      {
        title: "正式标题",
        hook: "开场钩子",
        copywriting: "正文段落一二三",
        commentHooks: ["想要", "收藏"],
        format: "图文",
      },
    ];
    expect(
      writeShortlistExpandPersist(
        { userKey: "u1", topics, contentBlueprints: bps },
        storage,
      ),
    ).toBe(true);
    const loaded = readShortlistExpandPersist("u1", storage);
    expect(loaded?.topics).toHaveLength(2);
    expect(loaded?.topics[0]?.title).toContain("t1");
    expect(loaded?.contentBlueprints[0]?.copywriting).toBe("正文段落一二三");
  });

  it("does not leak another user's bucket", () => {
    const storage = memoryStorage();
    writeShortlistExpandPersist(
      {
        userKey: "u1",
        topics: [sampleTopic("a")],
        contentBlueprints: [{ title: "私密" }],
      },
      storage,
    );
    expect(readShortlistExpandPersist("u2", storage)).toBeNull();
  });

  it("clear only removes matching user payload", () => {
    const storage = memoryStorage();
    writeShortlistExpandPersist(
      { userKey: "u1", topics: [sampleTopic("a")], contentBlueprints: [] },
      storage,
    );
    clearShortlistExpandPersist("u2", storage);
    expect(readShortlistExpandPersist("u1", storage)?.topics).toHaveLength(1);
    clearShortlistExpandPersist("u1", storage);
    expect(readShortlistExpandPersist("u1", storage)).toBeNull();
  });
});

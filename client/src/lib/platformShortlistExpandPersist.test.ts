import { describe, expect, it } from "vitest";
import {
  PLATFORM_SHORTLIST_EXPAND_LS_KEY,
  clearShortlistExpandPersist,
  purgeShortlistTitlesPersist,
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
    skillsUsed: ["xhs-content-growth"],
    primaryLane: "default",
    formatHint: "图文",
    dedupeKey: `dk-${id}`,
    commentHook: "想要",
    linkedCampaigns: [],
  };
}

describe("platformShortlistExpandPersist", () => {
  it("扩写正文随账号保留，选题候选标题不落盘（刷新即删）", () => {
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
    expect(loaded?.topics).toEqual([]);
    expect(storage.getItem(PLATFORM_SHORTLIST_EXPAND_LS_KEY)).not.toContain("选题标题足够长");
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
    expect(readShortlistExpandPersist("u1", storage)).not.toBeNull();
    clearShortlistExpandPersist("u1", storage);
    expect(readShortlistExpandPersist("u1", storage)).toBeNull();
  });
});

it("保留双平台选择与原任务编号，未出稿候选标题不再保留", () => {
 const storage = memoryStorage();
 const topic = sampleTopic("viral-a");
 const payload = { userKey: "u1", topics: [topic], contentBlueprints: [{ id: "draft", xhsPackage: { audience: "职场新人" } }], viralPreferences: { platforms: ["xiaohongshu", "douyin"] as Array<"xiaohongshu" | "douyin">, formats: ["图文", "短视频"] as Array<"图文" | "短视频"> }, failedPicks: [topic], pendingExpand: { jobId: "original-job", picks: [topic] } };
 expect(writeShortlistExpandPersist(payload, storage)).toBe(true);
 const restored = readShortlistExpandPersist("u1", storage)!;
 expect(restored.viralPreferences).toEqual(payload.viralPreferences); expect(restored.pendingExpand?.jobId).toBe("original-job"); expect(restored.failedPicks).toEqual([]); expect(restored.contentBlueprints[0].xhsPackage).toEqual({ audience: "职场新人" });
});

it("刷新清除旧选题但保留已经生成的正文与原任务", () => {
 const storage=memoryStorage();const old={...sampleTopic("old1"),skillsUsed:["生活节奏"]};
 writeShortlistExpandPersist({userKey:"u1",topics:[old],contentBlueprints:[{id:"paid-draft",copywriting:"已生成的正文"}],pendingExpand:{jobId:"running-job",picks:[old]}},storage);
 const result=readShortlistExpandPersist("u1",storage)!;
 expect(result.topics).toEqual([]);expect(result.contentBlueprints[0].id).toBe("paid-draft");expect(result.pendingExpand?.jobId).toBe("running-job");
});

it("参考人像按用户和稿件恢复，移除后不复现，非法本机地址不保存", () => {
 const storage=memoryStorage();
 const base={userKey:"u1",topics:[],contentBlueprints:[]};
 writeShortlistExpandPersist({...base,referencePhotos:{byScene:{scene1:"https://media.example.test/portrait.jpg",bad:"file:///private.jpg"},global:"https://media.example.test/global.png"}},storage);
 expect(readShortlistExpandPersist("u1",storage)?.referencePhotos).toEqual({byScene:{scene1:"https://media.example.test/portrait.jpg"},global:"https://media.example.test/global.png"});
 expect(readShortlistExpandPersist("u2",storage)).toBeNull();
 writeShortlistExpandPersist({...base,referencePhotos:{byScene:{}}},storage);
 expect(readShortlistExpandPersist("u1",storage)?.referencePhotos).toEqual({byScene:{},global:undefined});
});

it("旧版本已存的候选标题：读取不回填，开页清理只抹标题不动正文、任务与输入偏好", () => {
 const old = { ...sampleTopic("legacy1"), title: "旧版生成的爆款标题示例" };
 const legacy = JSON.stringify({ v: 1, userKey: "u1", savedAt: "2026-11-01T00:00:00Z", topics: [old], failedPicks: [old], pendingExpand: { jobId: "running-job", picks: [old] }, contentBlueprints: [{ id: "paid-draft", title: "已选定标题", copywriting: "已生成的正文" }], viralPreferences: { platforms: ["douyin"], formats: ["短视频"] }, referencePhotos: { byScene: { s1: "https://media.example.test/a.jpg" } } });
 const storage = memoryStorage({ [PLATFORM_SHORTLIST_EXPAND_LS_KEY]: legacy, "mvs.platform.workbench.draft.v2.u1": "{\"focusPrompt\":\"我的主题\"}" });
 const before = readShortlistExpandPersist("u1", storage)!;
 expect(before.topics).toEqual([]); expect(before.failedPicks).toEqual([]);
 expect(purgeShortlistTitlesPersist(storage)).toBe(true);
 const raw = JSON.parse(storage.getItem(PLATFORM_SHORTLIST_EXPAND_LS_KEY)!);
 expect(raw.topics).toEqual([]); expect(raw.failedPicks).toEqual([]);
 expect(raw.pendingExpand.jobId).toBe("running-job");
 expect(raw.contentBlueprints).toEqual([{ id: "paid-draft", title: "已选定标题", copywriting: "已生成的正文" }]);
 expect(raw.viralPreferences).toEqual({ platforms: ["douyin"], formats: ["短视频"] });
 expect(raw.referencePhotos.byScene.s1).toBe("https://media.example.test/a.jpg");
 expect(storage.getItem("mvs.platform.workbench.draft.v2.u1")).toBe("{\"focusPrompt\":\"我的主题\"}");
 // 幂等：再跑一次不改写
 expect(purgeShortlistTitlesPersist(storage)).toBe(false);
 expect(purgeShortlistTitlesPersist(memoryStorage())).toBe(false);
 expect(purgeShortlistTitlesPersist(memoryStorage({ [PLATFORM_SHORTLIST_EXPAND_LS_KEY]: "坏数据" }))).toBe(false);
});

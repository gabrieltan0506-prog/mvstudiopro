import { it, expect, vi, afterEach } from "vitest";
import type { NovelRun } from "./novelWorkspace";
import { createNovelFactoryProject } from "./novelFactoryProject";
import { scopedManhuaStorage } from "@shared/manhuaProjectScope";
import { loadManhuaWriterSessionFromStorage } from "@shared/manhuaWriterSession";
import {
  buildLocalCloudDraftSnapshot,
  chooseManhuaDraftHydrate,
  readLocalDraftPartsForHydrate,
  repairLocalFromCloudDraft,
} from "./manhuaCloudDraftSync";
afterEach(() => vi.unstubAllGlobals());
export function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key: i => Array.from(map.keys())[i] ?? null,
    getItem: k => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: k => {
      map.delete(k);
    },
    clear: () => map.clear(),
  };
}
const run: NovelRun = {
  input: {
    requestId: "11111111-1111-4111-8111-111111111111",
    roundId: "22222222-2222-4222-8222-222222222222",
    stage: "script",
    topic: "权谋",
    direction: "保留主角",
    templates: [],
    episodeCount: 3,
    chapterIndex: 1,
    outline: "大纲",
    novel: "小说原文",
    selectedTemplateIds: [],
  },
  result: {
    requestId: "11111111-1111-4111-8111-111111111111",
    stage: "script",
    inputSha256: "a".repeat(64),
    resultSha256: "b".repeat(64),
    templateIds: [],
    text: JSON.stringify({
      title: "新剧",
      episodes: [1, 2, 3].map(index => ({
        index,
        title: `第${index}集`,
        opening: "遭遇盘查",
        hook: "谁改了账本",
        payoff: "找到线索",
        scenes: [
          {
            key: `E${index}-S1`,
            场景: "雨夜书库，沈砚握住账本退后一步，盯着门外来人。",
            人物: "沈砚与守卫",
            妆容: "青衣湿透",
            灯光: "冷光照见眉眼",
            氛围: "逼近的压迫感",
            对白: "沈砚：「账本留在这里，人必须跟我走。」",
          },
        ],
      })),
    }),
  },
};
it("R1661-001: 全新设备应选择云端实稿，而不是新造的空本机稿", () => {
  const storage = memoryStorage();
  vi.stubGlobal("localStorage", storage);
  const cloud = buildLocalCloudDraftSnapshot({
    writerSession: { topic: "云端保留作品", episodeCount: 3 },
    blocks: [],
    edges: [],
    clientUpdatedAt: "2026-10-01T00:00:00.000Z",
  });
  const local = readLocalDraftPartsForHydrate();
  const chosen = chooseManhuaDraftHydrate({
    cloud,
    localWriter: local.writer,
    localCanvas: local.canvas,
    localPrefs: local.prefs,
    localClientUpdatedAt: local.clientUpdatedAt,
  });
  console.log(
    "R1661-001",
    JSON.stringify({
      local,
      chosenSource: chosen.source,
      chosenTopic:
        chosen.source !== "none" ? chosen.draft.writerSession.topic : null,
      chosenAt: chosen.source !== "none" ? chosen.draft.clientUpdatedAt : null,
      cloudTopic: cloud.writerSession.topic,
    })
  );
  expect(chosen.source).toBe("cloud");
});
it("R1661-002: 云草稿完整恢复后应能继续追加同季第4集", () => {
  const original = memoryStorage();
  createNovelFactoryProject(original, "1", run);
  const target = scopedManhuaStorage(original, {
    ownerId: "1",
    projectId: run.input.requestId,
  });
  const writer = loadManhuaWriterSessionFromStorage(target)!;
  const cloud = buildLocalCloudDraftSnapshot({
    writerSession: writer,
    blocks: [],
    edges: [],
    clientUpdatedAt: "2026-10-01T00:00:00.000Z",
  });
  const device = memoryStorage();
  const restored = scopedManhuaStorage(device, {
    ownerId: "1",
    projectId: run.input.requestId,
  });
  // Production restoration writes through this same scope adapter.
  vi.stubGlobal("localStorage", restored);
  repairLocalFromCloudDraft(cloud);
  const next = structuredClone(run);
  next.input.requestId = crypto.randomUUID();
  next.result.requestId = next.input.requestId;
  next.input.episodeStart = 4;
  next.input.episodeCount = 1;
  next.result.resultSha256 = "c".repeat(64);
  const s = JSON.parse(next.result.text);
  s.episodes = [{ ...s.episodes[0], index: 4 }];
  next.result.text = JSON.stringify(s);
  let error = "";
  try {
    createNovelFactoryProject(device, "1", next, run.input.requestId);
  } catch (e) {
    error = (e as Error).message;
  }
  console.log(
    "R1661-002",
    JSON.stringify({
      restoredEpisodes:
        loadManhuaWriterSessionFromStorage(restored)?.writerPack?.episodes
          .length,
      originRestored: restored.getItem("novel-origin-v1") !== null,
      error,
    })
  );
  expect(error).toBe("");
});

it("R1661-001: 缺失/损坏时间或损坏键不伪装较新稿；明确保存的新空稿仍有效", () => {
  const cloud = buildLocalCloudDraftSnapshot({
    writerSession: { topic: "云原稿" },
    blocks: [],
    edges: [],
    clientUpdatedAt: "2026-10-01T00:00:00.000Z",
  });
  for (const time of [null, "invalid", "2026-09-01T00:00:00.000Z"]) {
    const chosen = chooseManhuaDraftHydrate({
      cloud,
      localWriter: null,
      localCanvas: { blocks: [], edges: [] },
      localPrefs: {},
      localClientUpdatedAt: time,
    });
    expect(chosen.source).toBe("cloud");
  }
  const storage = memoryStorage();
  vi.stubGlobal("localStorage", storage);
  storage.setItem("mv-manhua-writer-session-v1", "{broken");
  storage.setItem(
    "mv-freeform-canvas-v1",
    JSON.stringify({ blocks: [], edges: [] })
  );
  storage.setItem(
    "mv-manhua-cloud-draft-local-at-v1",
    "2026-10-04T00:00:00.000Z"
  );
  const local = readLocalDraftPartsForHydrate();
  expect(local.readFailed).toBe(true);
  expect(
    chooseManhuaDraftHydrate({
      cloud,
      localWriter: local.writer,
      localCanvas: local.canvas,
      localPrefs: local.prefs,
      localClientUpdatedAt: local.clientUpdatedAt,
      localReadFailed: local.readFailed,
    }).source
  ).toBe("cloud");
  expect(
    chooseManhuaDraftHydrate({
      cloud,
      localWriter: null,
      localCanvas: { blocks: [], edges: [] },
      localPrefs: null,
      localClientUpdatedAt: "2026-10-04T00:00:00.000Z",
    }).source
  ).toBe("local");
});

it("R1661-002: 云序列化读回后的来源支持幂等、拒绝同请求换稿，旧备份不伪造来源", async () => {
  const { parseManhuaCloudDraftPayload, serializeManhuaCloudDraftPayload } =
    await import("@shared/manhuaCloudDraft");
  const source = memoryStorage();
  createNovelFactoryProject(source, "1", run);
  const from = scopedManhuaStorage(source, {
    ownerId: "1",
    projectId: run.input.requestId,
  });
  const writer = loadManhuaWriterSessionFromStorage(from)!;
  const cloud = parseManhuaCloudDraftPayload(
    serializeManhuaCloudDraftPayload(
      buildLocalCloudDraftSnapshot({
        writerSession: writer,
        blocks: [],
        edges: [],
        clientUpdatedAt: "2026-10-01T00:00:00.000Z",
      })
    )
  )!;
  const device = memoryStorage(),
    restored = scopedManhuaStorage(device, {
      ownerId: "1",
      projectId: run.input.requestId,
    });
  vi.stubGlobal("localStorage", restored);
  repairLocalFromCloudDraft(cloud);
  expect(
    createNovelFactoryProject(device, "1", run, run.input.requestId).created
  ).toBe(false);
  const before = restored.getItem("mv-manhua-writer-session-v1");
  const changed = structuredClone(run);
  changed.result.resultSha256 = "d".repeat(64);
  expect(() =>
    createNovelFactoryProject(device, "1", changed, run.input.requestId)
  ).toThrow("版本不一致");
  expect(restored.getItem("mv-manhua-writer-session-v1")).toBe(before);
  const legacy = {
    ...cloud,
    writerSession: { ...cloud.writerSession, novelOrigin: undefined },
  };
  repairLocalFromCloudDraft(legacy);
  expect(restored.getItem("novel-origin-v1")).toBeNull();
  const next = structuredClone(run);
  next.input.episodeStart = 4;
  expect(() =>
    createNovelFactoryProject(device, "1", next, run.input.requestId)
  ).toThrow("旧备份缺少小说导入记录");
  expect(
    loadManhuaWriterSessionFromStorage(restored)?.writerPack?.episodes
  ).toHaveLength(3);
});

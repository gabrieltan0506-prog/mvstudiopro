import { it, expect } from "vitest";
import {
  createNovelFactoryProject,
  novelRunToWriterPack,
  listLocalManhuaProjects,
  createEmptyManhuaProject,
} from "./novelFactoryProject";
import {
  scopedManhuaStorage,
  parseManhuaProjectScope,
} from "@shared/manhuaProjectScope";
import { loadManhuaWriterSessionFromStorage } from "@shared/manhuaWriterSession";
import { parseManhuaEpisodeSegmentPlanFromMarkdown } from "@shared/manhuaEpisodeSegmentPlan";
import type { NovelRun } from "./novelWorkspace";
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
it("完整场次与六类内容进入三集剧情包及可拍表，不触发模型", () => {
  const pack = novelRunToWriterPack(run);
  expect(pack.episodes).toHaveLength(3);
  expect(pack.charactersMd).toContain("沈砚");
  for (const ep of pack.episodes) {
    expect(ep.body).toContain("青衣湿透");
    expect(ep.body).toContain("人必须跟我走");
    expect(
      parseManhuaEpisodeSegmentPlanFromMarkdown(ep.body).segments
    ).toHaveLength(1);
  }
});
it("创建、重开和跨账号隔离；原作与编辑后的新作不被覆盖", () => {
  const store = memoryStorage();
  store.setItem("mv-manhua-writer-session-v1", "墨菁传");
  store.setItem("mv-freeform-canvas-v1", "原视频");
  const first = createNovelFactoryProject(store, "1", run);
  const scope = parseManhuaProjectScope(first.href.split("/canvas")[1])!;
  const target = scopedManhuaStorage(store, scope);
  const session = loadManhuaWriterSessionFromStorage(target)!;
  expect(session.writerPack?.episodes).toHaveLength(3);
  expect(session.writerConfirmed).toBe(false);
  target.setItem("editing", "保留修改");
  expect(createNovelFactoryProject(store, "1", run)).toEqual({
    ...first,
    created: false,
  });
  expect(target.getItem("editing")).toBe("保留修改");
  expect(store.getItem("mv-manhua-writer-session-v1")).toBe("墨菁传");
  expect(store.getItem("mv-freeform-canvas-v1")).toBe("原视频");
  expect(listLocalManhuaProjects(store, "1")).toHaveLength(1);
  expect(listLocalManhuaProjects(store, "2")).toHaveLength(0);
  expect(
    scopedManhuaStorage(store, { ...scope, ownerId: "2" }).getItem("editing")
  ).toBeNull();
});
it("超过100个独立作品可列举并切回，各自内容保留", () => {
  const store = memoryStorage();
  const urls = Array.from({ length: 105 }, (_, i) =>
    createEmptyManhuaProject(store, "1", `作品${i}`)
  );
  expect(listLocalManhuaProjects(store, "1")).toHaveLength(105);
  for (const i of [0, 50, 104]) {
    const scope = parseManhuaProjectScope(urls[i].split("/canvas")[1])!;
    expect(
      loadManhuaWriterSessionFromStorage(scopedManhuaStorage(store, scope))
        ?.topic
    ).toBe(`作品${i}`);
  }
});
it("保存失败清除未完成的新项目，不触碰原稿；非法ID不能回落原工作区", () => {
  const store = memoryStorage();
  store.setItem("original", "原稿");
  const set = store.setItem;
  store.setItem = (k, v) => {
    if (k.endsWith("novel-origin-v1")) throw new Error("quota");
    set(k, v);
  };
  expect(() => createNovelFactoryProject(store, "1", run)).toThrow("quota");
  expect(store.length).toBe(1);
  expect(store.getItem("original")).toBe("原稿");
  expect(() => parseManhuaProjectScope("?project=../other&owner=1")).toThrow();
});
it("continuation appends 60 episodes to the same project without losing edited episodes or production assets", () => {
  const storage = memoryStorage(),
    projectId = crypto.randomUUID();
  const first = createNovelFactoryProject(storage, "1", run, projectId);
  const target = scopedManhuaStorage(
    storage,
    parseManhuaProjectScope(first.href.split("/canvas")[1])!
  );
  const original = JSON.parse(target.getItem("mv-manhua-writer-session-v1")!);
  original.writerPack.episodes[0].body += "\n用户修改保留";
  target.setItem("mv-manhua-writer-session-v1", JSON.stringify(original));
  target.setItem("shot-proof", "已生成资产");
  for (const [start, count] of [
    [4, 10],
    [14, 20],
    [34, 20],
    [54, 7],
  ]) {
    const next = structuredClone(run);
    next.input.requestId = crypto.randomUUID();
    next.input.episodeStart = start;
    next.input.episodeCount = count;
    next.result.requestId = next.input.requestId;
    next.result.resultSha256 = String(start);
    const script = JSON.parse(next.result.text);
    script.episodes = Array.from({ length: count }, (_, i) => ({
      ...script.episodes[0],
      index: start + i,
      title: `第${start + i}集`,
      scenes:script.episodes[0].scenes.map((scene:any)=>({...scene,对白:start===4?"裴昭：「先救出他们，我们再清算这笔账。」":scene.对白})),
    }));
    next.result.text = JSON.stringify(script);
    expect(createNovelFactoryProject(storage, "1", next, projectId).href).toBe(
      first.href
    );
  }
  const restored = loadManhuaWriterSessionFromStorage(target)!;
  expect(restored.writerPack?.charactersMd).toContain("裴昭");
  expect(restored.episodeCount).toBe(60);
  expect(restored.writerPack?.episodes).toHaveLength(60);
  expect(restored.writerPack?.episodes[0].body).toContain("用户修改保留");
  expect(target.getItem("shot-proof")).toBe("已生成资产");
  expect(listLocalManhuaProjects(storage, "1")).toHaveLength(1);
});

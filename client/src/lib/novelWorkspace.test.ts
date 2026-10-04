import { it, expect } from "vitest";
import {
  archiveNovelRound,
  applyNovelChapterCompletion,
  emptyNovelWorkspace,
  readNovelWorkspace,
  saveNovelWorkspace,
  novelWorkspaceKey,
  scriptBaseline,
} from "./novelWorkspace";
const makeStorage = () => {
  const values = new Map<string, string>([
    ["mv-manhua-writer-session-v1", "墨菁传原稿"],
    ["canvas", "原画布"],
  ]);
  return {
    values,
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => {
      values.set(k, v);
    },
  };
};
it("独立账号存储、重开恢复、归档新轮次均不改画布", () => {
  const s = makeStorage(),
    d = emptyNovelWorkspace();
  d.topic = "女娲";
  const raw = saveNovelWorkspace(s, "1", null, d);
  expect(readNovelWorkspace(s, "1").value.topic).toBe("女娲");
  expect(readNovelWorkspace(s, "2").value.topic).toBe("");
  const next = archiveNovelRound(s, "1", raw, d);
  expect(next.value.topic).toBe("");
  expect(s.getItem(`${novelWorkspaceKey("1")}:archive:${d.roundId}`)).toContain(
    "女娲"
  );
  expect(s.getItem("mv-manhua-writer-session-v1")).toBe("墨菁传原稿");
  expect(s.getItem("canvas")).toBe("原画布");
});
it("另一分頁更新及损坏草稿均阻止覆盖", () => {
  const s = makeStorage(),
    d = emptyNovelWorkspace();
  const raw = saveNovelWorkspace(s, "1", null, d);
  saveNovelWorkspace(s, "1", raw, { ...d, topic: "另一页" });
  expect(() =>
    saveNovelWorkspace(s, "1", raw, { ...d, topic: "旧页" })
  ).toThrow("另一页面");
  expect(() => archiveNovelRound(s, "1", raw, d)).toThrow();
  s.setItem(novelWorkspaceKey("1"), "{");
  expect(() => readNovelWorkspace(s, "1")).toThrow();
});
it("容量不足时不清空旧轮次", () => {
  const s = makeStorage(),
    d = emptyNovelWorkspace(),
    raw = saveNovelWorkspace(s, "1", null, d);
  const full = {
    getItem: s.getItem,
    setItem: () => {
      throw new Error("quota");
    },
  };
  expect(() => archiveNovelRound(full, "1", raw, d)).toThrow();
  expect(s.getItem(novelWorkspaceKey("1"))).toBe(raw);
});
it("比较基准包含小说、大纲、底本与轮次，但不包含模板", () => {
  const input: any = {
    roundId: "1",
    topic: "t",
    direction: "d",
    outline: "o",
    novel: "n",
    episodeCount: 3,
    templates: [1],
  };
  expect(scriptBaseline(input)).toBe(
    scriptBaseline({ ...input, templates: [2] })
  );
  for (const field of ["novel", "outline", "roundId", "direction"])
    expect(scriptBaseline(input)).not.toBe(
      scriptBaseline({ ...input, [field]: "other" })
    );
});

it("生成期间可改前章或本章，晚回结果不盖掉手动稿", () => {
  const state = emptyNovelWorkspace();
  state.chapters = ["修改后的第一章", "手写第二章"];
  state.pendingChapterBase = "旧第二章";
  const input = {
    requestId: crypto.randomUUID(),
    roundId: state.roundId,
    stage: "chapter" as const,
    topic: "故事",
    direction: "方向",
    templates: [],
    episodeCount: 3 as const,
    chapterIndex: 2,
    outline: "纲",
    novel: "原第一章",
    selectedTemplateIds: [],
  };
  const result = {
    requestId: input.requestId,
    stage: "chapter" as const,
    text: JSON.stringify({
      title: "第二章",
      text: "新正文".repeat(200),
      notes: "接续",
    }),
    templateIds: [],
    inputSha256: "a",
    resultSha256: "b",
  };
  const edited = applyNovelChapterCompletion(state, input, result);
  expect(edited.chapters).toEqual(state.chapters);
  const storage=makeStorage();saveNovelWorkspace(storage,"1",null,{...state,...edited});expect(readNovelWorkspace(storage,"1").value.chapterWarnings).toEqual(edited.chapterWarnings);
  expect(edited.chapterWarnings?.["1"]).toContain("保留手动修改");
  state.chapters[1] = "旧第二章";
  const accepted = applyNovelChapterCompletion(state, input, result);
  expect(accepted.chapters?.[0]).toBe("修改后的第一章");
  expect(accepted.chapters?.[1]).toContain("新正文");
  expect(accepted.chapterWarnings?.["1"]).toContain("前文在生成期间有修改");
});

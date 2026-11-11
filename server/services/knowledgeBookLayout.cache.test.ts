import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ generation: "10", loads: 0 }));
vi.mock("./editableLayoutStore", () => ({
  readCanonicalLayoutLibrary: vi.fn(async () => ({ library: { documents: [] }, generation: state.generation })),
  currentLayoutGeneration: vi.fn(async () => state.generation),
}));
vi.mock("./knowledgePublicationExport", () => ({
  loadKnowledgePublicationExport: vi.fn(async (_o: number, id: string) => {
    state.loads++;
    return {
      doc: { id, title: "册", publication: { source: { detailLevel: "full" } }, pages: [{ id: "p1", headline: "一", body: "正文", imageUrl: "gs://b/1.png" }] },
      review: { pages: [{ imageDescription: "", cautions: [], imageStatus: "absent", facts: [] }] },
      receipt: { sourceImages: [] }, prefix: "x",
    };
  }),
}));
import { knowledgeBookLayoutCache, loadKnowledgeBookLayoutInput, loadKnowledgeBookLayoutView } from "./knowledgeBookLayout";
beforeEach(() => { knowledgeBookLayoutCache.clear(); state.loads = 0; state.generation = "10"; });

it("排版输入同一 generation 复用一次解析；generation 变化重新解析；不同账号互不命中；注入依赖不缓存", async () => {
  const a = await loadKnowledgeBookLayoutInput(7, "doc", {}, { cache: true });
  const b = await loadKnowledgeBookLayoutInput(7, "doc", {}, { cache: true });
  expect(b).toEqual(a); expect(state.loads).toBe(1);
  b.pages[0].body = "调用方改动";
  expect((await loadKnowledgeBookLayoutInput(7, "doc", {}, { cache: true })).pages[0].body).toBe("正文");
  await loadKnowledgeBookLayoutInput(8, "doc", {}, { cache: true });
  expect(state.loads).toBe(2);
  state.generation = "11";
  await loadKnowledgeBookLayoutInput(7, "doc", {}, { cache: true });
  expect(state.loads).toBe(3);
  await loadKnowledgeBookLayoutInput(7, "doc");
  expect(state.loads).toBe(4);
});
it("整册视图命中缓存前仍核对云稿当前版本，版本已变化不返回旧稿", async () => {
  state.generation = "12";
  await expect(loadKnowledgeBookLayoutView(7, "doc", "11", {}, { cache: true })).rejects.toThrow("云稿版本已变化");
  expect(state.loads).toBe(0);
});

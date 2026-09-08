import { describe, expect, it } from "vitest";
import { loadReadingSession, saveReadingSession, readingEditionImages, readingSessionKey, type KnowledgeCardReadingSession } from "./knowledgeCardReadingSession";
const session = (): KnowledgeCardReadingSession => ({ version: 1, id: "session-one", userId: 7, model: "gpt-5.6-sol", files: [{ gcsUri: "gs://test-bucket/test-file", mimeType: "application/pdf", fileName: "原稿.pdf" }], constraints: {}, phase: "reading", selectedMode: "concise", pending: "reading", pageTasks: {} });
const memory = () => { const records = new Map<string, string>(); return { records, getItem: (key: string) => records.get(key) ?? null, setItem: (key: string, value: string) => { records.set(key, value); } }; };
describe("阅读会话恢复与当前版次图片", () => {
  it("阶段、业务状态和两类真实时间经存储刷新完整保留，旧会话仍兼容", () => {
    const store = memory();
    const current = { ...session(), progress: { done: 1, total: 275, stage: "reading:1/1", jobStatus: "running", updatedAt: "2026-09-08T05:00:00.000Z", heartbeatAt: "2026-09-08T05:00:30.000Z" } };
    saveReadingSession(store, current);
    expect(loadReadingSession(store, 7)?.progress).toEqual(current.progress);
    saveReadingSession(store, { ...session(), progress: { done: 0, total: 0 } });
    expect(loadReadingSession(store, 7)?.progress).toEqual({ done: 0, total: 0 });
    expect(() => saveReadingSession(store, { ...current, progress: { ...current.progress, updatedAt: "invalid" } })).toThrow();
  });
  it("在后台请求前保存材料和pending，刷新不丢未知提交", () => {
    const store = memory();
    saveReadingSession(store, session());
    expect(loadReadingSession(store, 7)).toEqual(session());
    expect(loadReadingSession(store, 8)).toBeNull();
  });
  it("更换会话保留原记录，存储失败直接抛错阻止后续提交", () => {
    const store = memory(); saveReadingSession(store, session());
    saveReadingSession(store, { ...session(), id: "session-two" });
    expect(JSON.parse(store.records.get(`${readingSessionKey(7)}/history/session-one`)!).id).toBe("session-one");
    expect(loadReadingSession(store, 7)?.id).toBe("session-two");
    expect(() => saveReadingSession({ setItem: () => { throw Error("测试空间不足"); } }, session())).toThrow("空间不足");
  });
  it("损坏和跨账号记录拒绝恢复", () => {
    const store = memory(); store.setItem(readingSessionKey(8), JSON.stringify(session()));
    expect(() => loadReadingSession(store, 8)).toThrow("不属于");
    store.setItem(readingSessionKey(7), "{}");
    expect(() => loadReadingSession(store, 7)).toThrow();
  });
  it("页任务原样保留attempt和配置，未知状态不能冒充成功图片", () => {
    const store = memory();
    const current = { ...session(), pending: "page" as const, pageTasks: { first: { attempt: 0, status: "pending" as const, subjectPosition: "center" as const, infographicTemplateId: "anatomy", progressJobId: "existing-job" } } };
    saveReadingSession(store, current);
    expect(loadReadingSession(store, 7)?.pageTasks.first).toEqual(current.pageTasks.first);
    expect(readingEditionImages(current)).toEqual([]);
  });
  it("只导出当前版次成功页面，按ordinal排序且不混历史图片", () => {
    const current = session();
    current.edition = { editionId: "edition", planId: "plan", model: current.model, mode: "complete", credits: 200, pages: [4, 2, 1, 3].map(ordinal => ({ pageId: `page-${ordinal}`, ordinal, title: "真实标题", contentMarkdown: "非空正文", visualDirections: "图文对应", referencePageIds: [], imageGsUris: [] })) };
    current.pageTasks = { "page-1": { attempt: 0, status: "succeeded", subjectPosition: "left", imageUrl: "image-one" }, "page-2": { attempt: 0, status: "pending", subjectPosition: "left", imageUrl: "unknown-result" }, "page-4": { attempt: 1, status: "succeeded", subjectPosition: "left", imageUrl: "image-four" }, old: { attempt: 0, status: "succeeded", subjectPosition: "left", imageUrl: "old-image" } };
    expect(readingEditionImages(current)).toEqual(["image-one", "image-four"]);
  });
});

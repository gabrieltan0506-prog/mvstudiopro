import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  knowledgeReviewBatches,
  knowledgeBatchRequestId,
  knowledgeManuscript,
  parseKnowledgeManuscript,
  validateKnowledgeReview,
} from "./knowledgePublication";
import { layoutFromSource } from "./editableLayout";
import { buildKnowledgePublicationHtml } from "./knowledgePublicationHtml";
const source = (count: number) => ({
  title: "地理知识",
  pages: Array.from({ length: count }, (_, i) => ({
    id: randomUUID(),
    headline: `第${i + 1}项`,
    body: `重要说明${i}。`,
    imageUrl: "",
  })),
});
describe("知识卡自动出版合同", () => {
  it("1000页自动完整分批，正文与页身份往返不丢失", () => {
    const s = source(1000),
      batches = knowledgeReviewBatches(s);
    expect(batches).toHaveLength(250);
    expect(batches.flat()).toEqual(s.pages.map((_, i) => i));
    expect(
      parseKnowledgeManuscript(
        knowledgeManuscript(s),
        s.pages.map(p => p.id)
      )
    ).toEqual({
      title: s.title,
      pages: s.pages.map(({ imageUrl, ...p }) => p),
    });
    const root = randomUUID(),
      ids = new Set(
        batches.flatMap((_, i) =>
          [0, 1, 2].map(a => knowledgeBatchRequestId(root, i, a))
        )
      );
    expect(ids.size).toBe(750);
    expect(knowledgeBatchRequestId(root, 999, 1)).toBe(
      knowledgeBatchRequestId(root, 999, 1)
    );
  });
  it("长页不截断，相邻页按文字量拆批，缺页和正文游离必须拒绝", () => {
    const s = source(3);
    s.pages[0].body = "甲".repeat(24001);
    expect(knowledgeReviewBatches(s)).toEqual([[0], [1, 2]]);
    expect(() =>
      parseKnowledgeManuscript(
        knowledgeManuscript(s).replace("## 02｜", "## 04｜"),
        s.pages.map(p => p.id)
      )
    ).toThrow();
    expect(() =>
      parseKnowledgeManuscript("# 标题\n遗漏的正文\n## 01｜标题\n正文", [
        s.pages[0].id,
      ])
    ).toThrow();
  });
  it("有图必须有视觉观察、冲突证据和准确页号", () => {
    const s = source(1);
    s.pages[0].imageUrl = "gs://test/own.png";
    const review = {
      kind: "knowledge_publication_v1",
      sourceDigest: "a".repeat(64),
      title: s.title,
      pages: [
        {
          ...s.pages[0],
          imageUrl: undefined,
          imageStatus: "consistent",
          imageDescription: "",
          facts: [{ term: "知识要点", statement: "测试中的具体知识主张" }],
          cautions: [],
        },
      ],
    };
    delete review.pages[0].imageUrl;
    expect(() =>
      validateKnowledgeReview(review, s, review.sourceDigest)
    ).toThrow("配图审校");
    review.pages[0].imageDescription = "图中为山峰剖面";
    review.pages[0].imageStatus = "conflict";
    expect(() =>
      validateKnowledgeReview(review, s, review.sourceDigest)
    ).toThrow("疑点");
  });
  it("HTML正文不执行注入，审查疑点只留作者面板不进读者正文", () => {
    const doc = layoutFromSource({
      owner: "7",
      sourceId: "x",
      title: "主题",
      body: "<script>alert(1)</script>\n\n## 概念\n\n末句保留",
      kind: "knowledge-publication",
    });
    const review = {
      kind: "knowledge_publication_v1" as const,
      sourceDigest: "a".repeat(64),
      title: doc.title,
      pages: doc.pages.map(p => ({
        id: p.id,
        headline: p.headline,
        body: p.body,
        imageDescription: "",
        imageStatus: "absent" as const,
        facts: [{ term: "知识要点", statement: "测试中的具体知识主张" }],
        cautions: [
          {
            kind: "uncertain" as const,
            evidence: "原始数字冲突",
            message: "请核对两处数字",
          },
        ],
      })),
    };
    const html = buildKnowledgePublicationHtml(doc, review, {});
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("末句保留");
    // 1108（#1751）起审查疑点只保留在作者面板，最终读者正文不再附加待核主张
    expect(html).not.toContain("原始数字冲突");
    expect(html).not.toContain("请核对两处数字");
    // 1108 起书册改直式图文同页，默认页面为竖版 1600×2240
    expect(html).toContain("@page{size:1600px 2240px");
  });
});

import { describe, expect, it, vi } from "vitest";
import { nameKnowledgeEditionTopics, parseKnowledgeTopicTitles } from "./knowledgeTopicTitles";
import { compileKnowledgeEditions, knowledgeEditionParts } from "../../shared/knowledgeCardEdition";
import { knowledgeEditionIllustratedPages, knowledgeEditionImagePlan, planKnowledgeCardPages } from "../../shared/knowledgeCardPagination";
import { synchronizedKnowledgeCardSource } from "../../shared/knowledgeCardEditableLayout";

const longSentence = (i: number, j: number) => `第${i}节第${j}句记述一件具体史实，以及它前后的经过与影响。`;
const book = compileKnowledgeEditions("测试书", Array.from({ length: 40 }, (_, i) => ({
  headline: `原小节${i}`,
  body: Array.from({ length: 30 }, (_, j) => longSentence(i, j)).join(""),
  priority: "primary" as const,
})));

function memoryEvidence() {
  const store = new Map<string, any>();
  return { store, evidence: { prefix: "doc/editions", read: async (k: string) => store.get(k) ?? null, save: async (k: string, v: unknown) => { store.set(k, JSON.parse(JSON.stringify(v))); } } };
}

/** 模拟廉价路由：按输入逐主题回出图片标题、内文标题与每节小标题。 */
function titleInvoke(mutate?: (page: any, index: number) => void) {
  return vi.fn(async (request: any) => {
    const input = JSON.parse(request.contents[0].parts[0].text);
    const pages = input.source.pages.map((p: any, index: number) => {
      const headlines = String(p.body.split("\n")[0]).replace(/^原小节：/, "").split("｜");
      const page = { id: p.id, headline: p.headline, body: "说明", imageDescription: "", imageStatus: "absent", facts: [], cautions: [],
        reading: { version: 1, subtitle: "", accent: "jade", blocks: [
          { type: "prose", title: `图题${index + 1}`, note: "", text: "图" },
          { type: "prose", title: `内文题${index + 1}`, note: "", text: "文" },
          ...headlines.map((h: string) => ({ type: "prose", title: `新${h}`, note: "", text: h })),
        ] } };
      mutate?.(page, index);
      return page;
    });
    const report = { kind: "knowledge_publication_v1", sourceDigest: input.sourceDigest, title: "主题命题", pages };
    return { text: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(report) }] } }] }) } as any;
  });
}

describe("主题图与内文命题：每档一次廉价批量调用", () => {
  it("命题贯穿出图正文、图下内文标题与内文小标题；原始与解析回包分开永久保存，恢复零调用", async () => {
    const { store, evidence } = memoryEvidence();
    const invoke = titleInvoke();
    const named = await nameKnowledgeEditionTopics({ markdown: book.full, model: "glm-5.3-flashx", evidence, invoke });
    expect(named.status).toBe("named");
    expect(invoke).toHaveBeenCalledTimes(1);
    const request = invoke.mock.calls[0]![0] as any;
    expect(request.executionChannel).toBe("openrouter");
    expect(request.executionFamily).toBe("glm");

    const plan = knowledgeEditionImagePlan(named.markdown)!;
    const imagePages = planKnowledgeCardPages(named.markdown).pages;
    expect(imagePages.length).toBe(plan.images.length);
    imagePages.forEach((body, i) => {
      expect(body).toContain(`## 图题${i + 1}`);
      expect(body.length).toBeLessThanOrEqual(1200);
    });
    const pages = knowledgeEditionIllustratedPages(named.markdown)!;
    expect(pages.map(p => p.headline)).toEqual(plan.images.map((_, i) => `内文题${i + 1}`));
    expect(pages.some(p => /### 新原小节\d+/.test(p.supplement))).toBe(true);
    expect(pages.every(p => !/### 原小节\d+/.test(p.supplement))).toBe(true);

    // 排版源：headline 为内文标题、supplement 带新小标题
    const source = synchronizedKnowledgeCardSource({ owner: "1", sourceId: "s", fullMarkdown: named.markdown, illustrationMarkdown: named.markdown,
      detailLevel: "full", imageJobIds: plan.images.map((_, i) => `job-${i}`) });
    expect(source.pages!.map(p => p.headline)).toEqual(pages.map(p => p.headline));
    expect(source.pages![0]!.supplement).toContain("### 新原小节");

    const keys = Array.from(store.keys());
    const raw = keys.find(k => k.endsWith("/raw.json"))!, parsed = keys.find(k => k.endsWith("/parsed.json"))!;
    expect(raw).toContain("/topic-titles/full-");
    expect(store.get(raw).responseText).toContain("candidates");
    expect(Object.keys(store.get(parsed).titles)).toHaveLength(plan.images.length);
    expect(keys.some(k => k.endsWith("/request.json"))).toBe(true);

    const again = await nameKnowledgeEditionTopics({ markdown: book.full, model: "glm-5.3-flashx", evidence, invoke });
    expect(again.status).toBe("cached");
    expect(again.markdown).toBe(named.markdown);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("标题注释不进入正文：两档解析后的阅读稿与知识稿不含注释", async () => {
    const { evidence } = memoryEvidence();
    const named = await nameKnowledgeEditionTopics({ markdown: book.full, evidence, invoke: titleInvoke() });
    const parts = knowledgeEditionParts(named.markdown)!;
    expect(parts.knowledge).not.toContain("knowledge-topic-titles");
    expect(parts.modules).toEqual(knowledgeEditionParts(book.full)!.modules);
  });

  it("调用失败回退机械标题与原小节标题，记录失败且不重复购买", async () => {
    const { store, evidence } = memoryEvidence();
    const invoke = vi.fn(async () => { throw new Error("上游不可用"); });
    const result = await nameKnowledgeEditionTopics({ markdown: book.full, evidence, invoke: invoke as any });
    expect(result.status).toBe("fallback");
    expect(result.markdown).toBe(book.full);
    expect(planKnowledgeCardPages(result.markdown).pages[0]).toMatch(/## 原小节0（等\d+节）/);
    expect(knowledgeEditionIllustratedPages(result.markdown)![0]!.supplement).toContain("### 原小节0");
    expect(Array.from(store.keys()).some(k => k.endsWith("/failure.json"))).toBe(true);
    await nameKnowledgeEditionTopics({ markdown: book.full, evidence, invoke: invoke as any });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("小节标题数量对不上时只回退该主题小节标题；不合格标题回退", () => {
    const topics = [{ id: "topic-1", headlines: ["甲", "乙"] }, { id: "topic-2", headlines: ["丙"] }]; // 解析只按 id 对应
    const { titles, rejected } = parseKnowledgeTopicTitles({ pages: [
      { id: "topic-1", reading: { blocks: [{ title: "图一" }, { title: "文一" }, { title: "新甲" }] } },
      { id: "topic-2", reading: { blocks: [{ title: "这是一个远远超过二十四个字上限的非常非常非常长的图片标题啊啊" }, { title: "文二" }, { title: "新丙" }] } },
    ] }, topics);
    expect(titles["甲｜乙"]).toEqual({ image: "图一", reading: "文一", sections: {} });
    expect(titles["丙"]).toEqual({ image: undefined, reading: "文二", sections: { 丙: "新丙" } });
    expect(rejected.length).toBe(2);
  });
});

describe("1108g2 回归：模型照抄字段名", () => {
  it("回包全是“图片标题/图下内文标题”时不采用，出图与内文回退机械标题和原小节标题；提示词不再含占位值", async () => {
    const { evidence } = memoryEvidence();
    const invoke = titleInvoke(page => {
      page.reading.blocks = page.reading.blocks.map((b: any, i: number) => ({ ...b, title: i === 0 ? "图片标题" : i === 1 ? "图下内文标题" : "该节内文小标题" }));
    });
    const result = await nameKnowledgeEditionTopics({ markdown: book.full, evidence, invoke });
    const prompt = (invoke.mock.calls[0]![0] as any).systemInstruction.parts[0].text as string;
    expect(prompt).not.toMatch(/title:"(?:图片标题|图下内文标题|该节内文小标题)"/);
    const plan = knowledgeEditionImagePlan(result.markdown)!;
    expect(plan.images.every(i => /（等\d+节）$|^原小节\d+$/.test(i.title))).toBe(true);
    expect(plan.images.every(i => i.readingTitle === i.title)).toBe(true);
    expect(knowledgeEditionIllustratedPages(result.markdown)!.map(p => p.supplement).join("")).not.toContain("该节内文小标题");
  });
});

describe("经真实知识整理路由合同校验", () => {
  it("命题回包通过路由结构校验后标题仍可取回", async () => {
    const { invokeKnowledgePublicationRoutes } = await import("./knowledgePublicationRoutes");
    const { evidence } = memoryEvidence();
    let captured: any;
    const fetchMock = vi.fn(async (_url: any, init: any) => {
      const body = JSON.parse(init.body);
      captured = body;
      const user = body.messages.find((m: any) => m.role === "user");
      const text = typeof user.content === "string" ? user.content : user.content.map((c: any) => c.text || "").join("");
      const input = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
      const report = { kind: "knowledge_publication_v1", sourceDigest: input.sourceDigest, title: "主题命题", pages: input.source.pages.map((p: any, index: number) => {
        const headlines = String(p.body.split("\n")[0]).replace(/^原小节：/, "").split("｜");
        return { id: p.id, headline: p.headline, body: "本主题说明", imageDescription: "", imageStatus: "absent", facts: [{ term: "主题", statement: "本主题说明" }], cautions: [],
          reading: { version: 1, subtitle: "", accent: "jade", blocks: [
            { type: "prose", title: `图题${index + 1}`, note: "", text: "图片标题" },
            { type: "prose", title: `内文题${index + 1}`, note: "", text: "内文标题" },
            ...headlines.map((h: string) => ({ type: "prose", title: `新${h}`, note: "", text: h })),
          ] } };
      }) };
      return new Response(JSON.stringify({ model: body.model, choices: [{ finish_reason: "stop", message: { content: JSON.stringify(report) } }], usage: { prompt_tokens: 10, completion_tokens: 10 } }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const deps = { key: () => "test-key", sign: () => "https://example.invalid/x.png", fetch: fetchMock } as any;
    const result = await nameKnowledgeEditionTopics({ markdown: book.full, model: "glm-5.3-flashx", evidence,
      invoke: (request, scope) => invokeKnowledgePublicationRoutes(request, scope, deps) });
    expect(result.message).toBeUndefined();
    expect(result.status).toBe("named");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(captured.model)).toMatch(/glm|flash/i);
    const pages = knowledgeEditionIllustratedPages(result.markdown)!;
    expect(pages[0]!.headline).toBe("内文题1");
    expect(planKnowledgeCardPages(result.markdown).pages[0]).toContain("## 图题1");
  });
});

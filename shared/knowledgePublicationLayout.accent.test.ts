import { describe, expect, it } from "vitest";
import { knowledgeReadingSchema, normalizeKnowledgeAccent } from "./knowledgePublicationLayout";
import { knowledgeBookLayoutPlanSchema } from "./knowledgeBookLayout";

describe("reading accent normalization", () => {
  it("maps near color names into the allowed four", () => {
    expect(normalizeKnowledgeAccent("Teal")).toBe("indigo");
    expect(normalizeKnowledgeAccent("emerald")).toBe("jade");
    expect(normalizeKnowledgeAccent("gold")).toBe("ochre");
    expect(normalizeKnowledgeAccent("cinnabar")).toBe("rose");
    expect(normalizeKnowledgeAccent("朱砂")).toBe("rose");
    expect(normalizeKnowledgeAccent("whatever")).toBe("indigo");
    expect(normalizeKnowledgeAccent("jade")).toBe("jade");
  });
  it("accepts reading with off-list accent", () => {
    const r = knowledgeReadingSchema.parse({ version: 1, subtitle: "", accent: "crimson", blocks: [{ type: "prose", title: "t", note: "", text: "x" }] });
    expect(r.accent).toBe("rose");
  });
  it("lifts stray presentation subtitle into reading, still rejects other unknown keys", () => {
    const reading = { version: 1, subtitle: "", accent: "jade", blocks: [{ type: "prose", title: "t", note: "", text: "x" }] };
    const base = { kind: "knowledge_book_layout_v1", sourceDigest: "a".repeat(64) };
    const pageId = "11111111-1111-4111-8111-111111111111";
    const ok = knowledgeBookLayoutPlanSchema.parse({ ...base, chapters: [{ pageId, presentation: { reading, imageEvidencePageIds: [], reason: "r", subtitle: "引导" } }] });
    expect(ok.chapters[0].presentation!.reading.subtitle).toBe("引导");
    expect(() => knowledgeBookLayoutPlanSchema.parse({ ...base, chapters: [{ pageId, presentation: { reading, imageEvidencePageIds: [], reason: "r", junk: 1 } }] })).toThrow();
  });
});

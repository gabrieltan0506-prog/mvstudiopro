import { describe, expect, it } from "vitest";
import {
  artMotionSpecSchema,
  artMotionGrammarDraft,
  defaultArtMotionSpec,
} from "./artMotion";
import { ART_MOTION_GRAMMARS, ART_MOTION_STYLES } from "./artMotionCatalog";
import {
  imageWorldPlatePrompt,
  imageWorldObjectPrompt,
  imageWorldStateSchema,
  parseImageWorldAnalysis,
} from "./imageWorld";
import {
  creativeStudioActionSchema,
  creativeStudioRevision,
} from "./creativeStudio";
describe("creative studio contracts", () => {
  it("constructs all supported grammar drafts with real cue/data producers", () => {
    for (const g of ART_MOTION_GRAMMARS) {
      const spec = artMotionGrammarDraft(defaultArtMotionSpec(), g.id);
      expect(artMotionSpecSchema.parse(spec).grammar).toBe(g.id);
    }
    expect(ART_MOTION_STYLES).toHaveLength(35);
    expect(ART_MOTION_GRAMMARS).toHaveLength(8);
  });
  it("rejects hidden URLs, unsupported cues, empty charts, missing images and out-of-range events", () => {
    const s = defaultArtMotionSpec();
    for (const bad of [
      { ...s, data: { url: "https://example.org" } },
      { ...s, cues: [{ at: 0, kind: "image" }] },
      { ...s, grammar: "t3_finance_chart", data: {} },
      { ...s, cues: [{ at: 8, kind: "point", text: "late" }] },
    ])
      expect(artMotionSpecSchema.safeParse(bad).success).toBe(false);
    expect(
      artMotionSpecSchema.safeParse({
        ...s,
        grammar: "y2_vox",
        cues: [{ at: 0, kind: "image", imageUri: "gs://owned/picture.png" }],
      }).success
    ).toBe(true);
  });
  it("preserves every independent instance, recompiles edits and never truncates extra evidence", () => {
    const objects = [
      {
        id: "cup-left",
        name: "杯",
        description: "白瓷杯",
        position: "左边",
        selected: true,
      },
      {
        id: "cup-right",
        name: "杯",
        description: "黑陶杯",
        position: "右边",
        selected: true,
      },
    ];
    const plan = parseImageWorldAnalysis(
      JSON.stringify({ scene: "暖光木桌", objects })
    );
    expect(plan.objects).toHaveLength(2);
    expect(imageWorldPlatePrompt(plan)).toContain("左边");
    expect(imageWorldPlatePrompt(plan)).toContain("右边");
    expect(imageWorldObjectPrompt(objects[0])).not.toEqual(
      imageWorldObjectPrompt({ ...objects[0], description: "蓝瓷杯" })
    );
    expect(() =>
      parseImageWorldAnalysis(
        JSON.stringify({
          scene: "room",
          objects: Array.from({ length: 13 }, (_, i) => ({
            ...objects[0],
            id: `cup-${i}`,
          })),
        })
      )
    ).toThrow();
    expect(
      imageWorldStateSchema.parse({
        version: 1,
        sourceBlockId: "image",
        sourceUrl: "gs://owned/source",
        plan,
      }).pending
    ).toEqual({});
  });
  it("advisor accepts structured configuration only and revisions change with content", () => {
    const s = defaultArtMotionSpec();
    expect(
      creativeStudioActionSchema.safeParse({
        action: "creativeStudio",
        tool: "artMotion",
        operation: "configure",
        spec: s,
        blockId: "node",
        revision: "old",
      }).success
    ).toBe(true);
    expect(creativeStudioRevision(s)).not.toEqual(
      creativeStudioRevision({ ...s, title: "changed" })
    );
    expect(
      creativeStudioActionSchema.safeParse({
        action: "creativeStudio",
        tool: "artMotion",
        operation: "submit",
      }).success
    ).toBe(false);
  });
});
it("reserved object keys and oversized world prompts fail without truncation", async () => {
  const { imageWorldPlanSchema, imageWorldEmptyPrompt } = await import(
    "./imageWorld"
  );
  for (const id of ["world", "__proto__", "constructor", "prototype"])
    expect(
      imageWorldPlanSchema.safeParse({
        scene: "场景",
        objects: [
          { id, name: "物件", position: "左", description: "独立物件" },
        ],
      }).success
    ).toBe(false);
  const plan = imageWorldPlanSchema.parse({
    scene: "景".repeat(1600),
    objects: Array.from({ length: 12 }, (_, i) => ({
      id: `item-${i}`,
      name: "物".repeat(80),
      position: "左".repeat(120),
      description: "独立",
    })),
  });
  expect(() => imageWorldEmptyPrompt(plan)).toThrow("2000");
  const { normalizeArtMotionJobStatus } = await import("./artMotion");
  expect(normalizeArtMotionJobStatus("canceled")).toBe("cancelled");
  expect(() => normalizeArtMotionJobStatus("mystery")).toThrow();
});

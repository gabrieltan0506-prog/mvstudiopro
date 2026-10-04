import { expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { ManhuaViralTemplateCard } from "../../shared/manhuaViralTemplateBank";
import { toPublicManhuaViralTemplateCard } from "../../shared/manhuaViralTemplateBank";
vi.mock("./manhuaTemplateMethodBriefs.json", () => ({
  default: {
    TEST: {
      sha256: createHash("sha256")
        .update(
          JSON.stringify({
            methods: "私有节奏",
            sound: "私有声音",
            structure: null,
            classification: null,
          })
        )
        .digest("hex"),
      brief: {
        title: "动作与静默",
        highlights: ["先交代空间，再让脚步声逼近。"],
        useWhen: "受限空间中的等待。",
      },
    },
  },
}));
import { buildManhuaTemplateMethodBrief } from "./manhuaTemplateMethodBrief";
it("核对学习内容版本；任何已审依据变化就不冒用旧说明", () => {
  const card = {
    publicCode: "TEST",
    status: "approved",
    reusableZh: "私有节奏",
    audioStory: { reusableAudioZh: "私有声音" },
    beatGrid: [],
    laneZh: "悬疑权谋",
  } as unknown as ManhuaViralTemplateCard;
  const brief = buildManhuaTemplateMethodBrief(card);
  expect(brief?.title).toBe("动作与静默");
  for (const change of [
    { reusableZh: "新节奏" },
    { audioStory: { reusableAudioZh: "新声音" } },
    { status: "proposed" },
    { publicCode: "NEW1" },
  ])
    expect(
      buildManhuaTemplateMethodBrief({
        ...card,
        ...change,
      } as ManhuaViralTemplateCard)
    ).toBeUndefined();
  const json = JSON.stringify(
    toPublicManhuaViralTemplateCard(card, null, undefined, brief)
  );
  expect(json).toContain("脚步声");
  for (const secret of ["私有节奏", "私有声音", "sha256", "sourceRefs"])
    expect(json).not.toContain(secret);
});

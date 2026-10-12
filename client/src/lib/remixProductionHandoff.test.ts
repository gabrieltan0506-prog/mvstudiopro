import { describe, expect, it } from "vitest";
import { draftFromEvidence } from "@shared/remixDraft";
import {
  parseNovelDraft,
  prepareNovelExcerpt,
} from "@shared/manhuaNovelSource";
import { remixToNovelDraft } from "./remixProductionHandoff";

describe("复刻稿采用到编剧室", () => {
  it("逐镜保留全文、时长、音轨和章节边界，真实原文消费者可读", () => {
    const draft = draftFromEvidence(
      {
        remixExecution: {
          shootingBlueprint: {
            storyboard: Array.from(
              { length: 9 },
              (_, i) => `动作${i}：` + "正文与对白。".repeat(20)
            ),
          },
        },
      },
      "video",
      "使用自有素材"
    );
    draft.units[0].durationSeconds = 240;
    draft.units[0].sound = "脚步声从画外进入";
    const novel = remixToNovelDraft(draft);
    expect(parseNovelDraft(novel)).not.toBeNull();
    expect(novel.chapters).toHaveLength(9);
    expect(novel.text).toContain(draft.units[8].content);
    expect(prepareNovelExcerpt(novel)?.text).toContain("脚步声从画外进入");
    expect(prepareNovelExcerpt(novel)?.text).toContain("240秒");
    expect(prepareNovelExcerpt({ ...novel, from: 8, to: 8 })?.text).toContain("使用自有素材");
  });
  it("超出消费容量明确拒绝，不损坏原稿", () => {
    const draft = draftFromEvidence(
      {
        remixExecution: {
          shootingBlueprint: { storyboard: ["长".repeat(400001)] },
        },
      },
      "video",
      ""
    );
    expect(() => remixToNovelDraft(draft)).toThrow("40万字");
    expect(draft.units[0].content.length).toBe(400001);
  });
});

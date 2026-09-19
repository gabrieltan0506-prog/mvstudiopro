import { describe, it, expect } from "vitest";
import {
  normalizeManhuaEditTransitions,
  manhuaEditTransitionOf,
  manhuaAssembleTransitionOf,
} from "./manhuaEditTransition";
import {
  manhuaFinalCutSourceKey,
  manhuaFinalCutStaleOf,
} from "./manhuaFinalCutSource";
import {
  buildManhuaWriterSession,
  parseManhuaWriterSession,
  serializeManhuaWriterSession,
} from "./manhuaWriterSession";
import {
  serializeManhuaCloudDraftPayload,
  parseManhuaCloudDraftPayload,
} from "./manhuaCloudDraft";
import { buildManhuaAssembleJobInput } from "./manhuaAssembleJobInput";
describe("按集转场真实合同", () => {
  const clips = [
    {
      blockId: "clip-e1",
      episodeIndex: 1,
      segmentIndex: 1,
      clipUrl: "https://example.com/a.mp4",
    },
  ];
  it("旧草稿淡化沿用完全相同源键，直切变旧，切回恢复", () => {
    const old = manhuaFinalCutSourceKey(clips);
    expect(manhuaFinalCutSourceKey(clips, "fade")).toBe(old);
    expect(
      manhuaFinalCutStaleOf({
        versionSourceKey: old,
        currentSourceKey: manhuaFinalCutSourceKey(clips, "cut"),
        currentCount: 1,
      }).stale
    ).toBe(true);
    expect(
      manhuaFinalCutStaleOf({
        versionSourceKey: old,
        currentSourceKey: manhuaFinalCutSourceKey(clips, "fade"),
        currentCount: 1,
      }).stale
    ).toBe(false);
    expect(
      manhuaEditTransitionOf(
        buildManhuaWriterSession({}).editTransitionByEpisode,
        1
      )
    ).toBe("fade");
  });
  it("本机JSON与云草稿恢复按集设置，拒绝未知值，实际请求消费", () => {
    const writerSession = buildManhuaWriterSession({
      editTransitionByEpisode: {
        "1": "cut",
        "2": "fade",
        "3": "evil" as never,
      },
    });
    expect(
      parseManhuaWriterSession(serializeManhuaWriterSession(writerSession))
        ?.editTransitionByEpisode
    ).toEqual({ "1": "cut", "2": "fade" });
    const cloud = parseManhuaCloudDraftPayload(
      JSON.parse(
        serializeManhuaCloudDraftPayload({
          format: "mv-manhua-cloud-draft-v1",
          clientUpdatedAt: new Date(0).toISOString(),
          writerSession,
          canvas: { blocks: [], edges: [] },
        })
      )
    );
    expect(cloud?.writerSession.editTransitionByEpisode).toEqual({
      "1": "cut",
      "2": "fade",
    });
    expect(
      buildManhuaAssembleJobInput({
        clips,
        transition: manhuaAssembleTransitionOf(
          cloud!.writerSession.editTransitionByEpisode!,
          clips
        )!,
      }).params.transition
    ).toBe("cut");
    expect(
      manhuaAssembleTransitionOf(writerSession.editTransitionByEpisode!, [
        { episodeIndex: 1 },
        { episodeIndex: 2 },
      ])
    ).toBeNull();
    expect(
      normalizeManhuaEditTransitions({ "0": "cut", "01": "cut", "2": "wipe" })
    ).toEqual({});
  });
});

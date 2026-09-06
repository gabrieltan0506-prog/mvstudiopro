import { describe, expect, it } from "vitest";
import {
  resolveActiveLookSetIdsForSegment,
  listManhuaLookReferenceCandidates,
  type ManhuaCharacterLookSet,
} from "./manhuaCharacterLookSets";
import {
  buildManhuaCloudDraftPayload,
  parseManhuaCloudDraftPayload,
} from "./manhuaCloudDraft";
import {
  saveManhuaWriterSessionToStorage,
  loadManhuaWriterSessionFromStorage,
} from "./manhuaWriterSession";

const lookSets: ManhuaCharacterLookSet[] = [
  { id: "heiqi-before", characterId: "heiqi", index: 1, labelZh: "变身前" },
  { id: "heiqi-after", characterId: "heiqi", index: 2, labelZh: "变身后" },
  { id: "ajing-default", characterId: "ajing", index: 1, labelZh: "阿菁常服" },
];

describe("本段造型归属", () => {
  it("同角色候选可作为造型图，但其他角色和待复核图片不入选", () => {
    const candidates = listManhuaLookReferenceCandidates(
      [
        {
          id: "a",
          role: "character",
          claimedAnchorIds: ["heiqi"],
          url: "https://test.invalid/a.png",
        },
        {
          id: "b",
          role: "character",
          claimedAnchorIds: ["ajing"],
          url: "https://test.invalid/b.png",
        },
        {
          id: "c",
          role: "character",
          claimedAnchorIds: ["heiqi"],
          reviewStatus: "needs_review",
          url: "https://test.invalid/c.png",
        },
        { id: "d", role: "wardrobe", url: "https://test.invalid/d.png" },
      ],
      "heiqi"
    );
    expect(candidates.map(r => r.id)).toEqual(["a", "d"]);
  });
  it("三套造型与不同集段选择通过本机及云稿保存恢复，不互相覆盖", () => {
    const binding = {
      "e1:s1": { heiqi: "heiqi-before" },
      "e1:s2": { heiqi: "heiqi-after" },
      "e2:s1": { heiqi: "heiqi-before" },
    };
    const input = { characterLookSets: lookSets, segmentLookBindings: binding };
    let saved = "";
    saveManhuaWriterSessionToStorage(input, {
      setItem: (_key, value) => {
        saved = value;
      },
    });
    const local = loadManhuaWriterSessionFromStorage({ getItem: () => saved });
    expect(local?.characterLookSets).toHaveLength(3);
    expect(local?.segmentLookBindings).toEqual(binding);
    const cloud = parseManhuaCloudDraftPayload(
      JSON.stringify(
        buildManhuaCloudDraftPayload({
          writerSession: local!,
          blocks: [],
          edges: [],
        })
      )
    );
    expect(cloud?.writerSession.characterLookSets).toEqual(
      local?.characterLookSets
    );
    expect(cloud?.writerSession.segmentLookBindings).toEqual(binding);
  });
  it("一人手选不丢掉另一位出演角色的默认造型", () => {
    expect(
      resolveActiveLookSetIdsForSegment({
        lookSets,
        binding: { heiqi: "heiqi-after" },
        fallbackCharacterIds: ["heiqi", "ajing"],
      })
    ).toEqual(["heiqi-after", "ajing-default"]);
  });
  it("造型不能跨角色错绑，也不能以默认造型代替失效的明确选择", () => {
    for (const id of ["ajing-default", "missing"]) {
      expect(() =>
        resolveActiveLookSetIdsForSegment({
          lookSets,
          binding: { heiqi: id },
          fallbackCharacterIds: ["heiqi"],
        })
      ).toThrow(/造型/);
    }
  });
  it("本段未出演角色的历史手选不混入引用", () => {
    expect(
      resolveActiveLookSetIdsForSegment({
        lookSets,
        binding: { ajing: "ajing-default" },
        fallbackCharacterIds: ["heiqi"],
      })
    ).toEqual(["heiqi-before"]);
  });
  it("明确无角色时不拿整集绑定兜底", () => {
    expect(
      resolveActiveLookSetIdsForSegment({
        lookSets,
        binding: { heiqi: "heiqi-after" },
        fallbackCharacterIds: [],
      })
    ).toEqual([]);
  });
  it("未提供出演范围的旧调用仍可按合法明确选择工作", () => {
    expect(
      resolveActiveLookSetIdsForSegment({
        lookSets,
        binding: { heiqi: "heiqi-after" },
      })
    ).toEqual(["heiqi-after"]);
  });
});

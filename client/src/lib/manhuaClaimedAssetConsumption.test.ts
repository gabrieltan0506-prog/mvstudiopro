import {
  defaultCanvasBlock,
  collectVisionImages,
  collectUpstreamTexts,
} from "./canvasTypes";
import { describe, it, expect } from "vitest";
import {
  buildManhuaAssetLockRegistry,
  resolveManhuaSegmentClipAllowedAssets,
  resolveManhuaSegmentCastZh,
  parseManhuaAssetImageBindBlock,
  resolveManhuaAssetImageBindRows,
  formatManhuaAssetImageBindBlock,
  buildManhuaAssetPathById,
} from "@shared/manhuaAssetLockRegistry";
import { consumableManhuaCustomAssetRefsForCanon } from "@shared/manhuaAssetScriptSync";
import { compileManhuaDialogueTtsPlan } from "@shared/manhuaDialogueTtsCompile";
import type { ManhuaCustomAssetRef } from "@shared/manhuaCustomAssetRefs";
import type { ManhuaWriterAssetCanon } from "@shared/manhuaWriterAssetCanon";
import {
  spawnManhuaDramaStudio,
  expandManhuaShotKeyartsAfterReverse,
  ensureManhuaFragmentClips,
  resolveManhuaClipRelatedAssetNodeIds,
  syncManhuaClipAssetEdges,
} from "./canvasDramaStudio";
const canon: ManhuaWriterAssetCanon = {
  characters: [
    {
      id: "wa_char_1",
      role: "character",
      nameZh: "沈青禾",
      lookZh: "素衣",
      promptZh: "素衣",
    },
    {
      id: "wa_char_2",
      role: "character",
      nameZh: "娘",
      lookZh: "布衣",
      promptZh: "布衣",
    },
  ],
  locations: [],
  props: [],
  episodeMainSceneId: {},
};
const ref = (id: string, anchorId: string): ManhuaCustomAssetRef => ({
  id,
  role: "character",
  url: `https://offline.invalid/${id}.png`,
  labelZh: `文件-${id}-编辑版`,
  source: "upload",
  claimedAnchorIds: [anchorId],
  claimSource: "manual",
  reviewStatus: "accepted",
  refDuty: "identity",
  primaryBindings: [{ anchorId, duty: "identity" }],
});
const refs = [
  ref("cust_selected", "wa_char_1"),
  ref("cust_mother", "wa_char_2"),
];
const makeRegistry = (items = refs, c = canon) =>
  buildManhuaAssetLockRegistry({
    assetCanon: c,
    customRefs: consumableManhuaCustomAssetRefsForCanon(items, c),
  });
function prepare() {
  const spawned = spawnManhuaDramaStudio({
    topic: "匿名身份消费探针",
    episodeIndex: 1,
    videoModel: "seedance-2.0-mini",
  });
  const reverse = spawned.blocks.find(b => b.id.startsWith("reverse-"))!;
  const text =
    "|镜号|约时码|景别|角度|运镜|灯光|构图|主体动作|音频|转场/卡点|时长建议|\n|---|---|---|---|---|---|---|---|---|---|---|\n|01|0:00|中景|平视|固定|自然|双人|沈青禾扶娘入门|娘：「慢点。」|直切|4s|\n|02|0:04|近景|平视|固定|自然|双人|沈青禾回头|沈青禾：「好。」|直切|3s|";
  const expanded = expandManhuaShotKeyartsAfterReverse(
    spawned.blocks.map(b =>
      b.id === reverse.id
        ? { ...b, status: "done" as const, outputText: text }
        : b
    ),
    spawned.edges,
    reverse.id,
    { videoModel: "seedance-2.0-mini" }
  );
  return {
    ...expanded,
    blocks: expanded.blocks.map(b =>
      b.id.startsWith("keyart-")
        ? {
            ...b,
            status: "done" as const,
            outputUrl: `https://offline.invalid/${b.id}.png`,
          }
        : b
    ),
  };
}
describe("明确认领身份贯通登记、段绑定和对白", () => {
  it("长文件名与稳定cust ID保留，唯一认领桥接当前canon，未默认改图", () => {
    const registry = makeRegistry();
    expect(
      registry.byRole.character.map(s => [s.id, s.seedLibraryId, s.path])
    ).toEqual(refs.map(r => [r.id, r.claimedAnchorIds![0], r.url]));
    const allowed = resolveManhuaSegmentClipAllowedAssets({
      registry,
      assetCanon: canon,
      haystack: "沈青禾走进门",
    });
    expect(allowed.characterIds).toEqual(["cust_selected"]);
  });
  it("单字称呼只按当前canon明确角色栏认领，不因正文一个字猜人", () => {
    const registry = makeRegistry();
    expect(
      resolveManhuaSegmentClipAllowedAssets({
        registry,
        assetCanon: canon,
        haystack: "姑娘出门",
      }).characterIds
    ).toEqual([]);
    expect(
      resolveManhuaSegmentClipAllowedAssets({
        registry,
        assetCanon: canon,
        haystack: "",
        castZh: "娘",
      }).characterIds
    ).toEqual(["cust_mother"]);
    expect(
      resolveManhuaSegmentClipAllowedAssets({
        registry,
        assetCanon: canon,
        haystack: "",
        castZh: "新娘",
      }).characterIds
    ).toEqual([]);
  });
  it("旧图候选保留但显式采用版本不被替换", () => {
    const old = { ...ref("cust_old", "wa_char_1"), primaryBindings: [] };
    const registry = makeRegistry([...refs, old]);
    expect(registry.byRole.character.map(s => s.id)).not.toContain("cust_old");
    expect(old.url).toBe("https://offline.invalid/cust_old.png");
  });
  it("清除认领、旧canon与多锚点歧义不借用另一人的身份", () => {
    const cleared = { ...refs[0]!, claimedAnchorIds: [], labelZh: "沈青禾" };
    expect(makeRegistry([cleared]).byRole.character).toHaveLength(0);
    expect(
      makeRegistry([{ ...refs[0]!, claimedAnchorIds: ["wa_old"] }]).byRole
        .character
    ).toHaveLength(0);
    const ambiguous = {
      ...refs[0]!,
      claimedAnchorIds: ["wa_char_1", "wa_char_2"],
    };
    const registry = makeRegistry([ambiguous]);
    expect(registry.byRole.character[0]?.seedLibraryId).toBeNull();
    expect(
      resolveManhuaSegmentClipAllowedAssets({
        registry,
        assetCanon: canon,
        haystack: "沈青禾进门",
      }).characterIds
    ).toEqual([]);
  });
  it("真实铺段读取镜内明确说话人，单字称呼与当前选图进入Image行及TTS", () => {
    const ready = prepare();
    const original = JSON.stringify(ready.blocks);
    const result = ensureManhuaFragmentClips(ready.blocks, ready.edges, 1, {
      assetCanon: canon,
      customRefs: refs,
      videoModel: "seedance-2.0-mini",
    });
    const clips = result.blocks.filter(b => b.id.startsWith("clip-"));
    const clip = clips.find(b => b.manhuaAutoSegment)!;
    expect(clip).toBeDefined();
    const rows = parseManhuaAssetImageBindBlock(clip.prompt);
    expect(
      rows
        .filter(r => r.tag.startsWith("@角色"))
        .map(r => r.id)
        .sort()
    ).toEqual(["cust_mother", "cust_selected"]);
    const resolved = resolveManhuaAssetImageBindRows(
      rows,
      buildManhuaAssetPathById(makeRegistry())
    );
    expect(resolved.map(r => r.path).sort()).toEqual(
      refs.map(r => r.url).sort()
    );
    const tts = compileManhuaDialogueTtsPlan(clip.prompt);
    expect(tts.map(line => line.dialogueZh)).toEqual(["慢点。", "好。"]);
    expect(tts.map(line => line.speakerTag)).toEqual(["@角色2", "@角色1"]);
    expect(result.assetMismatch).toBeNull();
    expect(result.assetNoFaceLock).toBeNull();
    expect(JSON.stringify(ready.blocks)).toBe(original);
  });
  it("同一角色独立脸图与造型图仍使用锁脸身份，不误判成同名不同人", () => {
    const ready = prepare();
    const look = {
      ...ref("cust_look", "wa_char_1"),
      refDuty: "look" as const,
      primaryBindings: [{ anchorId: "wa_char_1", duty: "look" as const }],
    };
    const result = ensureManhuaFragmentClips(ready.blocks, ready.edges, 1, {
      assetCanon: canon,
      customRefs: [...refs, look],
      videoModel: "seedance-2.0-mini",
    });
    const clip = result.blocks.find(b => b.manhuaAutoSegment)!;
    const lines = compileManhuaDialogueTtsPlan(clip.prompt);
    expect(lines.find(line => line.dialogueZh === "好。")?.speakerTag).toBe(
      "@角色1"
    );
  });
  it("同名不同角色不会把姓名强行映射到最后一个图片身份", () => {
    const ready = prepare();
    const duplicate = {
      ...canon,
      characters: [
        canon.characters[0]!,
        { ...canon.characters[0]!, id: "wa_char_other" },
        canon.characters[1]!,
      ],
    };
    const result = ensureManhuaFragmentClips(ready.blocks, ready.edges, 1, {
      assetCanon: duplicate,
      customRefs: [...refs, ref("cust_other", "wa_char_other")],
      videoModel: "seedance-2.0-mini",
    });
    const clip = result.blocks.find(b => b.manhuaAutoSegment)!;
    const lines = compileManhuaDialogueTtsPlan(clip.prompt);
    expect(lines.some(line => line.dialogueZh === "好。")).toBe(false);
    expect(clip.prompt).toContain("沈青禾");
  });
  it("明确对白人物缺图必须回报未锁脸，不能误报无人出场", () => {
    const ready = prepare();
    const result = ensureManhuaFragmentClips(ready.blocks, ready.edges, 1, {
      assetCanon: canon,
      customRefs: [refs[0]!],
      videoModel: "seedance-2.0-mini",
    });
    expect(result.assetNoFaceLock?.segmentIndexes).toContain(1);
    expect(result.assetNoFaceLock?.castNames).toContain("娘");
  });
});

it("已采用角色只连入相同版本的完整视觉来源，历史数组不能偷带另一版", () => {
  const registry = makeRegistry();
  const prompt = formatManhuaAssetImageBindBlock(registry);
  const selected = refs[0]!.url;
  const selectedNode = {
    ...defaultCanvasBlock("image", 0, 0),
    id: "charsheet-wa_char_1-selected",
    prompt: "当前版本",
    outputUrl: selected,
  };
  const otherNode = {
    ...selectedNode,
    id: "charsheet-wa_char_1-other",
    prompt: "另一版本不应进入",
    outputUrl: "https://offline.invalid/other.png",
  };
  const mixed = {
    ...selectedNode,
    id: "charsheet-wa_char_1-history",
    outputUrls: [selected, "https://offline.invalid/other.png"],
  };
  const primaryOther = {
    ...otherNode,
    id: "charsheet-wa_char_1-primary-other",
    outputUrls: [selected],
  };
  const inputOther = {
    ...selectedNode,
    id: "charsheet-wa_char_1-input-other",
    refImageUrl: "https://offline.invalid/input.png",
  };
  const pending = {
    ...selectedNode,
    id: "charsheet-wa_char_1-pending",
    outputUrl: undefined,
  };
  const clip = {
    ...defaultCanvasBlock("video", 0, 0),
    id: "clip-e01-g01-probe",
    prompt,
  };
  const blocks = [
    selectedNode,
    otherNode,
    mixed,
    primaryOther,
    inputOther,
    pending,
    clip,
  ];
  const ids = resolveManhuaClipRelatedAssetNodeIds({
    clipPrompt: prompt,
    blocks,
    registry,
  });
  expect(ids.sort()).toEqual([selectedNode.id, pending.id].sort());
  const edges = syncManhuaClipAssetEdges([], clip.id, ids);
  expect(collectVisionImages(clip.id, blocks, edges).map(i => i.url)).toEqual([
    selected,
  ]);
  expect(collectUpstreamTexts(clip.id, blocks, edges)).not.toContain(
    otherNode.prompt
  );
});

it("无显式角色栏时，唯一说话人不能挤掉动作中明确的无对白角色", () => {
  const ready = prepare();
  const blocks = ready.blocks.map(b =>
    b.id.startsWith("reverse-")
      ? {
          ...b,
          outputText: b.outputText!.replace("沈青禾：「好。」", "无对白"),
        }
      : b
  );
  const result = ensureManhuaFragmentClips(blocks, ready.edges, 1, {
    assetCanon: canon,
    customRefs: refs,
    videoModel: "seedance-2.0-mini",
  });
  const clip = result.blocks.find(b => b.manhuaAutoSegment)!;
  expect(
    parseManhuaAssetImageBindBlock(clip.prompt)
      .filter(r => r.tag.startsWith("@角色"))
      .map(r => r.id)
      .sort()
  ).toEqual(["cust_mother", "cust_selected"]);
  expect(
    compileManhuaDialogueTtsPlan(clip.prompt).map(r => r.dialogueZh)
  ).toEqual(["慢点。"]);
});

it("共用推断显式角色优先，单字和同名不得从动作正文猜人", () => {
  const registry = makeRegistry();
  const shots = [{ actionZh: "沈青禾扶娘进门", dialogueZh: "娘：「慢点。」" }];
  expect(
    resolveManhuaSegmentCastZh({ shots, registry, assetCanon: canon })
  ).toBe("沈青禾；娘");
  expect(
    resolveManhuaSegmentCastZh({
      castZh: "娘",
      shots,
      registry,
      assetCanon: canon,
    })
  ).toBe("娘");
  expect(
    resolveManhuaSegmentCastZh({
      shots: [{ actionZh: "姑娘推门" }],
      registry,
      assetCanon: canon,
    })
  ).toBe("");
  const duplicate = {
    ...canon,
    characters: [
      ...canon.characters,
      { ...canon.characters[0]!, id: "wa_other" },
    ],
  };
  expect(
    resolveManhuaSegmentCastZh({
      shots: [{ actionZh: "沈青禾推门" }],
      registry,
      assetCanon: duplicate,
    })
  ).toBe("");
});

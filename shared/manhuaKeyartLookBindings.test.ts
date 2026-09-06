import { describe, expect, it } from "vitest";
import { buildManhuaAssetLockRegistry } from "./manhuaAssetLockRegistry";
import {
  appendManhuaKeyartLookContinuity,
  compileManhuaKeyartLookBindings,
} from "./manhuaKeyartLookBindings";
import {
  isManhuaKeyartLookCurrent,
  recordManhuaKeyartLookOutput,
  normalizeManhuaKeyartLookState,
} from "./manhuaKeyartLookState";
import {
  buildManhuaCloudDraftPayload,
  parseManhuaCloudDraftPayload,
} from "./manhuaCloudDraft";
import {
  normalizeCanvasBlock,
  defaultCanvasBlock,
} from "../client/src/lib/canvasTypes";
import { isManhuaKeyartPixelLocked } from "./manhuaAssetLockRegistry";

const registry = buildManhuaAssetLockRegistry({
  customRefs: [
    {
      id: "heiqi",
      role: "character",
      url: "https://test.invalid/identity.png",
      labelZh: "黑奇",
    },
  ],
  lookRefs: [
    {
      id: "before",
      role: "character",
      claimedAnchorIds: ["heiqi"],
      url: "https://test.invalid/before.png",
    },
    {
      id: "after",
      role: "character",
      claimedAnchorIds: ["heiqi"],
      url: "https://test.invalid/after.png",
    },
  ],
  characterLookSets: [
    {
      id: "look-before",
      characterId: "heiqi",
      index: 1,
      labelZh: "变身前",
      lookRefId: "before",
    },
    {
      id: "look-after",
      characterId: "heiqi",
      index: 2,
      labelZh: "变身后",
      lookRefId: "after",
    },
  ],
});
const block = {
  prompt: "【身份短锁】旧外形，禁止换装。\n【分镜3·静帧】黑奇抬头保护阿菁。",
  refImageUrl: "https://test.invalid/identity.png",
  outputUrl: "https://test.invalid/old-output.png",
  outputUrls: ["https://test.invalid/older-output.png"],
};
const options = {
  registry,
  allowedIds: ["heiqi"],
  activeLookSetIds: ["look-after"],
};

describe("静帧消费本段真实造型", () => {
  it("换造型保留旧图但不冒充已锁定，生成匹配后才解锁，本机云稿不丢状态", () => {
    const prepared = compileManhuaKeyartLookBindings(
      { ...defaultCanvasBlock("image", 0, 0), ...block, id: "keyart-e01-s01" },
      options
    );
    expect(isManhuaKeyartPixelLocked(prepared)).toBe(false);
    const generated = {
      ...prepared,
      outputUrl: "https://test.invalid/new.png",
      manhuaKeyartLookState: recordManhuaKeyartLookOutput(
        prepared,
        "https://test.invalid/new.png"
      ),
    };
    expect(isManhuaKeyartPixelLocked(generated)).toBe(true);
    const changed = compileManhuaKeyartLookBindings(generated, {
      ...options,
      activeLookSetIds: ["look-before"],
    });
    expect(isManhuaKeyartPixelLocked(changed)).toBe(false);
    const local = normalizeCanvasBlock(JSON.parse(JSON.stringify(changed)));
    const cloud = parseManhuaCloudDraftPayload(
      JSON.stringify(
        buildManhuaCloudDraftPayload({
          writerSession: {},
          blocks: [local],
          edges: [],
        })
      )
    )!;
    expect(cloud.canvas.blocks[0]!.manhuaKeyartLookState).toEqual(
      changed.manhuaKeyartLookState
    );
    expect(isManhuaKeyartLookCurrent(cloud.canvas.blocks[0]!)).toBe(false);
    expect(
      isManhuaKeyartLookCurrent({ ...generated, outputUrl: block.outputUrl })
    ).toBe(false);
    expect(
      isManhuaKeyartLookCurrent({
        outputUrl: block.outputUrl,
        manhuaKeyartLookState: normalizeManhuaKeyartLookState("bad"),
      })
    ).toBe(false);
  });
  it("所选图与编号一致，保留分镜和全部原产物，不复制旧造型短锁", () => {
    const result = compileManhuaKeyartLookBindings(block, options);
    expect(result.editFusionUrls).toEqual(["https://test.invalid/after.png"]);
    expect(result.prompt).toContain(
      "参考图2：变身后；本镜外观与形态，以此图为准"
    );
    expect(result.prompt).toContain("黑奇抬头保护阿菁");
    expect(result.prompt).not.toContain("禁止换装");
    expect(result.outputUrl).toBe(block.outputUrl);
    expect(result.outputUrls).toEqual(block.outputUrls);
    expect(block.prompt).not.toContain("本段造型参考");
  });
  it("重选、重复编译和清空造型都不残留上次的图或指令", () => {
    const before = compileManhuaKeyartLookBindings(block, {
      ...options,
      activeLookSetIds: ["look-before"],
    });
    const after = compileManhuaKeyartLookBindings(before, options);
    expect(after.editFusionUrls).toEqual(["https://test.invalid/after.png"]);
    expect(after.prompt).not.toContain("变身前");
    expect(compileManhuaKeyartLookBindings(after, options)).toEqual(after);
    const cleared = compileManhuaKeyartLookBindings(after, {
      ...options,
      activeLookSetIds: [],
    });
    expect(cleared.editFusionUrls).toEqual([]);
    expect(cleared.prompt).not.toContain("变身后");
  });
  it("未启用造型的旧稿完全惰性，不能改变图片、提示词或成本", () => {
    expect(
      compileManhuaKeyartLookBindings(block, {
        ...options,
        activeLookSetIds: [],
      })
    ).toBe(block);
    expect(
      appendManhuaKeyartLookContinuity(block, "https://test.invalid/prev.png")
    ).toBeNull();
  });
  it("镜间接力追加上镜图，不替换当前造型主图，不改变既有参考编号", () => {
    const prepared = compileManhuaKeyartLookBindings(block, options);
    const next = appendManhuaKeyartLookContinuity(
      prepared,
      "https://test.invalid/prev.png"
    )!;
    expect(next.refImageUrl).toBe(prepared.refImageUrl);
    expect(next.editFusionUrls).toEqual([
      "https://test.invalid/after.png",
      "https://test.invalid/prev.png",
    ]);
    expect(next.prompt).toContain("参考图2：变身后");
    expect(next.prompt).toContain("参考图3仅用于镜间构图接续");
    expect(
      appendManhuaKeyartLookContinuity(next, "https://test.invalid/prev.png")
    ).toBe(next);
  });
  it("身份白名单未包含所属角色时不能混入造型", () => {
    expect(() =>
      compileManhuaKeyartLookBindings(block, { ...options, allowedIds: [] })
    ).toThrow(/造型/);
  });
});

/**
 * 0915 审查实证的缺陷：本机地址迁移只更新了造型回执，漏掉原镜回执。
 *
 * 图片落成本机地址后 manhuaKeyartSourceState.generatedUrl 仍指着旧地址，
 * isManhuaWorkbenchKeyartCurrent 就判这张静帧「已变更」，
 * 段成片一直被门禁拦住——浏览器主项卡在这里。
 *
 * 这组测试钉住：**两份回执都要迁地址**，且**都不许改 generatedFor**
 * （改 generatedFor 等于把「历史兜底/失败也算出过图」放进来，是作弊不是修复）。
 */
import { describe, expect, it } from "vitest";
import {
  applyLocalMediaPointersToBlocks,
  makeLocalMediaPointer,
  rememberLocalMediaDisplay,
} from "./manhuaLocalMediaStore";
import { isManhuaWorkbenchKeyartCurrent } from "../components/ManhuaScriptWorkbench";
import type { CanvasBlock } from "./canvasTypes";

const REQUIRED = JSON.stringify({ index: 1, cameraZh: "全景", actionZh: "第 1 镜" });
/** 页面把回执图落成本机 blob: 显示地址；落盘时它会被换成 local-media 指针 */
const DISPLAY = "blob:http://localhost/keyart-e01";
const REMOTE = "https://example.com/keyart-e01.png";

function keyartBlock(over: Partial<CanvasBlock> = {}): CanvasBlock {
  return {
    id: "keyart-e01-x1",
    kind: "image",
    prompt: "第 1 镜",
    status: "done",
    outputUrl: DISPLAY,
    outputUrls: [DISPLAY],
    manhuaKeyartLookState: {
      required: REQUIRED,
      generatedFor: REQUIRED,
      generatedUrl: DISPLAY,
    },
    manhuaKeyartSourceState: {
      required: REQUIRED,
      generatedFor: REQUIRED,
      generatedUrl: DISPLAY,
    },
    ...over,
  } as CanvasBlock;
}

describe("本机地址迁移：造型与原镜两份回执都要跟着走", () => {
  it("迁移后两份回执的 generatedUrl 都指向新地址，且仍判为 current", () => {
    const block = keyartBlock();
    const pointer = makeLocalMediaPointer("rec-1");
    rememberLocalMediaDisplay({ displayUrl: DISPLAY, pointer, sourceUrl: REMOTE });

    const [migrated] = applyLocalMediaPointersToBlocks([block]);
    const look = migrated!.manhuaKeyartLookState as Record<string, unknown> | undefined;
    const source = migrated!.manhuaKeyartSourceState as Record<string, unknown> | undefined;

    expect(migrated!.outputUrl, "产物地址没有迁移，本用例前提不成立").not.toBe(DISPLAY);
    expect(look?.generatedUrl, "造型回执没跟着迁").toBe(migrated!.outputUrl);
    expect(source?.generatedUrl, "原镜回执没跟着迁——这就是那个缺陷").toBe(
      migrated!.outputUrl,
    );

    // 真正要保住的结果：静帧仍被判为「按当前口径出过图」
    expect(isManhuaWorkbenchKeyartCurrent(migrated as never)).toBe(true);
  });

  it("只迁地址，不许改 generatedFor（改它等于作弊）", () => {
    const block = keyartBlock();
    const pointer = makeLocalMediaPointer("rec-2");
    rememberLocalMediaDisplay({ displayUrl: DISPLAY, pointer, sourceUrl: REMOTE });

    const [migrated] = applyLocalMediaPointersToBlocks([block]);
    expect((migrated!.manhuaKeyartLookState as Record<string, unknown>).generatedFor).toBe(
      REQUIRED,
    );
    expect(
      (migrated!.manhuaKeyartSourceState as Record<string, unknown>).generatedFor,
    ).toBe(REQUIRED);
  });

  it("产物本来就不是那张已登记的图：两份回执都不得获得新地址", () => {
    // remap 的既有语义：历史兜底或失败不能凭地址迁移拿到生成回执。
    const OTHER = "blob:http://localhost/other";
    const block = keyartBlock({ outputUrl: OTHER, outputUrls: [OTHER] });
    const pointer = makeLocalMediaPointer("rec-3");
    rememberLocalMediaDisplay({ displayUrl: OTHER, pointer, sourceUrl: REMOTE });

    const [migrated] = applyLocalMediaPointersToBlocks([block]);
    expect((migrated!.manhuaKeyartLookState as Record<string, unknown>).generatedUrl).toBe(
      DISPLAY,
    );
    expect(
      (migrated!.manhuaKeyartSourceState as Record<string, unknown>).generatedUrl,
    ).toBe(DISPLAY);
  });
});

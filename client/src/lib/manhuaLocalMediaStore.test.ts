import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  __resetManhuaLocalMediaStoreForTests,
  applyLocalMediaPointersToBlocks,
  cacheCanvasMediaToLocalStore,
  getLocalMediaRecord,
  localMediaPointerId,
  tryLocalMediaDisplayForBlock,
  isLocalMediaPointer,
  makeLocalMediaPointer,
  makeLocalMediaRecordId,
  putLocalMediaRecord,
  rehydrateBlocksFromLocalMedia,
  rememberLocalMediaDisplay,
  resolveUrlForCloudSync,
  resolveUrlForLocalPersist,
} from "./manhuaLocalMediaStore";
import type { CanvasBlock } from "@/lib/canvasTypes";
import { isManhuaKeyartLookCurrent } from "@shared/manhuaKeyartLookState";
import { blocksForCloudDraftSync, cloudDraftBlocksToCanvas, slimBlocksForLocalPersist } from "./manhuaCloudDraftSync";
import { buildManhuaCloudDraftPayload } from "@shared/manhuaCloudDraft";

function baseBlock(over: Partial<CanvasBlock> & { id: string }): CanvasBlock {
  const { id, ...rest } = over;
  return {
    id,
    kind: "image",
    x: 0,
    y: 0,
    width: 160,
    height: 200,
    prompt: "t",
    textModel: "gpt-5.6-terra",
    imageModel: "gpt-image-2",
    videoModel: "seedance-2.0-fast",
    aspectRatio: "9:16",
    imageMode: "generate",
    imageBatchCount: 1,
    uploadedAssets: [],
    outputUrls: [],
    status: "done",
    ...rest,
  };
}

describe("manhuaLocalMediaStore", () => {
  beforeEach(async () => {
    await __resetManhuaLocalMediaStoreForTests();
  });

  it("recognizes local-media pointers", () => {
    const ptr = makeLocalMediaPointer(makeLocalMediaRecordId("keyart-e01-s01", "output"));
    expect(isLocalMediaPointer(ptr)).toBe(true);
    expect(isLocalMediaPointer("https://cdn.example/a.jpg")).toBe(false);
  });

  it("同节点重出不覆盖旧缓存，历史原地址不会映射到新图", async () => {
    const first = "https://test.invalid/cache-first.png";
    const second = "https://test.invalid/cache-second.png";
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(new Blob([url], { type: "image/png" }))));
    try {
      const block = baseBlock({ id: "keyart-e01-s01-version", outputUrl: first });
      await cacheCanvasMediaToLocalStore([block]);
      const firstPointer = resolveUrlForLocalPersist(first)!;
      await cacheCanvasMediaToLocalStore([{ ...block, outputUrl: second, outputUrls: [second, first] }]);
      const secondPointer = resolveUrlForLocalPersist(second)!;
      expect(firstPointer).not.toBe(secondPointer);
      expect(await (await getLocalMediaRecord(localMediaPointerId(firstPointer)))!.blob.text()).toBe(first);
      expect(await (await getLocalMediaRecord(localMediaPointerId(secondPointer)))!.blob.text()).toBe(second);
      expect(resolveUrlForCloudSync(resolveUrlForLocalPersist(first))).toBe(first);
      const fallback = await tryLocalMediaDisplayForBlock(block.id, "output", first);
      expect(resolveUrlForCloudSync(fallback)).toBe(first);
      expect(await tryLocalMediaDisplayForBlock(block.id, "output", "https://test.invalid/not-cached.png")).toBeNull();
      await __resetManhuaLocalMediaStoreForTests({ keepRecords: true });
      const refreshed = await rehydrateBlocksFromLocalMedia([{ ...block, outputUrls: [first, second] }]);
      expect(resolveUrlForCloudSync(refreshed[0].outputUrl)).toBe(first);
      expect(refreshed[0].outputUrls?.map(resolveUrlForCloudSync)).toEqual([first, second]);
      expect((await getLocalMediaRecord(localMediaPointerId(firstPointer)))!.sourceUrl).toBe(first);
    } finally { vi.unstubAllGlobals(); }
  });

  it("旧槽位来源不一致时拒绝错误图片，过期映射不能冒充本机命中", async () => {
    const id = makeLocalMediaRecordId("keyart-e01-legacy", "output");
    const source = "https://test.invalid/legacy-original.png";
    const other = "https://test.invalid/legacy-replaced.png";
    const oldPointer = await putLocalMediaRecord({ id, blockId: "keyart-e01-legacy", slot: "output", blob: new Blob(["old"]), mime: "image/png", sourceUrl: source, updatedAt: 1 });
    rememberLocalMediaDisplay({ displayUrl: "blob:legacy-original", pointer: oldPointer, sourceUrl: source });
    await putLocalMediaRecord({ id, blockId: "keyart-e01-legacy", slot: "output", blob: new Blob(["new"]), mime: "image/png", sourceUrl: other, updatedAt: 2 });
    expect(resolveUrlForLocalPersist(source)).toBe(source);
    expect(resolveUrlForLocalPersist("blob:legacy-original")).toBe(source);
    expect(await tryLocalMediaDisplayForBlock("keyart-e01-legacy", "output", source)).toBeNull();
    const restored = await rehydrateBlocksFromLocalMedia([baseBlock({ id: "keyart-e01-legacy", outputUrl: source })]);
    expect(restored[0].outputUrl).toBe(source);
  });

  it("超过16张的图片版本经本机、云清洗和恢复不截断，输入参考仍限16张", () => {
    const history = Array.from({ length: 25 }, (_, index) => `https://test.invalid/history-${index}.png`);
    const block = baseBlock({ id: "keyart-e01-s01-history", outputUrl: history[0], outputUrls: history, refImageUrl: history[0], editFusionUrls: history.slice(1) });
    const local = slimBlocksForLocalPersist([block]);
    expect(local[0].outputUrls).toEqual(history);
    const cloud = buildManhuaCloudDraftPayload({ writerSession: {}, blocks: blocksForCloudDraftSync(local), edges: [] });
    expect(cloud.canvas.blocks[0].outputUrls).toEqual(history);
    expect(cloudDraftBlocksToCanvas(cloud.canvas.blocks)[0].outputUrls).toEqual(history);
    expect(cloud.canvas.blocks[0].editFusionUrls).toHaveLength(15);
  });

  it("静帧回执贯穿原地址→本机指针→显示地址→云清洗→恢复，旧版本不获新回执", async () => {
    const source = "https://cdn.example/current-look.png";
    const block = baseBlock({ id: "keyart-e01-s01-look", imageMode: "edit", outputUrl: source,
      outputUrls: [source, "https://cdn.example/old-look.png"],
      manhuaKeyartLookState: { required: "selected-look", generatedFor: "selected-look", generatedUrl: source } });
    await putLocalMediaRecord({ id: makeLocalMediaRecordId(block.id, "output"), blockId: block.id, slot: "output", blob: new Blob(["test-image"]), mime: "image/png", sourceUrl: source, updatedAt: Date.now() });
    const local = slimBlocksForLocalPersist([block]);
    expect(isLocalMediaPointer(local[0].outputUrl)).toBe(true);
    expect(isManhuaKeyartLookCurrent(local[0])).toBe(true);
    const display = await rehydrateBlocksFromLocalMedia(local);
    expect(display[0].outputUrl).toMatch(/^blob:/);
    expect(isManhuaKeyartLookCurrent(display[0])).toBe(true);
    const cloud = buildManhuaCloudDraftPayload({ writerSession: {}, blocks: blocksForCloudDraftSync(display), edges: [] });
    const restored = cloudDraftBlocksToCanvas(cloud.canvas.blocks);
    expect(isLocalMediaPointer(restored[0].outputUrl)).toBe(true);
    expect(isManhuaKeyartLookCurrent(restored[0])).toBe(true);
    const old = { ...block, outputUrl: "https://cdn.example/old-look.png" };
    expect(isManhuaKeyartLookCurrent(slimBlocksForLocalPersist([old])[0])).toBe(false);
    const pending = { ...block, manhuaKeyartLookState: { ...block.manhuaKeyartLookState!, required: "another-look" } };
    expect(isManhuaKeyartLookCurrent(slimBlocksForLocalPersist([pending])[0])).toBe(false);
  });

  it("persists blob→pointer and cloud sync keeps source https", async () => {
    const source = "https://cdn.example/still.jpg";
    const recordId = makeLocalMediaRecordId("keyart-e01-s01", "output");
    const pointer = await putLocalMediaRecord({
      id: recordId,
      blockId: "keyart-e01-s01",
      slot: "output",
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }),
      mime: "image/jpeg",
      sourceUrl: source,
      updatedAt: Date.now(),
    });
    expect(isLocalMediaPointer(pointer)).toBe(true);

    const blobUrl = "blob:http://localhost/fake-1";
    rememberLocalMediaDisplay({ displayUrl: blobUrl, pointer, sourceUrl: source });

    expect(resolveUrlForLocalPersist(blobUrl)).toBe(pointer);
    expect(resolveUrlForCloudSync(blobUrl)).toBe(source);
    expect(resolveUrlForCloudSync(pointer)).toBe(source);
  });

  it("applyLocalMediaPointersToBlocks rewrites cached https to pointers", async () => {
    const source = "https://cdn.example/hero.jpg";
    const pointer = await putLocalMediaRecord({
      id: makeLocalMediaRecordId("charsheet-hero", "output"),
      blockId: "charsheet-hero",
      slot: "output",
      blob: new Blob([new Uint8Array([9])], { type: "image/png" }),
      mime: "image/png",
      sourceUrl: source,
      updatedAt: Date.now(),
    });
    const blocks = [
      baseBlock({ id: "charsheet-hero", outputUrl: source, outputUrls: [source] }),
    ];
    const pointed = applyLocalMediaPointersToBlocks(blocks);
    expect(pointed[0]?.outputUrl).toBe(pointer);
  });

  it("rehydrateBlocksFromLocalMedia turns pointers into blob URLs", async () => {
    const pointer = await putLocalMediaRecord({
      id: makeLocalMediaRecordId("keyart-e01-s02", "output"),
      blockId: "keyart-e01-s02",
      slot: "output",
      blob: new Blob([new Uint8Array([4, 5])], { type: "image/jpeg" }),
      mime: "image/jpeg",
      sourceUrl: "https://cdn.example/s02.jpg",
      updatedAt: Date.now(),
    });
    const blocks = [baseBlock({ id: "keyart-e01-s02", outputUrl: pointer, outputUrls: [pointer] })];
    const hydrated = await rehydrateBlocksFromLocalMedia(blocks);
    expect(hydrated[0]?.outputUrl).toMatch(/^blob:/);
    expect(resolveUrlForLocalPersist(hydrated[0]!.outputUrl)).toBe(pointer);
  });
});

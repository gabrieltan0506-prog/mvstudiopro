import { describe, expect, it, beforeEach } from "vitest";
import {
  __resetManhuaLocalMediaStoreForTests,
  applyLocalMediaPointersToBlocks,
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

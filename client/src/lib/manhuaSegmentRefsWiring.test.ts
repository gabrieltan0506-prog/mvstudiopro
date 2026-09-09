import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const omniSource = readFileSync(new URL("../pages/OmniCanvas.tsx", import.meta.url), "utf8");
const dockSource = readFileSync(new URL("../components/canvas/ManhuaClipDock.tsx", import.meta.url), "utf8");
const pipelineSource = readFileSync(new URL("./canvasDramaStudio.ts", import.meta.url), "utf8");
const runBlockSource = readFileSync(new URL("./canvasRunBlock.ts", import.meta.url), "utf8");
const cloudDraftSource = readFileSync(new URL("../../../shared/manhuaCloudDraft.ts", import.meta.url), "utf8");
const localPersistSource = readFileSync(new URL("./manhuaCloudDraftSync.ts", import.meta.url), "utf8");

describe("漫剧工厂段级参考接线", () => {
  it("成片坞三个入口都接到 OmniCanvas 的真实上传/登记回调", () => {
    expect(omniSource).toContain("onSegmentReferenceUpload={handleSegmentReferenceUpload}");
    expect(omniSource).toContain("onSegmentReferenceClear={handleSegmentReferenceClear}");
    expect(omniSource).toContain("segmentRefBusyId={segmentRefBusyId}");
    const handler = omniSource.split("const handleSegmentReferenceUpload = useCallback(")[1]!.split("const handleSegmentReferenceClear")[0]!;
    expect(handler).toContain("uploadOneCanvasAsset({");
    expect(handler).toContain("registerManhuaExistingClip(b, entry)");
    expect(handler).toContain("setManhuaSegmentReference(b, slot, entry)");
    expect(handler).toContain("manhuaSegmentReferenceKindError(slot, inferCanvasAssetKind(file))");
    expect(dockSource).toContain('onSegmentReferenceUpload(it.blockId, "registered", file)');
    expect(dockSource).toContain("onSegmentReferenceUpload(it.blockId, slot, file)");
    expect(dockSource).toContain("onSegmentReferenceClear(it.blockId, slot)");
  });
  it("新段克隆不借模板的段参考；已有段保留（existing 分支不重置）", () => {
    const clone = pipelineSource.split("const clone: CanvasBlock = {")[1]!.split("nextExtras.push(clone)")[0]!;
    expect(clone).toContain("manhuaSegmentRefs: undefined");
    const existing = pipelineSource.split("if (existing) {")[1]!.split("continue;")[0]!;
    expect(existing).not.toContain("manhuaSegmentRefs");
  });
  it("出片只在非编辑模式注入白模，母轨存在时不再并列逐句配音", () => {
    expect(runBlockSource).toContain("isClip && useSeedance25 && !isManhuaVideoEditBlock(block) && !runOptions?.pilotRun");
    expect(runBlockSource).toContain("studio: segmentMasterUrl ? undefined : block.audioStudio");
    expect(runBlockSource).toMatch(/existingAudioUrls: segmentMasterUrl\s*\?\s*\[segmentMasterUrl\]/);
  });
  it("云草稿白名单、回读白名单与本地落盘都保留段参考（新字段必须扫全部白名单）", () => {
    expect(cloudDraftSource).toContain("manhuaSegmentRefs: normalizeManhuaSegmentReferences(b.manhuaSegmentRefs)");
    const readBack = localPersistSource.split("function cloudDraftBlocksToCanvas")[1]!.split("\n}\n")[0]!;
    expect(readBack).toContain("manhuaSegmentRefs: normalizeManhuaSegmentReferences(raw.manhuaSegmentRefs)");
    // 本地落盘走 ...b 展开，只要没有显式抹掉即可
    const slim = localPersistSource.split("export function slimBlocksForLocalPersist(")[1]!.split("\n}\n")[0]!;
    expect(slim).not.toContain("manhuaSegmentRefs");
  });
});

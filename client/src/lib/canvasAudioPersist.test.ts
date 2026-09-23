import { describe, expect, it, vi } from "vitest";
import { defaultCanvasBlock, type CanvasBlock } from "./canvasTypes";
import { persistCanvasAudioBlock } from "./canvasAudioPersist";
import { emptyCanvasAudioStudio } from "../../../shared/canvasAudioStudio";

describe("声音与母轨同步保存", () => {
  it("同帧挂母轨后结算保留母轨，落盘状态可恢复", () => {
    const original = { ...defaultCanvasBlock("video", 0, 0), audioStudio: emptyCanvasAudioStudio() };
    original.audioStudio.pendingOperations.push({ id: "test-premix", kind: "post_prod", inputKey: "premix:test" });
    const ref: { current: CanvasBlock[] } = { current: [original] };
    let disk = "";
    const publish = vi.fn(); // 模拟 React 批处理：发布不立即触发新 render。
    const save = (blocks: typeof ref.current) => { disk = JSON.stringify(blocks); return true; };
    const master = { gcsUri: "gs://test/master.wav", url: "https://audio.test/master.wav", updatedAt: "2026-09-23" };
    expect(persistCanvasAudioBlock(ref, original.id, block => ({ ...block, manhuaSegmentRefs: { ...block.manhuaSegmentRefs, master } }), save, publish)).toBe(true);
    expect(persistCanvasAudioBlock(ref, original.id, block => ({ ...block, audioStudio: { ...block.audioStudio!, pendingOperations: [] } }), save, publish)).toBe(true);
    expect(ref.current[0].manhuaSegmentRefs?.master).toEqual(master);
    expect(JSON.parse(disk)[0].manhuaSegmentRefs.master).toEqual(master);
    expect(JSON.parse(disk)[0].audioStudio.pendingOperations).toEqual([]);
    expect(publish.mock.lastCall?.[0]).toEqual(ref.current);
  });

  it("保存失败保留权威状态且不发布", () => {
    const original = defaultCanvasBlock("video", 0, 0);
    const initial = [original];
    const ref = { current: initial };
    const publish = vi.fn();
    expect(persistCanvasAudioBlock(ref, original.id, block => ({ ...block, audioStudio: emptyCanvasAudioStudio() }), () => false, publish)).toBe(false);
    expect(ref.current).toBe(initial);
    expect(publish).not.toHaveBeenCalled();
  });
});

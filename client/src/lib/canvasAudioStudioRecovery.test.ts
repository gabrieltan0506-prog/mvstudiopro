import { describe, expect, it, vi } from "vitest";
import { canvasAudioPreviewKey, loadCanvasMusicHistory } from "./canvasAudioStudioRecovery";
import { canvasAudioStudioSchema, emptyCanvasAudioStudio } from "@shared/canvasAudioStudio";

describe("声音旧任务与合听恢复", () => {
  it("最近30单之外按本段保存ID取回所有原曲，失败不丢其他结果", async () => {
    const get = vi.fn(async (id: string) => { if (id === "temporary-error") throw Error("暂不可用"); return { jobId: id, variants: ["完整原曲"] }; });
    const result = await loadCanvasMusicHistory({ ids: ["old-1", "old-2", "recent-1", "temporary-error"],
      recent: async () => Array.from({ length: 30 }, (_, i) => ({ jobId: `recent-${i}`, variants: ["原曲"] })), get });
    expect(result.rows).toHaveLength(32);
    expect(result.rows.find(row => row.jobId === "old-1")?.variants).toEqual(["完整原曲"]);
    expect(get).toHaveBeenCalledTimes(3);
    expect(result.failed).toBe(true);
  });
  it("十二条长台词聚合签名固定71字，可持久化且改一个字即改变", async () => {
    const source = JSON.stringify(Array.from({ length: 12 }, (_, i) => [i, "台词".repeat(2000)]));
    const key = await canvasAudioPreviewKey(source);
    expect(source.length).toBeGreaterThan(16000);
    expect(key).toHaveLength(71);
    expect(key).not.toBe(await canvasAudioPreviewKey(source + "改"));
    expect(canvasAudioStudioSchema.parse({ ...emptyCanvasAudioStudio(), pendingOperations: [{ id: "preview", kind: "post_prod", inputKey: key }] }).pendingOperations[0]?.inputKey).toBe(key);
  });
});

import { describe, expect, it } from "vitest";
import { manhuaWorldCounts, manhuaWorldStageOf, type ManhuaWorldStudioScene } from "../components/canvas/ManhuaWorldStudio";

const scene = (spz500kUrl?: string): ManhuaWorldStudioScene => ({
  id: "scene-1",
  labelZh: "临水坊市",
  eligibility: {
    eligible: true,
    sourceVersion: "scene-v1",
    currentWorld3d: {
      status: "succeeded",
      taskId: "world-task-1",
      sourceVersion: "scene-v1",
      model: "marble-1.1",
      updatedAt: 1,
      assets: { spz500kGcsUri: "gs://example.test/world.spz", ...(spz500kUrl ? { spz500kUrl } : {}) },
    },
  },
});

describe("3D 世界任务与真实预览分层状态", () => {
  it("任务成功但没有 HTTPS 预览文件时不计入可载入世界", () => {
    const missing = scene();
    expect(manhuaWorldStageOf(missing)).toMatchObject({ stage: "review", labelZh: "世界任务完成 · 预览文件未就绪" });
    expect(manhuaWorldCounts([missing]).ready).toBe(0);
    const ready = scene("https://example.test/world.spz");
    expect(manhuaWorldStageOf(ready).stage).toBe("ready");
    expect(manhuaWorldCounts([ready]).ready).toBe(1);
  });

});

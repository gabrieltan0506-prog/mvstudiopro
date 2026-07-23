import { describe, expect, it } from "vitest";
import {
  countManhuaKeyartProgress,
  formatManhuaKeyartProgressZh,
} from "./manhuaKeyartProgress";

describe("manhuaKeyartProgress", () => {
  const epOf = (b: { episodeIndex?: number | null }) => b.episodeIndex;

  it("counts done/failed/running without pipeline index confusion", () => {
    const blocks = [
      { id: "story-e01-a", status: "done", outputUrl: undefined, episodeIndex: 1 },
      {
        id: "keyart-e01-s01",
        status: "done",
        outputUrl: "https://cdn.example/a.png",
        episodeIndex: 1,
      },
      { id: "keyart-e01-s02", status: "error", error: "fail", episodeIndex: 1 },
      { id: "keyart-e01-s03", status: "running", episodeIndex: 1 },
      { id: "keyart-e01-s04", status: "idle", episodeIndex: 1 },
    ];
    const c = countManhuaKeyartProgress(blocks, 1, epOf);
    expect(c).toEqual({ total: 4, done: 1, failed: 1, running: 1 });
    expect(formatManhuaKeyartProgressZh(c, 1)).toBe(
      "第1集 · 静帧已出 1/4 · 失败 1 · 生成中",
    );
  });

  it("does not report near-complete when zero images exist", () => {
    const blocks = Array.from({ length: 13 }, (_, i) => ({
      id: `keyart-e01-s${String(i + 1).padStart(2, "0")}`,
      status: i < 12 ? ("error" as const) : ("running" as const),
      error: i < 12 ? "改图失败" : undefined,
      episodeIndex: 1,
    }));
    const c = countManhuaKeyartProgress(blocks, 1, epOf);
    expect(c.done).toBe(0);
    expect(c.failed).toBe(12);
    expect(formatManhuaKeyartProgressZh(c, 1)).toMatch(/静帧已出 0\/13/);
    expect(formatManhuaKeyartProgressZh(c, 1)).not.toMatch(/16\/17|13\/1/);
  });

  it("uses expectedTotal so one node cannot fake 1/1 complete", () => {
    const blocks = [
      {
        id: "keyart-e01-x",
        status: "done",
        outputUrl: "https://cdn.example/a.png",
        episodeIndex: 1,
      },
    ];
    const c = countManhuaKeyartProgress(blocks, 1, epOf, 12);
    expect(c.total).toBe(12);
    expect(c.done).toBe(1);
    expect(formatManhuaKeyartProgressZh(c, 1)).toMatch(/静帧已出 1\/12/);
  });
});

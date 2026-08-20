import { describe, expect, it } from "vitest";
import {
  canvasVideoTaskNeedsSubmit,
  type CanvasVideoTaskRecord,
} from "./canvasVideoTask";

describe("canvasVideoTaskNeedsSubmit(六审第7条:HH 官方单不得重复提交)", () => {
  it("已有 bailianTaskId 时不得再次提交", () => {
    expect(
      canvasVideoTaskNeedsSubmit({
        engine: "happyhorse-openrouter",
        bailianTaskId: "bl_123",
        pollingUrl: undefined,
      } as CanvasVideoTaskRecord),
    ).toBe(false);
  });

  it("百炼和 OpenRouter 都无任务号时才允许提交;已有 pollingUrl 也不重提", () => {
    expect(
      canvasVideoTaskNeedsSubmit({ engine: "happyhorse-openrouter" } as CanvasVideoTaskRecord),
    ).toBe(true);
    expect(
      canvasVideoTaskNeedsSubmit({
        engine: "happyhorse-openrouter",
        pollingUrl: "https://or.example/poll",
      } as CanvasVideoTaskRecord),
    ).toBe(false);
  });

  it("其余引擎按各自任务号判定,行为与旧逻辑一致", () => {
    expect(
      canvasVideoTaskNeedsSubmit({
        engine: "wan30-wavespeed",
        wavespeedPredictionId: "wsp",
      } as CanvasVideoTaskRecord),
    ).toBe(false);
    expect(
      canvasVideoTaskNeedsSubmit({ engine: "wan30-wavespeed" } as CanvasVideoTaskRecord),
    ).toBe(true);
    expect(
      canvasVideoTaskNeedsSubmit({
        engine: "seedance25-evolink",
        evolinkTaskId: "ev",
      } as CanvasVideoTaskRecord),
    ).toBe(false);
    expect(
      canvasVideoTaskNeedsSubmit({
        engine: "seedance25-byteplus",
        byteplusTaskId: "bp",
      } as CanvasVideoTaskRecord),
    ).toBe(false);
    expect(
      canvasVideoTaskNeedsSubmit({
        engine: "seedance-openrouter",
        pollingUrl: "https://or.example/poll",
      } as CanvasVideoTaskRecord),
    ).toBe(false);
  });
});

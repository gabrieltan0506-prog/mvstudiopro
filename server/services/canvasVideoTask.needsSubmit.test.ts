import { describe, expect, it } from "vitest";
import {
  buildHailuoSubmitBodyFromTask,
  canvasVideoTaskNeedsSubmit,
  type CanvasVideoTaskRecord,
} from "./canvasVideoTask";

describe("buildHailuoSubmitBodyFromTask", () => {
  const baseTask = {
    prompt: "雨夜巷道缓慢推近",
    aspectRatio: "16:9",
    duration: 10,
    generateAudio: true,
  } satisfies Pick<
    CanvasVideoTaskRecord,
    "prompt" | "aspectRatio" | "duration" | "generateAudio"
  >;

  it.each([
    ["768p", "768p"],
    // H3 上游没有 1080p 档；旧任务或旁路传入时必须显式归到产品默认 2K。
    ["1080p", "2K"],
    ["2K", "2K"],
  ])("把任务画质 %s 送成上游请求体 %s", (taskResolution, expectedResolution) => {
    const body = buildHailuoSubmitBodyFromTask({
      ...baseTask,
      resolution: taskResolution,
    });

    expect(body).toMatchObject({
      model: "minimax/hailuo-3",
      prompt: "雨夜巷道缓慢推近",
      duration: 10,
      resolution: expectedResolution,
      aspect_ratio: "16:9",
      generate_audio: true,
    });
  });
});

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

  it("Wan 3.0 三通道引擎按各自句柄判定;auto 只要任一句柄在手就不再提交(防重复建单)", () => {
    expect(
      canvasVideoTaskNeedsSubmit({ engine: "wan30-evolink", evolinkTaskId: "ev" } as CanvasVideoTaskRecord),
    ).toBe(false);
    expect(
      canvasVideoTaskNeedsSubmit({ engine: "wan30-evolink" } as CanvasVideoTaskRecord),
    ).toBe(true);
    expect(
      canvasVideoTaskNeedsSubmit({
        engine: "wan30-openrouter",
        pollingUrl: "https://or.example/poll",
      } as CanvasVideoTaskRecord),
    ).toBe(false);
    expect(
      canvasVideoTaskNeedsSubmit({ engine: "wan30-openrouter" } as CanvasVideoTaskRecord),
    ).toBe(true);
    expect(
      canvasVideoTaskNeedsSubmit({ engine: "wan30-auto" } as CanvasVideoTaskRecord),
    ).toBe(true);
    for (const handle of [
      { wavespeedPredictionId: "wsp" },
      { evolinkTaskId: "ev" },
      { pollingUrl: "https://or.example/poll" },
    ]) {
      expect(
        canvasVideoTaskNeedsSubmit({ engine: "wan30-auto", ...handle } as CanvasVideoTaskRecord),
      ).toBe(false);
    }
  });

  it("HappyHorse 三通道引擎按各自句柄判定;auto 含百炼老句柄在内任一在手即不重提", () => {
    expect(
      canvasVideoTaskNeedsSubmit({ engine: "happyhorse-evolink" } as CanvasVideoTaskRecord),
    ).toBe(true);
    expect(
      canvasVideoTaskNeedsSubmit({ engine: "happyhorse-evolink", evolinkTaskId: "ev" } as CanvasVideoTaskRecord),
    ).toBe(false);
    expect(
      canvasVideoTaskNeedsSubmit({ engine: "happyhorse-wavespeed", wavespeedPredictionId: "wsp" } as CanvasVideoTaskRecord),
    ).toBe(false);
    expect(
      canvasVideoTaskNeedsSubmit({ engine: "happyhorse-auto" } as CanvasVideoTaskRecord),
    ).toBe(true);
    for (const handle of [
      { bailianTaskId: "bl" },
      { pollingUrl: "https://or.example/poll" },
      { evolinkTaskId: "ev" },
      { wavespeedPredictionId: "wsp" },
    ]) {
      expect(
        canvasVideoTaskNeedsSubmit({ engine: "happyhorse-auto", ...handle } as CanvasVideoTaskRecord),
      ).toBe(false);
    }
  });
});

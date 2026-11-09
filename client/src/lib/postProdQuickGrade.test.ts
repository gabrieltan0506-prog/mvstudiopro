import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { submitVideoGrade } from "./videoGradeSubmit";
import { POSTPROD_GRADE_EVENT, requestPostProdGrade } from "./postProdQuickGrade";

const SRC = "https://d2h7xmz5gqybh9.cloudfront.net/u1/final.mp4";
const GS = "gs://bucket/u1/imported-final.mp4";
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const measured = { width: 3840, height: 2160, fps: 30, durationSec: 12, durationExactSec: 12, sourceUrl: GS, sourceResolution: "4k" } as never;

describe("调色这条：提交参数（后期工坊 submit 包装作 queue）", () => {
  it("超分成片先导入，再按实测规格单段 concat + grade，不带 trims/转场", async () => {
    const queue = vi.fn(async (_input: unknown) => "job-1");
    const importSource = vi.fn(async () => GS);
    const probe = vi.fn(async () => measured);
    const jobId = await submitVideoGrade({ videoUrl: SRC, grade: { all: { lutId: "golden_hour_subtle" } } }, { queue, importSource, probe });
    expect(jobId).toBe("job-1");
    expect(importSource).toHaveBeenCalledWith(SRC);
    expect(probe).toHaveBeenCalledWith(GS);
    expect(queue).toHaveBeenCalledWith({ action: "concat", params: { clips: [GS], width: 3840, height: 2160, fps: 30, grade: { all: { lutId: "golden_hour_subtle" } } } });
  });

  it("分段调色原样进 grade.segments", async () => {
    const queue = vi.fn(async (_input: unknown) => ({ jobId: "job-2" }));
    const grade = { segments: [{ startSec: 0, endSec: 6, lutId: "basic_warm" }, { startSec: 6, endSec: 12, lutId: "neo_noir_standard" }] };
    await submitVideoGrade({ videoUrl: GS, grade }, { queue, probe: async () => measured });
    const params = (queue.mock.calls[0][0] as { params: { grade: { segments: unknown[] } } }).params;
    expect(params.grade.segments).toHaveLength(2);
  });

  it("未设置调色不入队", async () => {
    const queue = vi.fn(async (_input: unknown) => "x");
    await expect(submitVideoGrade({ videoUrl: GS, grade: undefined }, { queue, probe: async () => measured })).rejects.toThrow("未设置调色");
    expect(queue).not.toHaveBeenCalled();
  });
});

describe("调色跳转", () => {
  it("派发预选事件并滚到超分页签锚点", () => {
    const dispatchEvent = vi.fn((_event: Event) => true);
    const scrollIntoView = vi.fn();
    const getElementById = vi.fn((id: string) => (id === "manhua-post-enhance" ? { scrollIntoView } : null));
    requestPostProdGrade({ url: SRC, label: "整集成片" }, { dispatchEvent, document: { getElementById } as unknown as Document });
    const event = dispatchEvent.mock.calls[0][0] as unknown as CustomEvent;
    expect(event.type).toBe(POSTPROD_GRADE_EVENT);
    expect(event.detail).toEqual({ url: SRC, label: "整集成片" });
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it("后期工坊监听事件预选成片；剪辑台与数字人页挂上入口", () => {
    const card = read("../components/canvas/PostProdWorkshopCard.tsx");
    expect(card).toContain("window.addEventListener(POSTPROD_GRADE_EVENT");
    expect(card).toMatch(/setActiveTool\("enhance"\);\s*setUpscaleVideoUrl\(detail\.url\);\s*setQuickGradeOpen\(true\)/);
    expect(card).toContain("submitVideoGrade({ videoUrl: upscaleVideoUrl, grade: quickGrade }, { queue: input => submit(input, `调色 · ${label}`, true) })");
    expect(card).toContain("<VideoGradePanel");
    expect(card).toContain(">调色这条</button>");
    expect(read("../components/ManhuaEditMultitrackPanel.tsx")).toContain("requestPostProdGrade({ url: finalVideoVersions.activeUrl!");
    const dh = read("../components/DigitalHumanStudio.tsx");
    expect(dh).toContain("requestPostProdGrade({");
    expect(dh).toContain("去后期调色");
  });
});

import { describe, expect, it, vi } from "vitest";
import { concatParamsSchema } from "../../../server/jobs/postProdInput";
import { buildVideoGradeConcatParams, submitVideoGrade, type VideoGradeConcatInput } from "./videoGradeSubmit";

const measured = { sourceUrl: "x", width: 1280, height: 720, fps: 24, durationSec: 9, durationExactSec: 8.5, sourceResolution: "720p" };

function deps() {
  const queued: VideoGradeConcatInput[] = [];
  return {
    queued,
    probe: vi.fn(async (_url: string) => measured),
    importSource: vi.fn(async (_url: string) => "gs://test-only/imported.mp4"),
    queue: vi.fn(async (input: VideoGradeConcatInput) => {
      queued.push(input);
      return { jobId: "job-test" };
    }),
  };
}

describe("单片调色提交（复用后期 concat）", () => {
  it("单片、无 trims、无转场；宽高帧率按实测；grade 原样透传；通过服务端 concat 契约", async () => {
    const d = deps();
    const grade = { all: { lutId: "basic_warm", saturation: 0.8 } };
    const jobId = await submitVideoGrade({ videoUrl: "gs://test-only/a.mp4", grade, scopeKey: "scope-1" }, d);
    expect(jobId).toBe("job-test");
    expect(d.importSource).not.toHaveBeenCalled();
    expect(d.probe).toHaveBeenCalledWith("gs://test-only/a.mp4");
    expect(d.queued).toEqual([
      { action: "concat", params: { clips: ["gs://test-only/a.mp4"], width: 1280, height: 720, fps: 24, grade }, scopeKey: "scope-1" },
    ]);
    const params = d.queued[0].params as Record<string, unknown>;
    expect(params).not.toHaveProperty("trims");
    expect(params).not.toHaveProperty("transition");
    expect(params).not.toHaveProperty("subtitleSrt");
    expect(concatParamsSchema.safeParse(params).success).toBe(true);
  });

  it("CloudFront 成品先导入为本人 gs://，再实测、入队（原片地址不被覆盖）", async () => {
    const d = deps();
    const src = "https://d2h7xmz5gqybh9.cloudfront.net/out/a.mp4";
    await submitVideoGrade({ videoUrl: src, grade: { all: { contrast: 1.2 } } }, d);
    expect(d.importSource).toHaveBeenCalledWith(src);
    expect(d.probe).toHaveBeenCalledWith("gs://test-only/imported.mp4");
    expect(d.queued[0].params.clips).toEqual(["gs://test-only/imported.mp4"]);
    expect(d.queued[0]).not.toHaveProperty("scopeKey");
  });

  it("分段调色按原片实测时长校验，渐变/接点修正随 grade 下发", async () => {
    const d = deps();
    const grade = { segments: [{ startSec: 0, endSec: 4, lutId: "basic_cool" }, { startSec: 4, endSec: 8.5 }], crossfadeSec: 0.5, autoMatchJunctions: true };
    await submitVideoGrade({ videoUrl: "gs://test-only/a.mp4", grade }, d);
    expect(d.queued[0].params.grade).toEqual(grade);
    const bad = deps();
    await expect(submitVideoGrade({ videoUrl: "gs://test-only/a.mp4", grade: { segments: [{ startSec: 0, endSec: 4, lutId: "basic_cool" }, { startSec: 4, endSec: 6 }] } }, bad)).rejects.toThrow("末段须到成片结尾8.5秒");
    expect(bad.queue).not.toHaveBeenCalled();
  });

  it.each([
    ["不传 grade", undefined],
    ["全中性", { all: { saturation: 1, contrast: 1, color_temperature: 6500 } }],
  ])("%s → 不实测、不入队", async (_, grade) => {
    const d = deps();
    await expect(submitVideoGrade({ videoUrl: "gs://test-only/a.mp4", grade }, d)).rejects.toThrow("未设置调色");
    expect(d.queue).not.toHaveBeenCalled();
    if (!grade) expect(d.probe).not.toHaveBeenCalled();
  });

  it("纯函数：奇数尺寸取偶、帧率取整；帧率缺失或超出范围拒绝；单片不带代表镜头", () => {
    expect(buildVideoGradeConcatParams("gs://test-only/a.mp4", { ...measured, width: 853, height: 479, fps: 29.97 }, { all: { saturation: 0.5 } })).toEqual({
      clips: ["gs://test-only/a.mp4"], width: 854, height: 480, fps: 30, grade: { all: { saturation: 0.5 } },
    });
    expect(() => buildVideoGradeConcatParams("gs://test-only/a.mp4", { ...measured, fps: null }, { all: { saturation: 0.5 } })).toThrow("帧率");
    expect(buildVideoGradeConcatParams("gs://test-only/a.mp4", measured, { all: { saturation: 0.5 }, referenceClipIndex: 0 })?.grade).toEqual({ all: { saturation: 0.5 } });
    expect(buildVideoGradeConcatParams("gs://test-only/a.mp4", measured, undefined)).toBeNull();
  });
});

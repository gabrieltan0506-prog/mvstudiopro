import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildManhuaClipQualityPrompt,
  isManhuaClipQualityInfraFailure,
  manhuaClipQualityAllowsAssemble,
  MANHUA_CLIP_QUALITY_KEYS,
  parseManhuaClipQualityMarkdown,
  resolveManhuaClipQualityEffectiveStatus,
} from "./manhuaClipQuality";
import { reviewManhuaClipQuality } from "../client/src/lib/manhuaClipQuality";

describe("manhuaClipQuality", () => {
  it("allows assemble only when passed or user accepted soft fail", () => {
    expect(
      manhuaClipQualityAllowsAssemble({
        outputUrl: "https://x/a.mp4",
        quality: { status: "failed", userAcceptedDespiteQc: false },
      }),
    ).toBe(false);
    expect(
      manhuaClipQualityAllowsAssemble({
        outputUrl: "https://x/a.mp4",
        quality: { status: "failed", userAcceptedDespiteQc: true },
      }),
    ).toBe(true);
    expect(
      manhuaClipQualityAllowsAssemble({
        outputUrl: "https://x/a.mp4",
        quality: { status: "passed" },
      }),
    ).toBe(true);
  });

  it("passes only when every quality gate is YES", () => {
    const raw = [
      ...MANHUA_CLIP_QUALITY_KEYS.map((key) => `${key}=YES`),
      "SUMMARY=全部通过",
    ].join("\n");
    const report = parseManhuaClipQualityMarkdown(raw);
    expect(report.status).toBe("passed");
    expect(report.failedKeys).toEqual([]);
  });

  it("rejects an unrelated but otherwise valid video", () => {
    const raw = [
      "CHARACTER_MATCH=NO",
      "SCENE_MATCH=YES",
      "PLOT_MATCH=NO",
      "CAMERA_MOTION=YES",
      "LIGHTING=YES",
      "DURATION_OK=YES",
      "NO_UNRELATED_CONTENT=NO",
      "SUMMARY=人物和剧情与首镜无关",
    ].join("\n");
    const report = parseManhuaClipQualityMarkdown(raw);
    expect(report.status).toBe("failed");
    expect(report.failedKeys).toContain("CHARACTER_MATCH");
    expect(report.failedKeys).toContain("NO_UNRELATED_CONTENT");
    expect(report.summary).toContain("人物和剧情");
  });

  it("accepts legacy DURATION_10S as DURATION_OK", () => {
    const raw = [
      "CHARACTER_MATCH=YES",
      "SCENE_MATCH=YES",
      "PLOT_MATCH=YES",
      "CAMERA_MOTION=YES",
      "LIGHTING=YES",
      "DURATION_10S=YES",
      "NO_UNRELATED_CONTENT=YES",
      "SUMMARY=全部通过",
    ].join("\n");
    const report = parseManhuaClipQualityMarkdown(raw);
    expect(report.checks.DURATION_OK).toBe(true);
    expect(report.status).toBe("passed");
  });

  it("builds a fragment-scoped prompt with duration", () => {
    const prompt = buildManhuaClipQualityPrompt({
      expectedContext: "女主在盟誓堂递出密令",
      expectedDurationSec: 2.5,
      shotIndex: 1,
    });
    expect(prompt).toContain("女主在盟誓堂递出密令");
    expect(prompt).toContain("约 2.5 秒");
    expect(prompt).toContain("DURATION_OK");
    expect(prompt).toContain("只评判本镜");
    expect(prompt).not.toContain("DURATION_10S=YES或NO");
  });

  it("detects quality infra failure separately from content fail", () => {
    expect(
      isManhuaClipQualityInfraFailure({
        summary: "智能质检暂不可用（非成片内容判定），成片已保留但暂不进成片坞",
        raw: "Failed to fetch",
        failedKeys: [...MANHUA_CLIP_QUALITY_KEYS],
      }),
    ).toBe(true);
    expect(
      isManhuaClipQualityInfraFailure({
        summary: "人物与首镜不符",
        raw: "CHARACTER_MATCH=NO\nSUMMARY=人物与首镜不符",
        failedKeys: ["CHARACTER_MATCH"],
      }),
    ).toBe(false);
  });

  // 「检不了」与「检了没过」必须分流：unverified 默认不放行，手动放行后才进坞
  it("unverified is blocked by default but allowed after manual waiver", () => {
    // 质检不可用且未放行：不进成片坞（默认不放行，但不再伪装 failed）
    expect(
      manhuaClipQualityAllowsAssemble({
        outputUrl: "https://x/a.mp4",
        quality: { status: "unverified", userAcceptedDespiteQc: false },
      }),
    ).toBe(false);
    // 用户显式「未质检放行」（持久化为 unverified + 放行标记）：放行
    expect(
      manhuaClipQualityAllowsAssemble({
        outputUrl: "https://x/a.mp4",
        quality: { status: "unverified", userAcceptedDespiteQc: true },
      }),
    ).toBe(true);
    // 等效状态 unverified_waived 直接给进来也放行
    expect(
      manhuaClipQualityAllowsAssemble({
        outputUrl: "https://x/a.mp4",
        quality: { status: "unverified_waived" },
      }),
    ).toBe(true);
    // 垫图兜底不因 unverified_waived 松动：没有真实出片一律不放行
    expect(
      manhuaClipQualityAllowsAssemble({
        outputUrl: "",
        quality: { status: "unverified_waived" },
      }),
    ).toBe(false);
  });

  it("derives unverified_waived from unverified + waiver flag", () => {
    expect(
      resolveManhuaClipQualityEffectiveStatus({ status: "unverified", userAcceptedDespiteQc: true }),
    ).toBe("unverified_waived");
    expect(
      resolveManhuaClipQualityEffectiveStatus({ status: "unverified", userAcceptedDespiteQc: false }),
    ).toBe("unverified");
    // 真 failed 的「仍采用」不改状态：failed 语义完全不变
    expect(
      resolveManhuaClipQualityEffectiveStatus({ status: "failed", userAcceptedDespiteQc: true }),
    ).toBe("failed");
    expect(resolveManhuaClipQualityEffectiveStatus(null)).toBeUndefined();
  });

  describe("reviewManhuaClipQuality infra failures map to unverified, not failed", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    const input = {
      videoUrl: "https://x/a.mp4",
      referenceImageUrl: "https://x/ref.jpg",
      expectedContext: "女主递出密令",
      attempts: 2,
    };

    it("network exception -> unverified with empty failedKeys and retry hint", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
      );
      const report = await reviewManhuaClipQuality(input);
      // 接口抖动不再伪装 failed + 全量 failedKeys（fail-closed 误杀的根因）
      expect(report.status).toBe("unverified");
      expect(report.failedKeys).toEqual([]);
      expect(report.summary).toContain("暂不可用");
      expect(report.attempts).toBe(2);
      // 链路故障识别口径不变
      expect(isManhuaClipQualityInfraFailure(report)).toBe(true);
      // 默认仍不放行，需要手动放行
      expect(
        manhuaClipQualityAllowsAssemble({ outputUrl: input.videoUrl, quality: report }),
      ).toBe(false);
      expect(
        manhuaClipQualityAllowsAssemble({
          outputUrl: input.videoUrl,
          quality: { ...report, userAcceptedDespiteQc: true },
        }),
      ).toBe(true);
    });

    it("HTTP 5xx -> unverified", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: 503,
          json: async () => ({ ok: false, error: "upstream timeout" }),
        }),
      );
      const report = await reviewManhuaClipQuality(input);
      expect(report.status).toBe("unverified");
      expect(report.failedKeys).toEqual([]);
    });

    it("a real failed verdict from the API stays failed untouched", async () => {
      // 接口正常返回「检了没过」：行为完全不变，仍是 failed + 具体 failedKeys
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            report: {
              status: "failed",
              checks: Object.fromEntries(
                MANHUA_CLIP_QUALITY_KEYS.map((k) => [k, k !== "CHARACTER_MATCH"]),
              ),
              failedKeys: ["CHARACTER_MATCH"],
              summary: "人物与首镜不符",
              raw: "CHARACTER_MATCH=NO",
            },
          }),
        }),
      );
      const report = await reviewManhuaClipQuality(input);
      expect(report.status).toBe("failed");
      expect(report.failedKeys).toEqual(["CHARACTER_MATCH"]);
      expect(isManhuaClipQualityInfraFailure(report)).toBe(false);
      expect(
        manhuaClipQualityAllowsAssemble({ outputUrl: input.videoUrl, quality: report }),
      ).toBe(false);
    });
  });

});

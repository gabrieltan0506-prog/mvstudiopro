import { describe, expect, it } from "vitest";
import {
  parseDualWindowProbeArgs,
  validateDualWindowProbeResult,
} from "../../scripts/weixin-channels-dual-window-probe.mts";

describe("视频号双窗正式链路探针", () => {
  it("必须显式授权两个唯一窗口", () => {
    expect(parseDualWindowProbeArgs([
      "--execute-dual-window-probe",
      "--window-id=58442",
      "--window-id=58429",
    ])).toMatchObject({ windowIds: [58442, 58429], target: 10, timeoutMs: 900_000 });
    expect(() => parseDualWindowProbeArgs([
      "--window-id=58442",
      "--window-id=58429",
    ])).toThrow("dual_window_probe_explicit_execute_flag_required");
  });

  it("只接受左右窗各自完成、80+评论带样本、真实新入库且零模型调用", () => {
    const base = {
      runKind: "formal" as const,
      qualified: true,
      serverQualified: true,
      persisted: true,
      newlyPersisted: true,
      newlyQualifiedPersisted: true,
      comments: 80,
      commentSampleCount: 8,
      captureElapsedMs: 25_000,
      modelCalls: 0,
      analysisObservation: {
        likes: 3_000,
        shares: 2_000,
        favorites: 100,
        comments: 80,
      } as never,
    };
    const events = [
      { event: "observation_persisted" as const, observationId: "left", windowId: 58429, query: "推荐页", ...base },
      { event: "observation_persisted" as const, observationId: "right", windowId: 58442, query: "AI创业", ...base },
    ];
    expect(validateDualWindowProbeResult({
      events,
      summary: {
        event: "collector_session_summary",
        stopped: "qualified_target_reached",
        qualifiedPersistedTotal: 2,
        qualificationElapsedMs: 20_000,
        modelCalls: 0,
        windowRoles: { leftRecommendationWindowId: 58429, rightSearchWindowId: 58442 },
      },
      windowIds: [58442, 58429],
      target: 2,
      persistedIds: new Set(["left", "right"]),
    })).toMatchObject({ ok: true, leftRecommendationPersisted: 1, rightWindowPersisted: 1 });

    expect(() => validateDualWindowProbeResult({
      events: [{
        ...events[0]!,
        analysisObservation: { likes: 822, shares: 32, favorites: 321, comments: 152 } as never,
      }, events[1]!],
      summary: {
        event: "collector_session_summary",
        stopped: "qualified_target_reached",
        qualifiedPersistedTotal: 2,
        qualificationElapsedMs: 20_000,
        modelCalls: 0,
        windowRoles: { leftRecommendationWindowId: 58429, rightSearchWindowId: 58442 },
      },
      windowIds: [58442, 58429],
      target: 2,
      persistedIds: new Set(["left", "right"]),
    })).toThrow("dual_window_probe_invalid_observation:left");

    expect(() => validateDualWindowProbeResult({
      events: [{ ...events[0]!, serverQualified: false }, events[1]!],
      summary: {
        event: "collector_session_summary",
        stopped: "qualified_target_reached",
        qualifiedPersistedTotal: 2,
        qualificationElapsedMs: 20_000,
        modelCalls: 0,
        windowRoles: { leftRecommendationWindowId: 58429, rightSearchWindowId: 58442 },
      },
      windowIds: [58442, 58429],
      target: 2,
      persistedIds: new Set(["left", "right"]),
    })).toThrow("dual_window_probe_invalid_observation:left");

    expect(validateDualWindowProbeResult({
      events: [{
        ...events[0]!,
        comments: 12,
        commentSampleCount: 0,
        analysisObservation: { likes: 3_000, shares: 2_000, favorites: 100, comments: 12 } as never,
      }, events[1]!],
      summary: {
        event: "collector_session_summary",
        stopped: "qualified_target_reached",
        qualifiedPersistedTotal: 2,
        qualificationElapsedMs: 20_000,
        modelCalls: 0,
        windowRoles: { leftRecommendationWindowId: 58429, rightSearchWindowId: 58442 },
      },
      windowIds: [58442, 58429],
      target: 2,
      persistedIds: new Set(["left", "right"]),
    })).toMatchObject({ ok: true });
  });
});

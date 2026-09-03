import { describe, expect, it } from "vitest";
import {
  MANHUA_PILOT_DURATION_SEC,
  compileManhuaPilotPrompt,
  createManhuaPilotGateEntry,
  evaluateManhuaPilotGate,
  getManhuaPilotGateEntry,
  manhuaPilotGateKey,
  normalizeManhuaPilotGateStore,
  recordManhuaPilotGenerated,
  reviewManhuaPilot,
} from "./manhuaPilotGate";

describe("manhuaPilotGate", () => {
  it("stores one independent 10s gate per episode and video model", () => {
    let store = recordManhuaPilotGenerated({}, {
      episodeIndex: 1,
      videoModel: "seedance-2.5",
      outputUrl: "https://cdn.example/e01-seedance25.mp4",
    });
    store = reviewManhuaPilot(store, {
      episodeIndex: 1,
      videoModel: "seedance-2.5",
      decision: "approve",
    });
    store = recordManhuaPilotGenerated(store, {
      episodeIndex: 1,
      videoModel: "wan-3.0",
      outputUrl: "https://cdn.example/e01-wan.mp4",
    });
    store = recordManhuaPilotGenerated(store, {
      episodeIndex: 2,
      videoModel: "seedance-2.5",
      outputUrl: "https://cdn.example/e02-seedance25.mp4",
    });

    expect(Object.keys(store)).toEqual([
      "episode:1|video:seedance-2.5",
      "episode:1|video:wan-3.0",
      "episode:2|video:seedance-2.5",
    ]);
    expect(getManhuaPilotGateEntry(store, 1, "seedance-2.5")?.status).toBe("approved");
    expect(getManhuaPilotGateEntry(store, 1, "wan-3.0")?.status).toBe("generated");
    expect(getManhuaPilotGateEntry(store, 2, "seedance-2.5")?.status).toBe("generated");
    expect(getManhuaPilotGateEntry(store, 2, "wan-3.0")).toBeNull();
  });

  it("fails closed when restoring invalid, non-10s, or key-spoofed draft data", () => {
    const good = createManhuaPilotGateEntry({ episodeIndex: 3, videoModel: "wan-3.0" })!;
    const normalized = normalizeManhuaPilotGateStore({
      "spoofed-key": good,
      wrongDuration: { ...good, durationSec: 15 },
      approvedWithoutOutput: { ...good, status: "approved" },
      unknownVersion: { ...good, version: 2 },
    });
    expect(normalized).toEqual({
      "episode:3|video:wan-3.0": good,
    });
    expect(manhuaPilotGateKey(0, "wan-3.0")).toBeNull();
    expect(manhuaPilotGateKey(1, "bad\nmodel")).toBeNull();
  });

  it("only allows segment 1 at exactly 10s before approval", () => {
    const base = {
      store: {},
      episodeIndex: 1,
      videoModel: "minimax-hailuo-3",
    };
    expect(
      evaluateManhuaPilotGate({
        ...base,
        segmentIndex: 1,
        requestedDurationSec: MANHUA_PILOT_DURATION_SEC,
      }),
    ).toMatchObject({ allowed: true, mode: "pilot", reason: "pilot_required" });
    expect(
      evaluateManhuaPilotGate({ ...base, segmentIndex: 2, requestedDurationSec: 10 }),
    ).toMatchObject({ allowed: false, reason: "first_segment_only" });
    expect(
      evaluateManhuaPilotGate({ ...base, segmentIndex: 1, requestedDurationSec: 15 }),
    ).toMatchObject({ allowed: false, reason: "pilot_duration_must_be_10" });
  });

  it("blocks duplicate submissions while a generated pilot awaits review", () => {
    const store = recordManhuaPilotGenerated({}, {
      episodeIndex: 1,
      videoModel: "seedance-2.0",
      outputUrl: "https://cdn.example/pilot.mp4",
    });
    expect(
      evaluateManhuaPilotGate({
        store,
        episodeIndex: 1,
        videoModel: "seedance-2.0",
        segmentIndex: 1,
        requestedDurationSec: 10,
      }),
    ).toMatchObject({ allowed: false, status: "generated", reason: "awaiting_review" });
  });

  it("approval unlocks only the reviewed episode-model pair", () => {
    const generated = recordManhuaPilotGenerated({}, {
      episodeIndex: 4,
      videoModel: "wan-3.0",
      outputUrl: "https://cdn.example/pilot.mp4",
    });
    const approved = reviewManhuaPilot(generated, {
      episodeIndex: 4,
      videoModel: "wan-3.0",
      decision: "approve",
    });
    expect(
      evaluateManhuaPilotGate({
        store: approved,
        episodeIndex: 4,
        videoModel: "wan-3.0",
        segmentIndex: 3,
        requestedDurationSec: 30,
      }),
    ).toMatchObject({ allowed: true, mode: "full", effectiveDurationSec: 30 });
    expect(
      evaluateManhuaPilotGate({
        store: approved,
        episodeIndex: 4,
        videoModel: "seedance-2.5",
        segmentIndex: 3,
        requestedDurationSec: 30,
      }),
    ).toMatchObject({ allowed: false, reason: "first_segment_only" });
  });

  it("cannot approve a missing pilot and allows a rejected pilot to be regenerated", () => {
    expect(
      reviewManhuaPilot({}, {
        episodeIndex: 1,
        videoModel: "wan-3.0",
        decision: "approve",
      }),
    ).toEqual({});
    const generated = recordManhuaPilotGenerated({}, {
      episodeIndex: 1,
      videoModel: "wan-3.0",
      outputUrl: "https://cdn.example/rejected.mp4",
    });
    const rejected = reviewManhuaPilot(generated, {
      episodeIndex: 1,
      videoModel: "wan-3.0",
      decision: "reject",
      rejectionNoteZh: "动作落点漂移",
    });
    expect(getManhuaPilotGateEntry(rejected, 1, "wan-3.0")).toMatchObject({
      status: "rejected",
      rejectionNoteZh: "动作落点漂移",
    });
    expect(
      evaluateManhuaPilotGate({
        store: rejected,
        episodeIndex: 1,
        videoModel: "wan-3.0",
        segmentIndex: 1,
        requestedDurationSec: 10,
      }),
    ).toMatchObject({ allowed: true, mode: "pilot" });
  });
});

describe("compileManhuaPilotPrompt", () => {
  it("keeps identity, references, strategy and spatial scheduling while cropping to 10s", () => {
    const source = [
      "【第1段·30s】雨夜仓库",
      "【身份短锁】@角色1 的脸、发型、服装保持一致。",
      "【资产·Image对照】",
      "@角色1|id=hero|label=沈策|kind=角色",
      "【导演策略】动作必须交出起点、接触与结果。",
      "【空间调度】人物自左向右；摄影机跟移；关键落点=接触。",
      "目标时长：约 30 秒",
      "0–6s：〔建置〕全景固定；沈策进入仓库。",
      "6–12s：〔冲突升级〕中景推近；沈策抓住箱盖。",
      "12–20s：〔转折〕特写；箱内信物显露。",
      "20–30s：〔结果〕远景；追兵封住出口。",
    ].join("\n");
    const result = compileManhuaPilotPrompt(source);

    expect(result.prompt).toContain("【第1段·10s】雨夜仓库");
    expect(result.prompt).toContain("【身份短锁】@角色1 的脸、发型、服装保持一致。");
    expect(result.prompt).toContain("@角色1|id=hero|label=沈策|kind=角色");
    expect(result.prompt).toContain("【导演策略】动作必须交出起点、接触与结果。");
    expect(result.prompt).toContain("【空间调度】人物自左向右；摄影机跟移；关键落点=接触。");
    expect(result.prompt).toContain("目标时长：约 10 秒");
    expect(result.prompt).toContain("0–6s：〔建置〕全景固定；沈策进入仓库。");
    expect(result.prompt).toContain("6–10s：〔冲突升级〕中景推近；沈策抓住箱盖。");
    expect(result.prompt).not.toMatch(/12–20s|20–30s|信物显露|追兵封住/);
    expect(result).toMatchObject({
      durationSec: 10,
      hadTimeline: true,
      keptTimelineCount: 2,
      removedTimelineCount: 2,
      clampedTimelineCount: 1,
    });
  });

  it("crops multiple timeline beats on one line without inventing text", () => {
    const source =
      "【第1段·15s】桥面\n0–5s：中景，两人对峙。5–10s：特写，指节收紧。10–15s：全景，摔门而出。";
    const result = compileManhuaPilotPrompt(source);
    expect(result.prompt).toBe(
      "【第1段·10s】桥面\n0–5s：中景，两人对峙。5–10s：特写，指节收紧。",
    );
    expect(result).toMatchObject({
      keptTimelineCount: 2,
      removedTimelineCount: 1,
      clampedTimelineCount: 0,
    });
  });

  it("supports Chinese-second and timestamp-table formats and is idempotent", () => {
    const source = [
      "【第1段·15s】巷口",
      "0-8秒: 人物从门内走出。",
      "8-14 | 摄影机横移跟随。",
      "14-15秒：停在路口。",
      "【参考职责】这行不是秒轴，完整保留。",
    ].join("\n");
    const once = compileManhuaPilotPrompt(source);
    const twice = compileManhuaPilotPrompt(once.prompt);
    expect(once.prompt).toContain("0-8秒: 人物从门内走出。");
    expect(once.prompt).toContain("8-10 | 摄影机横移跟随。");
    expect(once.prompt).not.toContain("停在路口");
    expect(once.prompt).toContain("【参考职责】这行不是秒轴，完整保留。");
    expect(twice.prompt).toBe(once.prompt);
  });

  it("does not reinterpret ordinary numeric ranges or add a fabricated timeline", () => {
    const source = [
      "【第1段·30s】室内",
      "镜头编号 10-15 仅作资产索引，不是时间轴。",
      "【导演策略】保留 2-3 个可辨认的关系位置。",
    ].join("\n");
    const result = compileManhuaPilotPrompt(source);
    expect(result.prompt).toBe([
      "【第1段·10s】室内",
      "镜头编号 10-15 仅作资产索引，不是时间轴。",
      "【导演策略】保留 2-3 个可辨认的关系位置。",
    ].join("\n"));
    expect(result).toMatchObject({
      hadTimeline: false,
      keptTimelineCount: 0,
      removedTimelineCount: 0,
      clampedTimelineCount: 0,
    });
  });
});

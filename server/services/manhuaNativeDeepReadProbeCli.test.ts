import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const created: string[] = [];
afterEach(() => {
  for (const directory of created.splice(0)) rmSync(directory, { recursive: true, force: true });
});
function probe(args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", "scripts/manhua-native-two-segment-douyin-probe.mts", ...args], {
    cwd: process.cwd(), encoding: "utf8", timeout: 20_000,
    env: { ...process.env, FLY_APP_NAME: "", FLY_IMAGE_REF: "" },
  });
}
function manifestFile(boundaries: number[]) {
  const directory = mkdtempSync(join(tmpdir(), "native-probe-cli-test-"));
  created.push(directory);
  const path = join(directory, "manifest.json");
  writeFileSync(path, JSON.stringify({
    schemaVersion: 1, sourceDigest: "a".repeat(64), sourceDurationSec: boundaries.at(-1),
    segments: boundaries.slice(1).map((endSec, segmentIndex) => ({
      segmentIndex, startSec: boundaries[segmentIndex], endSec,
      gsUri: `gs://test-bucket/never-downloaded-${segmentIndex}.mp4`,
      bytes: 1234, hasAudio: true,
    })),
  }));
  return path;
}
function preflightSummary(result: ReturnType<typeof probe>) {
  return JSON.parse(result.stdout.slice(result.stdout.indexOf("{"))) as {
    segmentSeconds: number | null;
    requestedSegmentSeconds: number | null;
    videoFps: number;
    fps: number;
    segmentPlans?: Array<{ segmentIndex: number; startSec: number; endSec: number; durationSec: number; fps: number }>;
  };
}
describe("真实探针 CLI 零付费入口", () => {
  it("默认只预检，MEDIUM通过且明确未做实弹验收", () => {
    const result = probe([]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("thinkingLevel=MEDIUM");
    expect(result.stdout).toContain('"paidCalls": 0');
    expect(result.stdout).toContain('"acceptanceStatus": "not_run"');
    expect(result.stdout).not.toContain("片源解析");
    expect(preflightSummary(result)).toMatchObject({ segmentSeconds: 300, requestedSegmentSeconds: null, fps: 12 });
  });
  it("本机显式执行也会在任何上游调用前被阻断", () => {
    const result = probe(["--execute", "--url=https://example.invalid/video/1234567890123"]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("付费探针只允许在 Fly 容器内运行");
  });
  it("带真实映射的GCS清单可离线预检，不下载视频", () => {
    const directory = mkdtempSync(join(tmpdir(), "native-probe-cli-test-"));
    created.push(directory);
    const path = join(directory, "manifest.json");
    writeFileSync(path, JSON.stringify({
      schemaVersion: 1, sourceDigest: "a".repeat(64), sourceDurationSec: 300.3,
      segments: [{ segmentIndex: 0, startSec: 0, endSec: 300.3,
        gsUri: "gs://test-bucket/never-downloaded.mp4", bytes: 1234, hasAudio: true }],
    }));
    const result = probe([`--gcs-manifest=${path}`]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"manifestValidated": true');
    expect(result.stdout).toContain('"segmentCount": 1');
    expect(result.stdout).toContain('"paidCalls": 0');
    expect(preflightSummary(result)).toMatchObject({
      segmentSeconds: null, requestedSegmentSeconds: null, fps: 12,
      segmentPlans: [{ segmentIndex: 0, startSec: 0, endSec: 300.3, durationSec: 300.3, fps: 12 }],
    });
  });
  it.each([1, 180, 600, 7200])("显式%is分片沿生产解析且默认12fps，仍不解析或下载源片", (seconds) => {
    const result = probe([`--segment-seconds=${seconds}`]);
    expect(result.status).toBe(0);
    expect(preflightSummary(result)).toMatchObject({ segmentSeconds: seconds, requestedSegmentSeconds: seconds, fps: 12 });
    expect(result.stdout).toContain('"paidCalls": 0');
    expect(result.stdout).not.toContain("片源解析");
  });
  it.each(["", "0", "-1", "1.5", "7201", "NaN", "Infinity", "false"])("非法分片长度%s在离线预检即拒绝，不能回落300秒", (value) => {
    const result = probe([`--segment-seconds=${value}`]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("--segment-seconds");
    expect(result.stdout).not.toContain('"mode": "preflight_only"');
  });
  it.each([
    { label: "缺值", args: ["--segment-seconds"] },
    { label: "重复", args: ["--segment-seconds=180", "--segment-seconds=600"] },
  ])("拒绝$label分片参数", ({ args }) => {
    const result = probe(args);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("--segment-seconds");
  });
  it("清单显式匹配180秒计划，实际尾片90秒进入预检回执", () => {
    const result = probe([`--gcs-manifest=${manifestFile([0, 180, 360, 450])}`, "--segment-seconds=180"]);
    expect(result.status).toBe(0);
    expect(preflightSummary(result)).toMatchObject({
      segmentSeconds: 180, requestedSegmentSeconds: 180, fps: 12,
      segmentPlans: [
        { segmentIndex: 0, startSec: 0, endSec: 180, durationSec: 180, fps: 12 },
        { segmentIndex: 1, startSec: 180, endSec: 360, durationSec: 180, fps: 12 },
        { segmentIndex: 2, startSec: 360, endSec: 450, durationSec: 90, fps: 12 },
      ],
    });
  });
  it.each([
    { label: "等片数但片长不同", boundaries: [0, 150, 300, 450] },
    { label: "片数不同", boundaries: [0, 300, 450] },
    { label: "单处边界不同", boundaries: [0, 179, 360, 450] },
  ])("显式180秒与清单$label即拒绝，不能改写或重切", ({ boundaries }) => {
    const result = probe([`--gcs-manifest=${manifestFile(boundaries)}`, "--segment-seconds=180"]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("清单边界与 --segment-seconds=180 不一致");
    expect(result.stdout).not.toContain('"mode": "preflight_only"');
  });
  it("显式长度对账允许1e-6内浮点误差，保留清单原值", () => {
    const result = probe([`--gcs-manifest=${manifestFile([0, 180.0000001, 360, 450])}`, "--segment-seconds=180"]);
    expect(result.status).toBe(0);
    expect(preflightSummary(result).segmentPlans?.[0].endSec).toBe(180.0000001);
  });
  it("未显式指定长度时完整保留不规则清单，不偷偷套默认300秒", () => {
    const result = probe([`--gcs-manifest=${manifestFile([0, 401.5, 590.25, 720])}`]);
    expect(result.status).toBe(0);
    expect(preflightSummary(result)).toMatchObject({
      segmentSeconds: null, requestedSegmentSeconds: null, fps: 12,
      segmentPlans: [
        { segmentIndex: 0, startSec: 0, endSec: 401.5, durationSec: 401.5, fps: 12 },
        { segmentIndex: 1, startSec: 401.5, endSec: 590.25, durationSec: 188.75, fps: 12 },
        { segmentIndex: 2, startSec: 590.25, endSec: 720, durationSec: 129.75, fps: 12 },
      ],
    });
  });
  it.each([0.5, 12, 24])("fps=%s独立配置，不根据319秒时长猜采样率", (fps) => {
    const result = probe(["--segment-seconds=319", `--fps=${fps}`]);
    expect(result.status).toBe(0);
    expect(preflightSummary(result)).toMatchObject({ segmentSeconds: 319, fps, videoFps: fps });
    expect(result.stdout).toContain('"paidCalls": 0');
  });
  it("已有319秒分片显式12fps，逐片回执与请求采样率一致", () => {
    const result = probe([`--gcs-manifest=${manifestFile([0, 319, 638])}`, "--segment-seconds=319", "--fps=12"]);
    expect(result.status).toBe(0);
    expect(preflightSummary(result)).toMatchObject({
      segmentSeconds: 319, videoFps: 12, fps: 12,
      segmentPlans: [
        { segmentIndex: 0, startSec: 0, endSec: 319, durationSec: 319, fps: 12 },
        { segmentIndex: 1, startSec: 319, endSec: 638, durationSec: 319, fps: 12 },
      ],
    });
  });
  it.each(["", "0", "-1", "24.1", "NaN", "Infinity", "false"])("非法fps=%s在离线预检拒绝，不默默回落10", (fps) => {
    const result = probe([`--fps=${fps}`]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("--fps");
  });
  it.each([
    { name: "缺值", args: ["--fps"] },
    { name: "重复", args: ["--fps=10", "--fps=12"] },
  ])("拒绝$name的fps参数", ({ args }) => {
    const result = probe(args);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("--fps");
  });
});

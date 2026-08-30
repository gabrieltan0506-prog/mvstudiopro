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
describe("真实探针 CLI 零付费入口", () => {
  it("默认只预检，MEDIUM通过且明确未做实弹验收", () => {
    const result = probe([]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("thinkingLevel=MEDIUM");
    expect(result.stdout).toContain('"paidCalls": 0');
    expect(result.stdout).toContain('"acceptanceStatus": "not_run"');
    expect(result.stdout).not.toContain("片源解析");
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
  });
});

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
function file() {
  const directory = mkdtempSync(join(tmpdir(), "native-diagnostic-cli-test-"));
  directories.push(directory);
  const path = join(directory, "fake-manifest.json");
  writeFileSync(path, JSON.stringify({
    schemaVersion: 1, sourceDigest: "a".repeat(64), sourceDurationSec: 1594,
    segments: [319, 638, 957, 1276, 1594].map((endSec, segmentIndex) => ({
      segmentIndex, startSec: segmentIndex * 319, endSec, bytes: 1234, hasAudio: true,
      gsUri: `gs://test-bucket/never-accessed-${segmentIndex}.mp4`,
    })),
  }));
  return path;
}
function cli(args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", "scripts/manhua-native-two-segment-douyin-probe.mts", ...args], {
    cwd: process.cwd(), encoding: "utf8", timeout: 20_000,
    // 子进程仅继承可执行路径，不继承本机凭证、Fly身份或任何供应商配置。
    env: { PATH: process.env.PATH, NODE_ENV: "test", FLY_APP_NAME: "", FLY_IMAGE_REF: "" },
  });
}
describe("真实CLI选片诊断离线预检", () => {
  /**
   * 0831 用户令：一次只准读一片。多片选段在解析阶段就被拒，不到付费。
   * 「第一片一次成功后，才准接着读第二片；失败必须知道原因，没找到原因不准读第二片。」
   */
  it.each(["0,1", "4,2,0"])("多片选段 %s 被顺序闸拒绝，不进入预检", (selection) => {
    const result = cli(["--gemini-only", `--segment-indexes=${selection}`, `--gcs-manifest=${file()}`, "--fps=14"]);
    expect(result.status).not.toBe(0);
    expect(result.stderr + result.stdout).toContain("一次只准读一片");
  });

  it.each(["0"])("%s保留完整1594秒5片，只打印实际选中原索引", (selection) => {
    const result = cli(["--gemini-only", `--segment-indexes=${selection}`, `--gcs-manifest=${file()}`, "--segment-seconds=319", "--fps=12"]);
    expect(result.status).toBe(0);
    const summary = JSON.parse(result.stdout.slice(result.stdout.indexOf("{")));
    expect(summary).toMatchObject({ mode: "preflight_only", paidCalls: 0, diagnosticMode: "gemini_selected",
      sourceDurationSec: 1594, segmentCount: 5, videoFps: 12, assemblyComplete: false, productAcceptance: "not_run", glmStatus: "not_run" });
    expect(summary.selectedSegmentIndexes).toEqual(selection.split(",").map(Number).sort((a, b) => a - b));
    expect(summary.segmentPlans).toHaveLength(5);
    expect(result.stdout).not.toContain("阶段：");
  });
  it("本机execute在读取不存在的清单前拒绝，不尝试文件/GCS/模型", () => {
    const result = cli(["--execute", "--gemini-only", "--segment-indexes=0", "--gcs-manifest=/does-not-exist/manifest.json"]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("付费探针只允许在 Fly");
    expect(result.stderr).not.toContain("ENOENT");
  });
  it.each(["0,0", "0,1,2,3", "5"])("拒绝非法选段%s，不落回整集", (selection) => {
    const result = cli(["--gemini-only", `--segment-indexes=${selection}`, `--gcs-manifest=${file()}`]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("segment-indexes");
    expect(result.stdout).not.toContain('"mode": "preflight_only"');
  });
  it("缺--gemini-only也不按整集发车", () => {
    const result = cli(["--segment-indexes=0", `--gcs-manifest=${file()}`]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("gemini-only");
  });
});

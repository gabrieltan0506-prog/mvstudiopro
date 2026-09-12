import { afterAll, describe, it, expect } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createManhuaPrevisStudio } from "../../shared/manhuaPrevis";
import { renderManhuaPrevis, runPrevisProcess } from "./manhuaPrevisRender";

// 显式 opt-in，只跑本机渲染；存储替身写临时验收目录，不访问任何生产凭证。
describe.skipIf(!process.env.PREVIS_BLENDER_TEST)("白模真实渲染", () => {
  it("受控配置真实产出关节、48帧、可解码视频和证据", async () => {
    const spec = createManhuaPrevisStudio(
      2,
      "11111111-1111-4111-8111-111111111111"
    ).spec;
    spec.actors[0].end = [-0.4, 0];
    spec.actors[0].actions = [{ kind: "strike", startSec: 0, endSec: 2 }];
    const out =
      process.env.PREVIS_TEST_OUTPUT ||
      "/private/tmp/manhua-previs-integration-0911";
    await mkdir(out, { recursive: true });
    const stored: string[] = [];
    const result = await renderManhuaPrevis(
      {
        requestId: "22222222-2222-4222-8222-222222222222",
        scopeId: "11111111-1111-4111-8111-111111111111",
        clipId: "clip-test",
        spec,
      },
      "7",
      { signal: AbortSignal.timeout(120_000) },
      {
        blender: process.env.PREVIS_BLENDER_TEST!,
        useXvfb: process.platform === "linux",
        run: runPrevisProcess,
        upload: async ({ objectName, buffer }) => {
          stored.push(objectName);
          await writeFile(path.join(out, path.basename(objectName)), buffer);
          return {
            bucket: "test-bucket",
            objectName,
            gcsUri: `gs://test-bucket/${objectName}`,
          };
        },
      }
    );
    expect(result.report.frames).toBe(48);
    expect(result.report.actors[0].bones).toBe(16);
    expect(result.report.actors[0].stanceDrift).toBeLessThan(0.005);
    expect(result.bytes).toBeGreaterThan(1000);
    expect(stored.map(x => path.basename(x))).toEqual([
      "request.json",
      "report.json",
      "evidence.json",
      "report.parsed.json",
      "report.parsed-evidence.json",
      "scene.blend",
      "probe.json",
      "probe-evidence.json",
      "probe.parsed.json",
      "validation-evidence.json",
      "preview.mp4",
      "result.json",
      "result-evidence.json",
    ]);
    await writeFile(
      path.join(out, "验收结果.json"),
      JSON.stringify(result, null, 2)
    );
    console.log(
      "PREVIS_REAL_RENDER",
      JSON.stringify({
        frames: result.report.frames,
        bytes: result.bytes,
        sha256: result.sha256,
        actors: result.report.actors,
        out,
      })
    );
  }, 150_000);
});

/**
 * 竖屏构图（0912 实测定案）。需要真 Blender：`PREVIS_BLENDER_TEST=1` 才跑。
 *
 * 0911 验收记的「竖屏人物偏小」在这里量成了数字：Blender 默认 AUTO 传感器拟合把 36mm
 * 套在较长边，竖屏于是套在高上，垂直视场从 32.3° 张到 54.4°，人物占画面高度 33.1% → 18.6%。
 *
 * 直接改成竖向拟合会把多角色挤出画（实测三角色 2/3 出画、六角色紧凑站位 3/6 出画），
 * 所以只在收紧后所有人仍在画内时才收紧。这条测试钉住两侧：单人要收紧，多角色不许被挤出画。
 */
describe.skipIf(!process.env.PREVIS_BLENDER_TEST)("竖屏构图按人数自适应", () => {
  const framingTempDirs: string[] = [];
  afterAll(async () => {
    const { rm } = await import("node:fs/promises");
    await Promise.all(framingTempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  const buildSpec = (
    aspect: "16:9" | "9:16",
    xs: number[],
    actionKind?: "strike" | "guard",
  ) => {
    const base = createManhuaPrevisStudio(2, "11111111-1111-4111-8111-111111111111").spec;
    const actor = base.actors[0]!;
    return {
      ...base,
      aspect,
      actors: xs.map((x, i) => ({
        ...actor,
        id: `a${i}`,
        nameZh: `角色${i}`,
        start: [x, 0] as [number, number],
        end: [x, 0] as [number, number],
        moveEndSec: 2,
        actions: actionKind
          ? [{ kind: actionKind, startSec: 0, endSec: 2 }]
          : actor.actions.filter(a => a.endSec <= 2),
      })),
      cameras: base.cameras
        .filter(c => c.startSec < 2)
        .map((c, i, arr) => ({ ...c, endSec: i === arr.length - 1 ? 2 : Math.min(c.endSec, 2) })),
    };
  };

  const runPrevis = async (
    aspect: "16:9" | "9:16",
    xs: number[],
    actionKind?: "strike" | "guard",
  ) => {
    const { mkdtemp, readFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const dir = await mkdtemp(path.join(tmpdir(), "previs-framing-"));
    framingTempDirs.push(dir);
    await writeFile(path.join(dir, "spec.json"), JSON.stringify(buildSpec(aspect, xs, actionKind)));
    await runPrevisProcess(
      process.env.PREVIS_BLENDER_TEST!,
      ["--background", "--factory-startup", "--disable-autoexec", "--threads", "2",
        "--python-exit-code", "1", "--python", path.resolve("server/scripts/render-manhua-previs.py"),
        "--", path.join(dir, "spec.json"), dir],
      AbortSignal.timeout(300_000)
    );
    return JSON.parse(await readFile(path.join(dir, "report.json"), "utf8")) as {
      portraitFraming: string;
      actors: Array<{ offscreenFrames?: number[] }>;
    };
  };

  it("单人竖屏收紧；三角色退回原口径且不出画；横屏不受影响", async () => {
    const solo = await runPrevis("9:16", [0]);
    expect(solo.portraitFraming).toBe("tight");
    expect(solo.actors.flatMap(a => a.offscreenFrames ?? [])).toEqual([]);

    const trio = await runPrevis("9:16", [-1.6, 0, 1.6]);
    expect(trio.portraitFraming).toBe("auto");
    expect(trio.actors.flatMap(a => a.offscreenFrames ?? [])).toEqual([]);

    const landscape = await runPrevis("16:9", [0]);
    expect(landscape.portraitFraming).toBe("landscape");
  }, 900_000);

  /**
   * 审查实测的回归：收紧把横向半宽从 2.31m 压到 1.30m（8m 处 lens 35），
   * 出手动作的手臂伸展约 0.6m 正好落在头脚与画框之间。
   * 只按报告口径（头+脚）判定会报「全在画内」并收紧，实际 hand 出画 25 帧、
   * forearm 24 帧、upper_arm 17 帧，而报告的 offscreenFrames 全是 0 ——
   * 画面被切了，证据面还说没切。所以收紧判据必须扫全部骨骼，比报告更严。
   */
  it("两角色出手时手臂会被收紧切掉，应当退回原口径而不是谎报全在画内", async () => {
    const strike = await runPrevis("9:16", [-1, 1], "strike");
    // 钉住 bug 的是这一行：换回只扫头+脚的实现，这里会拿到 "tight"（审查实测复现过）。
    expect(strike.portraitFraming).toBe("auto");
    // 下面这条**没有区分力**——报告口径本来就只看头+脚，有 bug 的版本同样报零出画
    //（那正是当初没发现问题的原因）。留着只是声明「退回之后不该出画」，不要当成
    // 证据面也被钉住了。
    expect(strike.actors.flatMap(a => a.offscreenFrames ?? [])).toEqual([]);
  }, 900_000);
});

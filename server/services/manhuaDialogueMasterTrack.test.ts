/** 秒锁母轨计划测试：钉滤镜顺序、跑道、重叠、顶格裁切与引擎时长边界 */
import { describe, expect, it } from "vitest";
import {
  buildDialogueMasterTrackArgs,
  buildDialogueMasterTrackPlan,
  DIALOGUE_MASTER_TRACK_HARD_CAP_SEC,
} from "./manhuaDialogueMasterTrack";

const line = (index: number, startSec: number, audioDurationSec: number) =>
  ({ index, startSec, audioDurationSec });

describe("buildDialogueMasterTrackPlan", () => {
  it("滤镜顺序：silenceremove(双向) → asetpts → adelay，静音底 anullsrc，amix normalize=0", () => {
    const plan = buildDialogueMasterTrackPlan({
      lines: [line(0, 2, 3), line(1, 7.5, 2.5)],
      windowDurationSec: 15,
      engine: "evolink",
    });
    const g = plan.filterGraph;
    expect(g.indexOf("silenceremove")).toBeLessThan(g.indexOf("asetpts"));
    expect(g.indexOf("asetpts")).toBeLessThan(g.indexOf("adelay=2000|2000"));
    expect(g).toContain("adelay=7500|7500");
    expect(g).toContain("anullsrc=r=44100:cl=stereo");
    expect(g).toContain("amix=inputs=3:duration=first:normalize=0");
    // 掐尾是 areverse 夹 silenceremove
    expect(g).toContain("areverse,silenceremove");
    expect(plan.totalDurationSec).toBeCloseTo(10.3, 3);
    expect(plan.hardCapApplied).toBe(false);
  });

  it("首句跑道不足 1.5s 拒绝：让台词表后移，不砍跑道", () => {
    expect(() => buildDialogueMasterTrackPlan({
      lines: [line(0, 0.8, 3)],
      windowDurationSec: 15,
      engine: "evolink",
    })).toThrow("跑道");
  });

  it("句间重叠拒绝：句间必须是真静音", () => {
    expect(() => buildDialogueMasterTrackPlan({
      lines: [line(0, 2, 4), line(1, 5.5, 2)],
      windowDurationSec: 15,
      engine: "evolink",
    })).toThrow("重叠");
  });

  it("30s 窗口顶格裁 29.7s；末句被裁则拒绝而非默默截尾", () => {
    const ok = buildDialogueMasterTrackPlan({
      lines: [line(0, 2, 3), line(1, 26, 3.5)],
      windowDurationSec: 30,
      engine: "evolink",
    });
    expect(ok.totalDurationSec).toBe(DIALOGUE_MASTER_TRACK_HARD_CAP_SEC);
    expect(ok.hardCapApplied).toBe(true);
    expect(() => buildDialogueMasterTrackPlan({
      lines: [line(0, 27, 3.5)],
      windowDurationSec: 31,
      engine: "evolink",
    })).toThrow("顶格线");
  });

  it("低于引擎下限拒绝且明说禁止垫静音；wan30 超 15s 拒绝", () => {
    expect(() => buildDialogueMasterTrackPlan({
      lines: [line(0, 1.5, 0.2)],
      windowDurationSec: 1.8,
      engine: "evolink",
    })).toThrow("垫静音");
    expect(() => buildDialogueMasterTrackPlan({
      lines: [line(0, 2, 15)],
      windowDurationSec: 18,
      engine: "wan30",
    })).toThrow("拆段");
  });

  it("args：逐句 -i 输入、map [master]、必然重编码 libmp3lame", () => {
    const plan = buildDialogueMasterTrackPlan({
      lines: [line(0, 2, 3)],
      windowDurationSec: 10,
      engine: "evolink",
    });
    const args = buildDialogueMasterTrackArgs({
      lineLocalPaths: ["/tmp/l0.mp3"],
      plan,
      outputPath: "/tmp/master.mp3",
    });
    expect(args).toContain("/tmp/l0.mp3");
    expect(args[args.indexOf("-map") + 1]).toBe("[master]");
    expect(args).toContain("libmp3lame");
    expect(args).not.toContain("copy");
  });
});

describe("renderManhuaDialogueMasterTrack（执行层，替身依赖）", () => {
  const makeDeps = (over: Partial<Record<string, unknown>> = {}) => {
    const written: Record<string, Buffer> = {};
    const uploads: Array<{ objectName: string; bytes: number }> = [];
    const runMedia = async (cmd: string, args: string[]) => {
      if (cmd === "ffprobe") {
        // 逐句 3.0s；量成品母轨时回计划时长（路径含 master）
        const isMaster = args.some((a) => String(a).includes("manhua-dialogue-master"));
        return JSON.stringify({ format: { duration: isMaster ? "10.3" : "3.0" } });
      }
      if (args.includes("silencedetect=noise=-45dB:d=0.2")) {
        return "[silencedetect] silence_start: 5.1\n[silencedetect] silence_end: 6.9";
      }
      // 拼轨：把成品写出来，让后续 readFile/probe 能走
      const out = args.at(-1)!;
      const { writeFileSync } = await import("node:fs");
      writeFileSync(out, Buffer.from("master-audio-fixture"));
      return "";
    };
    return {
      deps: {
        fetchAudio: async () => Buffer.from("line-audio"),
        runMedia: runMedia as never,
        uploadAudio: (async (p: { objectName: string; buffer: Buffer }) => {
          uploads.push({ objectName: p.objectName, bytes: p.buffer.length });
          return { bucket: "b", objectName: p.objectName, gcsUri: `gs://b/${p.objectName}` };
        }) as never,
        ...over,
      },
      uploads,
      written,
    };
  };

  it("逐句实测时长→计划→拼轨→自检→上传，产物单条", async () => {
    const { renderManhuaDialogueMasterTrack } = await import("./manhuaDialogueMasterTrack");
    const { deps, uploads } = makeDeps();
    const out = await renderManhuaDialogueMasterTrack({
      ownerUserId: 7,
      lines: [
        { index: 0, audioUrl: "https://x/a.mp3", startSec: 2 },
        { index: 1, audioUrl: "https://x/b.mp3", startSec: 7 },
      ],
      windowDurationSec: 15,
      engine: "evolink",
    }, deps as never);
    expect(out.audioGcsUri).toMatch(/^gs:\/\/b\/manhua-dialogue-master\/7\//);
    expect(out.totalDurationSec).toBeCloseTo(10.3, 2);
    expect(uploads).toHaveLength(1);
  });

  it("成品时长与计划不符拒绝上传", async () => {
    const { renderManhuaDialogueMasterTrack } = await import("./manhuaDialogueMasterTrack");
    let probes = 0;
    const { deps, uploads } = makeDeps({
      runMedia: (async (cmd: string, args: string[]) => {
        if (cmd === "ffprobe") {
          probes += 1;
          // 前两次量逐句 3.0s；量成品时给一个错的 20s
          return JSON.stringify({ format: { duration: probes <= 2 ? "3.0" : "20.0" } });
        }
        const out = args.at(-1)!;
        const { writeFileSync } = await import("node:fs");
        if (String(out).endsWith(".mp3")) writeFileSync(out, Buffer.from("x"));
        return "";
      }) as never,
    });
    await expect(renderManhuaDialogueMasterTrack({
      ownerUserId: 7,
      lines: [
        { index: 0, audioUrl: "https://x/a.mp3", startSec: 2 },
        { index: 1, audioUrl: "https://x/b.mp3", startSec: 7 },
      ],
      windowDurationSec: 15,
      engine: "evolink",
    }, deps as never)).rejects.toThrow("不符");
    expect(uploads).toHaveLength(0);
  });
});

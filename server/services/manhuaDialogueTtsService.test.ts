import { describe, expect, it } from "vitest";
import {
  buildManhuaDialoguePostprocessArgs,
  buildZhaoguTianmenDialogueServicePlan,
  ZHAOGU_TIANMEN_VOICE_BY_TAG,
} from "./manhuaDialogueTtsService";

const PROMPT = [
  "0–1.2s：@角色3 冷漠说「残骨，也敢叩天门？」。",
  "3.2–4.3s：@角色2 低声说「别救我，夺阵眼。」。",
  "6.3–7.2s：@角色3 冷笑说「你替她死？」。",
  "11.4–12.4s：@角色1 沉声说「借我一息。」。",
  "15–15.8s：@角色2 低声说「门后……醒了。」。",
].join("\n");

describe("manhuaDialogueTtsService", () => {
  it("照骨天门三角色显式绑定597目录候选，但探针前不冒充可合成", () => {
    expect(Object.keys(ZHAOGU_TIANMEN_VOICE_BY_TAG)).toEqual(["@角色1", "@角色2", "@角色3"]);
    expect(Object.values(ZHAOGU_TIANMEN_VOICE_BY_TAG)
      .every((item) => item.availability === "candidate_unprobed")).toBe(true);
    const plan = buildZhaoguTianmenDialogueServicePlan(PROMPT);
    expect(plan.readyForSynthesis).toBe(false);
    expect(plan.lines.map((line) => line.dialogueZh)).toEqual([
      "残骨，也敢叩天门？", "别救我，夺阵眼。", "你替她死？", "借我一息。", "门后……醒了。",
    ]);
    for (const group of plan.groups) {
      expect(Object.keys(group.requestBody).sort()).toEqual([
        "input", "model", "response_format", "seed", "voice",
      ]);
    }
  });

  it("相邻同音色有秒轴停顿时不合并，保留五个起止窗口", () => {
    const plan = buildZhaoguTianmenDialogueServicePlan(PROMPT);
    expect(plan.groups).toHaveLength(5);
    expect(plan.groups.map((group) => [group.startSec, group.endSec])).toEqual([
      [0, 1.2], [3.2, 4.3], [6.3, 7.2], [11.4, 12.4], [15, 15.8],
    ]);
  });

  it("ffmpeg后制覆盖音高/音色EQ/响度/时长，路径与台词不进shell", () => {
    const args = buildManhuaDialoguePostprocessArgs({
      speakerTag: "@角色3",
      inputPath: "/tmp/in;touch-pwned.mp3",
      outputPath: "/tmp/out.mp3",
      targetDurationSec: 1.2,
    });
    expect(args).toContain("/tmp/in;touch-pwned.mp3");
    expect(args).toContain("/tmp/out.mp3");
    const filter = args[args.indexOf("-af") + 1]!;
    expect(filter).toContain("asetrate=");
    expect(filter).toContain("equalizer=");
    expect(filter).toContain("loudnorm=");
    expect(filter).toContain("atrim=duration=1.200");
    expect(args).not.toContain("sh");
    expect(args).not.toContain("-c");
  });
});

import { describe, expect, it } from "vitest";
import {
  checkMvShotCastInteraction,
  checkMvShotPromptCastInteraction,
  checkMvShotReferenceRequirement,
  mvShotMultiPersonCues,
  MV_SHOT_CAST_CONFLICT_ERROR_ZH,
  MV_SHOT_MODE_ERROR_ZH,
  MV_SHOT_REFERENCE_ERROR_ZH,
} from "./canvasMusicMvShotGuards";
import { compileMvShotTimedPrompt } from "./canvasMusicMvShotPrompt";
import type { MvShotReferences } from "./canvasMusicMvReferences";
import type { MusicMvShotBeat } from "./canvasMusicMv";

const refs: MvShotReferences = {
  anchorImage: { gcsUri: "gs://b/anchor.png", label: "主角定妆帧" },
  sceneImages: [{ gcsUri: "gs://b/s1.jpg", label: "便利店" }],
  motionVideos: [{ source: "stock", gcsUri: "gs://b/m.mp4", inSec: 0, outSec: 6, durationSec: 6, label: "动作" }],
  songSlice: { jobId: "j", gcsUri: "gs://b/slice.wav", startSec: 0, endSec: 6 },
};
const beat = (a: number, b: number, actionZh: string, extra: Partial<MusicMvShotBeat> = {}): MusicMvShotBeat => ({
  startSec: a, endSec: b, actionZh, cameraZh: "中景缓推近，镜头拉远收尾", lightingZh: "冷白顶光", moodZh: "压抑", sfxZh: "雨声", ...extra,
});
const compile = (beats: MusicMvShotBeat[], castZh?: string[], kind?: "singing") =>
  compileMvShotTimedPrompt(
    { shotId: "s1", startSec: 0, endSec: 6, visualPrompt: "她站在便利店门口", cameraPrompt: "中景", beats, ...(kind ? { kind, lyricTiming: "confirmed" as const, lyricLines: [{ text: "别走", startSec: 0.2, endSec: 2.5 }] } : {}) },
    {
      engine: "seedance-2.0-mini", modelLabel: "草稿档", resolution: "480p", aspectRatio: "9:16", generateDurationSec: 7,
      beatGrid: { bpm: 120, beatSec: 0.5 }, references: refs, ...(castZh ? { castZh } : {}),
    },
  ).text;

describe("#3 多人互动 × 角色表：单人锁下检出两人戏即拦截（宁可多拦）", () => {
  it("关键词：接触动词、她/他同现、复数指代、第二角色称谓都算多人线索；单人动作与运镜推拉不算", () => {
    expect(mvShotMultiPersonCues(["她抬手扇了他一记耳光"]).join()).toMatch(/接触/);
    expect(mvShotMultiPersonCues(["他走近，她后退半步"]).join()).toMatch(/男女同现/);
    expect(mvShotMultiPersonCues(["两人在雨里对视"]).length).toBeGreaterThan(0);
    expect(mvShotMultiPersonCues(["男友把伞递过来"]).join()).toMatch(/第二角色/);
    expect(mvShotMultiPersonCues(["她一把拉住对方的手腕"]).length).toBeGreaterThan(0);
    expect(mvShotMultiPersonCues(["她推开门走进雨里，镜头缓推近再拉远", "她抱着吉他坐下，不并列其他动作"])).toEqual([]);
  });

  it("客户端闸：角色表 ≤1 人 + 耳光 → 拦截并给统一文案；角色表 ≥2 人放行；演唱镜不在此闸", () => {
    const texts = ["她站在便利店门口", "她抬手一记耳光甩在他脸上"];
    const blocked = checkMvShotCastInteraction({ castZh: undefined, texts });
    expect(blocked.ok).toBe(false);
    expect(!blocked.ok && blocked.error).toBe(MV_SHOT_CAST_CONFLICT_ERROR_ZH);
    expect(MV_SHOT_CAST_CONFLICT_ERROR_ZH).toContain("检测到多人互动但角色表只有一人，请在创作说明里写『角色表：…』或重建镜头节点");
    expect(MV_SHOT_CAST_CONFLICT_ERROR_ZH).toContain("未扣费");
    expect(checkMvShotCastInteraction({ castZh: ["女主：短发白衬衫"], texts }).ok).toBe(false);
    expect(checkMvShotCastInteraction({ castZh: ["女主：短发白衬衫", "男主：黑西装"], texts }).ok).toBe(true);
    expect(checkMvShotCastInteraction({ kind: "singing", texts }).ok).toBe(true);
    expect(checkMvShotCastInteraction({ castZh: [], texts: ["她独自走过天桥，回头"] }).ok).toBe(true);
  });

  it("服务端闸（按实际出站提示词）：单人锁 + 耳光节拍 → 拦截；同一节拍有角色表 → 放行", () => {
    const beats = [beat(0, 3, "她走近他，抬手蓄力"), beat(3, 6, "她一记耳光扇在他脸上，他偏头停住")];
    const single = compile(beats);
    expect(single).toContain("本镜只有同一位主角");
    const r = checkMvShotPromptCastInteraction(single);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toBe(MV_SHOT_CAST_CONFLICT_ERROR_ZH);
    expect(checkMvShotPromptCastInteraction(compile(beats, ["女主：短发白衬衫", "男主：黑西装"])).ok).toBe(true);
  });

  it("服务端闸：单人锁 + 纯单人节拍 → 放行（编译器规则原文、关键事件规则、光色规则不自触发）", () => {
    const prompt = compile([beat(0, 3, "她推开门走进雨里"), beat(3, 6, "她的手机掉落在地，停在原地")]);
    expect(prompt).toContain("关键事件窗");
    expect(checkMvShotPromptCastInteraction(prompt)).toEqual({ ok: true });
  });

  it("服务端闸：演唱者锁放行；找不到人物锁的旧提示词按全文检查（宁可多拦）", () => {
    const sing = compile([beat(0, 3, "她对镜头唱", { lipSync: true }), beat(3, 6, "她低头")], undefined, "singing");
    expect(sing).toContain("本镜是演唱者镜");
    expect(checkMvShotPromptCastInteraction(sing).ok).toBe(true);
    expect(checkMvShotPromptCastInteraction("她和男友在雨里拥抱").ok).toBe(false);
    expect(checkMvShotPromptCastInteraction("她独自在雨里走").ok).toBe(true);
  });
});

describe("#5 两条 Seedance 路线同一参考闸", () => {
  const ok = (mode: string | undefined, imageCount: number, videoCount: number, audioCount: number) =>
    checkMvShotReferenceRequirement({ mode, imageCount, videoCount, audioCount });

  it("必须 reference_to_video", () => {
    for (const mode of [undefined, "", "image_to_video", "text_to_video", "reference-to-video"]) {
      const r = ok(mode, 2, 1, 1);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.error).toBe(MV_SHOT_MODE_ERROR_ZH);
    }
  });

  it("至少 1 张图且总参考 ≥2；文案一致且写明未提交未扣费", () => {
    expect(ok("reference_to_video", 1, 0, 0).ok).toBe(false); // 只有 1 张图（旧 2.5 路线会放行）
    expect(ok("reference_to_video", 0, 1, 1).ok).toBe(false); // 没图
    expect(ok("reference_to_video", 0, 0, 0).ok).toBe(false);
    const r = ok("reference_to_video", 0, 2, 1);
    expect(!r.ok && r.error).toBe(MV_SHOT_REFERENCE_ERROR_ZH);
    expect(MV_SHOT_REFERENCE_ERROR_ZH).toMatch(/未提交、未扣费/);
    expect(ok("reference_to_video", 1, 0, 1).ok).toBe(true);
    expect(ok("reference_to_video", 2, 0, 0).ok).toBe(true);
    expect(ok("reference_to_video", 1, 1, 1).ok).toBe(true);
    expect(ok("reference_to_video", Number.NaN, 5, 5).ok).toBe(false);
  });
});

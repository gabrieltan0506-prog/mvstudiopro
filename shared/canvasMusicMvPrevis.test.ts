import { describe, expect, it, vi } from "vitest";
import {
  buildMvShotPrevisStudio,
  mvPrevisAdoptedSummaryZh,
  mvPrevisAdvisorQuestion,
  mvShotNeedsPrevis,
  mvShotPrevisContentKey,
  nextMvShotAutoPrevis,
  MV_PREVIS_SOFT_HINT_ZH,
  MV_PREVIS_PROMPT_RULE_ZH,
  mvPrevisWindowRuleZh,
  type MvPrevisShot,
} from "./canvasMusicMvPrevis";
import { mvShotMultiPersonCues } from "./canvasMusicMvShotGuards";
import { makeAdvisorPrevisTarget, ADVISOR_PREVIS_EDIT_INSTRUCTIONS } from "./manhuaAdvisorPrevisEdit";
import type { MusicMvShotBeat } from "./canvasMusicMv";
import { requestsAdvisorPrevisRender } from "../client/src/lib/manhuaAdvisorPrevisIntent";

const beat = (a: number, b: number, actionZh: string): MusicMvShotBeat => ({ startSec: a, endSec: b, actionZh, cameraZh: "中景跟拍", lightingZh: "冷白顶光", moodZh: "压抑", sfxZh: "雨声" });
const cast = ["女主：短发白衬衫", "男主：黑西装"];
const slap: MvPrevisShot = {
  shotId: "s3", startSec: 12, endSec: 18, kind: "generated", visualPrompt: "便利店门口", cameraPrompt: "中景",
  beats: [beat(12, 14.5, "她走近，抬起右手"), beat(14.5, 16, "她扇了他一记耳光"), beat(16, 18, "他捂脸后退半步")],
  castZh: cast,
};
describe("1110 多人互动 → 自动白模动作参考", () => {
  it("检测触发：复用 R3 多人互动检测；演唱/无互动/无节拍/角色表不足不发起", () => {
    expect(mvShotNeedsPrevis(slap)).toMatchObject({ needed: true });
    expect(mvShotNeedsPrevis({ ...slap, kind: "singing" })).toMatchObject({ needed: false, reason: "singing" });
    expect(mvShotNeedsPrevis({ ...slap, visualPrompt: "她独自走过天桥", beats: [beat(12, 18, "她独自走过天桥，回头")] })).toMatchObject({ needed: false, reason: "no_interaction" });
    expect(mvShotNeedsPrevis({ ...slap, visualPrompt: "她扇了他一记耳光", beats: [] })).toMatchObject({ needed: false, reason: "no_beats" });
    expect(mvShotNeedsPrevis({ ...slap, castZh: ["女主：短发"] })).toMatchObject({ needed: false, reason: "cast_insufficient" });
  });

  it("自动发起去重：同镜同节拍只发起一次，节拍改了才重新发起；已有白模参考跳过", () => {
    const launched = new Set<string>();
    const skip = (_s: MvPrevisShot, key: string) => launched.has(key);
    const first = nextMvShotAutoPrevis([slap], skip)!;
    expect(first.shot.shotId).toBe("s3");
    launched.add(first.key);
    expect(nextMvShotAutoPrevis([slap], skip)).toBeUndefined();
    const edited = { ...slap, beats: [...slap.beats!.slice(0, 2), beat(16, 18, "他捂脸转身离开")] };
    expect(mvShotPrevisContentKey(edited)).not.toBe(first.key);
    expect(nextMvShotAutoPrevis([edited], skip)?.shot).toBe(edited);
    expect(nextMvShotAutoPrevis([edited], () => true)).toBeUndefined();
  });

  it("顾问入参：逐窗节拍（动作/运镜/音效/镜内秒窗）+ 角色表演员，没有用户手填坐标；提问命中生成试看", () => {
    const studio = buildMvShotPrevisStudio("block-mv-s3", slap);
    const source = studio.advisorShotSource!;
    expect(source.shots.map(s => [s.startSec, s.endSec])).toEqual([[0, 2.5], [2.5, 4], [4, 6]]);
    expect(source.shots[1]!.actionZh).toContain("镜内 2.50–4.00 秒");
    expect(source.shots[1]!.actionZh).toContain("她扇了他一记耳光");
    expect(source.shots[0]!.cameraZh).toBe("中景跟拍");
    expect(source.shots[0]!.soundZh).toBe("雨声");
    expect(studio.spec.actors.map(a => a.nameZh)).toEqual(["女主", "男主"]);
    expect(studio.spec.durationSec).toBe(6);
    // 走原顾问合同校验（未知演员/时长不符会被拒）
    const target = makeAdvisorPrevisTarget("block-mv-s3", studio);
    expect(target.shotSource?.shots).toHaveLength(3);
    const q = mvPrevisAdvisorQuestion(slap, { sceneLabels: ["便利店"], cues: mvShotNeedsPrevis(slap).cues });
    expect(q).toContain("角色表：女主：短发白衬衫；男主：黑西装");
    expect(q).toContain("场景参考：便利店");
    expect(q).toContain("用户不手填数值");
    expect(q).not.toMatch(/\[\s*-?\d|[xyzXYZ]\s*[=:：]\s*-?\d/);
    expect(requestsAdvisorPrevisRender(q)).toBe(true);
    // 顾问侧要求逐镜覆盖并输出 motionRoute/cameras（舞台参数由 LLM 产出）
    expect(ADVISOR_PREVIS_EDIT_INSTRUCTIONS).toContain("shotCoverage");
  });

  it("重建：节拍不变时原样复用（不打断已有历史），节拍变了保留历史并记版本", () => {
    const studio = buildMvShotPrevisStudio("block-mv-s3", slap);
    expect(buildMvShotPrevisStudio("block-mv-s3", slap, studio)).toBe(studio);
    const withHistory = { ...studio, history: [{ jobId: "job-1", requestId: crypto.randomUUID(), gcsUri: "gs://b/p.mp4", url: "https://x/p.mp4", durationSec: 6, createdAt: new Date().toISOString(), spec: studio.spec }] };
    const next = buildMvShotPrevisStudio("block-mv-s3", { ...slap, beats: [...slap.beats!.slice(0, 2), beat(16, 18, "他捂脸转身离开")] }, withHistory as never);
    expect(next.history).toHaveLength(1);
    expect(next.scopeId).toBe(studio.scopeId);
    expect(next.specHistory?.at(-1)?.reasonZh).toContain("重建白模基线");
    expect(() => buildMvShotPrevisStudio("b", { ...slap, castZh: ["女主"] })).toThrow(/角色表不足两人/);
  });

  it("提示词规则（供 compileMvShotTimedPrompt 引用）：严格按白模执行、忽略灰模外观、逐窗秒点", () => {
    const head = MV_PREVIS_PROMPT_RULE_ZH("@视频1", "@图片1、@图片2");
    expect(head).toContain("站位、走位、朝向与肢体接触时序严格按@视频1（白模动作参考）执行");
    expect(head).toContain("人物外形、服装与场景以@图片1、@图片2为准");
    expect(head).toContain("忽略白模的材质与灰模外观");
    expect(mvPrevisWindowRuleZh("@视频1", 2.5, 4)).toBe("站位与动作按@视频1镜内 2.50–4.00 秒段执行");
    // 规则原文不得被 R3 多人互动检测误判为剧情
    expect(mvShotMultiPersonCues([head, mvPrevisWindowRuleZh("@视频1", 0, 1)])).toEqual([]);
  });

  it("采用记录里的顾问说明可回读；软提示文案固定", () => {
    expect(mvPrevisAdoptedSummaryZh({ specHistory: [{ spec: {} as never, createdAt: "x", reasonZh: `用户确认应用顾问试看 ${crypto.randomUUID()}；她站到他左侧，耳光用右手` }] } as never)).toBe("她站到他左侧，耳光用右手");
    expect(MV_PREVIS_SOFT_HINT_ZH).toBe("多人互动镜头建议先生成白模动作参考");
  });

  it("费用：自动发起只经页面顾问入口（submit=true 走面板 send→额度/超额确认），本模块不提交任何任务", () => {
    const open = vi.fn();
    const next = nextMvShotAutoPrevis([slap], () => false)!;
    // 模拟镜头卡自动发起：只调用 bridge.open（OmniCanvas 设 questionSeed，由面板按额度免费或弹「确认支付」）
    open("block-mv-s3", mvPrevisAdvisorQuestion(next.shot), true);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0]![2]).toBe(true);
  });
});

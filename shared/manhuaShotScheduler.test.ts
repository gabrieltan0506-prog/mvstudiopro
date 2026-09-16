import { describe, expect, it } from "vitest";
import { formatManhuaShotScheduleZh, parseManhuaDialogueLines, scheduleManhuaSegmentShots, scheduledShotsToPrevisCameras } from "./manhuaShotScheduler";

const seg02 = ["阿菁：「住手！它已经受伤了！」", "曹三：「你想来白嫖，门都没有。」", "曹三：「你们这两个孽障，今天送你们去见阎王。」"].join("\n");

describe("运镜调度生成器（过肩公式）", () => {
  it("解析对白：说话人 + 去引号正文", () => {
    expect(parseManhuaDialogueLines(seg02)).toEqual([
      { speakerZh: "阿菁", textZh: "住手！它已经受伤了！" },
      { speakerZh: "曹三", textZh: "你想来白嫖，门都没有。" },
      { speakerZh: "曹三", textZh: "你们这两个孽障，今天送你们去见阎王。" },
    ]);
  });

  it("对白戏：建立 → 过肩 A→B → 关键句干净特写 → 反应；左右关系固定；连续覆盖 0–D；≤ maxCuts", () => {
    const s = scheduleManhuaSegmentShots({ durationSec: 15, dialogueZh: seg02, tempoTier: "neutral" });
    expect(s.layoutZh).toContain("阿菁在画左、曹三在画右");
    expect(s.shots[0]!.kind).toBe("establish");
    expect(s.shots[0]!.startSec).toBe(0);
    for (let i = 1; i < s.shots.length; i += 1) expect(s.shots[i]!.startSec).toBeCloseTo(s.shots[i - 1]!.endSec, 6);
    expect(s.shots[s.shots.length - 1]!.endSec).toBe(15);
    // 关键句是第 0 句（两个感叹号）→ 阿菁那一镜是干净单人特写（不带前景肩）；曹三两句合成一镜、过阿菁肩、景别推近
    expect(s.keyLineIndex).toBe(0);
    expect(s.shots[1]).toMatchObject({ kind: "single", faceZh: "阿菁", scale: "cu", lineIndex: 0 });
    const caoGroup = s.shots.find((x) => x.kind === "ots" && x.faceZh === "曹三");
    expect(caoGroup?.overZh).toBe("阿菁");
    expect(["mcu", "cu"]).toContain(caoGroup?.scale);
    expect(s.shots[2]).toMatchObject({ kind: "reaction", faceZh: "曹三" });
    expect(s.shots.length).toBeLessThanOrEqual(6);
    const zh = formatManhuaShotScheduleZh(s);
    expect(zh).toContain("过阿菁肩看曹三");
    expect(zh).not.toContain("过肩镜头");
  });

  it("快档更碎、慢档更长；段太短时先砍反应再砍建立，台词镜保底", () => {
    const fast = scheduleManhuaSegmentShots({ durationSec: 15, dialogueZh: seg02, tempoTier: "fast" });
    const slow = scheduleManhuaSegmentShots({ durationSec: 15, dialogueZh: seg02, tempoTier: "slow" });
    expect(fast.shots[0]!.endSec).toBeLessThan(slow.shots[0]!.endSec);
    const tight = scheduleManhuaSegmentShots({ durationSec: 4, dialogueZh: seg02, tempoTier: "slow" });
    expect(tight.shots.some((x) => x.kind === "reaction")).toBe(false);
    expect(tight.shots.filter((x) => x.kind !== "establish").length).toBeGreaterThanOrEqual(2);
    expect(tight.shots[tight.shots.length - 1]!.endSec).toBe(4);
  });

  it("混合段：末镜不补到段尾，留给动作文法；无对白无接触只出建立镜；无对白有接触出空表", () => {
    const mixed = scheduleManhuaSegmentShots({ durationSec: 15, dialogueZh: seg02, hasContact: true });
    expect(mixed.shots[mixed.shots.length - 1]!.endSec).toBeLessThan(15);
    expect(mixed.notesZh.join("")).toContain("起手过肩");
    expect(scheduleManhuaSegmentShots({ durationSec: 10 }).shots).toMatchObject([{ kind: "establish", startSec: 0, endSec: 10 }]);
    expect(scheduleManhuaSegmentShots({ durationSec: 10, hasContact: true }).shots).toEqual([]);
  });

  it("第三人不参与过肩轴线：只出单人镜；切数超上限时相邻台词镜合并，最终 ≤ maxCuts 且仍连续覆盖", () => {
    const three = scheduleManhuaSegmentShots({ durationSec: 15, dialogueZh: "阿菁：「你来了？」\n曹三：「我来了。」\n先生：「都别吵！」\n阿菁：「哼。」" });
    const xian = three.shots.find((x) => x.faceZh === "先生")!;
    expect(xian.kind).toBe("single");
    expect(three.shots.every((x) => x.overZh !== "先生")).toBe(true);
    expect(three.layoutZh).toContain("先生不参与过肩轴线");
    const many = Array.from({ length: 10 }, (_, i) => `${i % 2 ? "曹三" : "阿菁"}：「第${i}句话。」`).join("\n");
    const s = scheduleManhuaSegmentShots({ durationSec: 15, dialogueZh: many, tempoTier: "neutral" });
    expect(s.shots.length).toBeLessThanOrEqual(6);
    expect(s.shots[0]!.startSec).toBe(0);
    for (let i = 1; i < s.shots.length; i += 1) expect(s.shots[i]!.startSec).toBeCloseTo(s.shots[i - 1]!.endSec, 6);
    expect(s.shots[s.shots.length - 1]!.endSec).toBe(15);
    expect(s.shots.some((x) => /含下一句/.test(x.noteZh))).toBe(true);
  });

  it("单人独白：单人镜景别递进，无过肩无反应", () => {
    const s = scheduleManhuaSegmentShots({ durationSec: 12, dialogueZh: "先生：「药只能压三天。」\n先生：「要根治，得灵兽一点精血。」\n先生：「一碗就够，不伤性命。」" });
    expect(s.shots.every((x) => x.kind !== "ots" && x.kind !== "reaction")).toBe(true);
    expect(s.shots.some((x) => x.kind === "single")).toBe(true);
  });

  it("镜表 → 白模相机：过肩机位在「过谁肩」那人的身后、看对方脸；建立镜全景；反应镜 55mm；非人角色看头", () => {
    const s = scheduleManhuaSegmentShots({ durationSec: 15, dialogueZh: seg02, nonHumanNames: ["墨屠"] });
    const cams = scheduledShotsToPrevisCameras(s.shots, { 阿菁: [-1.25, 0], 曹三: [1.25, 0] });
    expect(cams.length).toBe(s.shots.length);
    const otsShot = s.shots.find((x) => x.kind === "ots")!;
    const ots = cams[s.shots.indexOf(otsShot)]!;
    // 过阿菁肩看曹三：机位在阿菁身后（x < -1.25），目标在曹三头部
    expect(otsShot).toMatchObject({ faceZh: "曹三", overZh: "阿菁" });
    expect(ots.position[0]).toBeLessThan(-1.25);
    expect(ots.target[0]).toBeCloseTo(1.25, 1);
    expect(ots.target[2]).toBeCloseTo(1.45, 1);
    expect(cams[0]!.lens).toBe(28);
    expect(cams.find((c) => c.kind === "reaction")!.lens).toBe(55);
    for (const c of cams) {
      expect(c.lens).toBeGreaterThanOrEqual(18);
      expect(c.lens).toBeLessThanOrEqual(65);
      expect(c.position).not.toEqual(c.target);
    }
    const horse = scheduleManhuaSegmentShots({ durationSec: 10, dialogueZh: "阿菁：「你到底还瞒了我多少秘密？」\n墨屠：「好痛好痛，等等告诉你还不行吗？」", nonHumanNames: ["墨屠"] });
    const hc = scheduledShotsToPrevisCameras(horse.shots, { 阿菁: [0, 0], 墨屠: [2, 0] }, { nonHumanNames: ["墨屠"] });
    const seeHorse = hc.find((c) => c.kind === "ots" && /看墨屠/.test(c.noteZh))!;
    expect(seeHorse.target[2]).toBeCloseTo(1.2, 1);
  });
});

// Codex 终审：同一轴侧、关键句反应与合镜对白覆盖。
describe("终审回归", () => {
  it.each([[[0, 0], [2, 0]], [[0, 0], [0, 2]], [[-1, -1], [2, 3]]] as Array<[[number, number], [number, number]]>)("正反打不越轴 %j %j", (a, b) => {
    const schedule = scheduleManhuaSegmentShots({ durationSec: 30, lines: Array.from({ length: 6 }, (_, i) => ({ speakerZh: i % 2 ? "乙乙" : "甲甲", textZh: `台词${i}` })), keyLineIndex: 3 });
    const cameras = scheduledShotsToPrevisCameras(schedule.shots, { 甲甲: a, 乙乙: b });
    const distances = cameras.map((c) => (b[0]-a[0])*(c.position[1]-a[1])-(b[1]-a[1])*(c.position[0]-a[0]));
    expect(distances.every((v) => v > 0) || distances.every((v) => v < 0)).toBe(true);
  });
  it.each([0, 4, 9])("关键句%d后立即反应，合镜保留全部对白", (keyLineIndex) => {
    const s = scheduleManhuaSegmentShots({ durationSec: 30, tempoTier: "fast", keyLineIndex, lines: Array.from({ length: 10 }, (_, i) => ({ speakerZh: i % 2 ? "乙乙" : "甲甲", textZh: `台词${i}` })) });
    expect(s.shots.length).toBeLessThanOrEqual(8);
    expect(s.shots.flatMap((x) => x.lineIndices || [])).toEqual(Array.from({ length: 10 }, (_, i) => i));
    const key = s.shots.findIndex((x) => x.lineIndices?.includes(keyLineIndex));
    expect(s.shots[key + 1]?.kind).toBe("reaction");
    for (let i = 1; i < s.shots.length; i++) expect(s.shots[i]!.startSec).toBe(s.shots[i-1]!.endSec);
    expect(s.shots.at(-1)!.endSec).toBe(30);
  });
  it("缺人物站位不给舞台中心假坐标", () => {
    const s = scheduleManhuaSegmentShots({ durationSec: 15, dialogueZh: seg02 });
    expect(scheduledShotsToPrevisCameras(s.shots, { 阿菁: [0, 0] })).toEqual([]);
  });
});

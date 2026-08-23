import { describe, expect, it } from "vitest";
import {
  BGM_DURATION_MAX_SEC,
  BGM_DURATION_MIN_SEC,
  BGM_STYLE_MAX_CHARS,
  buildManhuaBgmBrief,
  clampBgmDurationSec,
} from "./manhuaBgmBrief";

describe("BGM brief 编译器", () => {
  it("永远按 custom_mode=true 组织 —— simple mode 下这些字段全部不生效", () => {
    const b = buildManhuaBgmBrief({ laneZh: "爽文逆袭", moods: ["冲突"], durationSec: 30 });
    expect(b.model).toBe("suno-v5.5-beta");
    expect(b.custom_mode).toBe(true);
    expect(b.instrumental).toBe(true);
  });

  it("题材查表决定器乐底色，不问模型", () => {
    expect(buildManhuaBgmBrief({ laneZh: "古言种田", moods: ["蓄力"], durationSec: 30 }).style)
      .toContain("guzheng");
    expect(buildManhuaBgmBrief({ laneZh: "游戏竞技", moods: ["冲突"], durationSec: 30 }).style)
      .toContain("electronic rock");
  });

  it("未知题材回落到通用电影配乐，不抛错", () => {
    const b = buildManhuaBgmBrief({ laneZh: "没这个赛道", moods: ["蓄力"], durationSec: 30 });
    expect(b.style).toContain("cinematic orchestral");
  });

  it("段情绪按顺序拼进 style，描述曲式走向", () => {
    const b = buildManhuaBgmBrief({
      laneZh: "悬疑权谋",
      moods: ["蓄力", "冲突", "收束"],
      durationSec: 60,
    });
    expect(b.style).toContain("slow build");
    expect(b.style).toContain("driving rhythm");
    expect(b.style).toContain("resolving");
  });

  it("纯音乐两道保险：instrumental=true ＋ negative_tags 排人声", () => {
    const b = buildManhuaBgmBrief({ laneZh: "甜宠", moods: ["收束"], durationSec: 20 });
    expect(b.instrumental).toBe(true);
    expect(b.negative_tags).toContain("vocals");
    expect(b.style).toContain("no vocals");
  });

  it("标题中性，不带外部剧名", () => {
    const b = buildManhuaBgmBrief({ laneZh: "爽文逆袭", moods: ["冲突"], durationSec: 30 });
    expect(b.title).toBe("爽文逆袭·配乐");
  });

  it("style 不超过 1000 字符上限", () => {
    const b = buildManhuaBgmBrief({
      laneZh: "爽文逆袭",
      moods: ["蓄力", "冲突", "反转", "收束"],
      durationSec: 30,
      ambienceEn: "x".repeat(2000),
    });
    expect(b.style.length).toBeLessThanOrEqual(BGM_STYLE_MAX_CHARS);
  });
});

describe("时长夹取", () => {
  it("低于下限补到 10 —— 越界会被上游判参数错误，异步任务要轮询才知道失败", () => {
    expect(clampBgmDurationSec(3)).toBe(BGM_DURATION_MIN_SEC);
    expect(clampBgmDurationSec(0)).toBe(BGM_DURATION_MIN_SEC);
    expect(clampBgmDurationSec(-5)).toBe(BGM_DURATION_MIN_SEC);
  });

  it("高于上限截到 360", () => {
    expect(clampBgmDurationSec(999)).toBe(BGM_DURATION_MAX_SEC);
  });

  it("小数取整（上游只收整数）", () => {
    expect(clampBgmDurationSec(30.6)).toBe(31);
  });

  it("NaN 回落下限，不产出非法值", () => {
    expect(clampBgmDurationSec(Number.NaN)).toBe(BGM_DURATION_MIN_SEC);
  });

  it("brief 里的 duration 一定是合法整数", () => {
    const b = buildManhuaBgmBrief({ laneZh: "甜宠", moods: ["收束"], durationSec: 1e9 });
    expect(Number.isInteger(b.duration)).toBe(true);
    expect(b.duration).toBe(BGM_DURATION_MAX_SEC);
  });
});

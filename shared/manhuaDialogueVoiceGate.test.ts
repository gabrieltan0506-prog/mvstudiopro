import { describe, expect, it } from "vitest";
import {
  MANHUA_VOICE_MIN_SEC,
  checkManhuaDialogueVoice,
} from "./manhuaDialogueVoiceGate";

describe("对白有效人声门禁", () => {
  it("2.5 秒以下拒绝 —— 1.75 秒的音频不允许进 Seedance", () => {
    const v = checkManhuaDialogueVoice({ totalSec: 1.8, voicedSec: 1.75 });
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.reasonZh).toContain("低于 2.5s");
  });

  it("拒绝时必须给出下一步做什么，不把判断推回给用户", () => {
    const v = checkManhuaDialogueVoice({ totalSec: 1.8, voicedSec: 1.75 });
    expect(v.ok === false && v.actionZh).toContain("不得补静音");
  });

  it("垫静音骗不过：人声过了 2.5s 但容器明显更长，判为疑似补静音", () => {
    // 1.9s 那种会先被 2.5s 下限拦掉；这一条管的是「刚过线又被拉长」的情形
    const v = checkManhuaDialogueVoice({ totalSec: 4.0, voicedSec: 2.6 });
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.reasonZh).toContain("补了静音");
    expect(v.ok === false && v.actionZh).toContain("不算达标");
  });

  it("人声不足时下限判据先生效，理由说的是「短」不是「垫」", () => {
    const v = checkManhuaDialogueVoice({ totalSec: 3.2, voicedSec: 1.9 });
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.reasonZh).toContain("低于 2.5s");
  });

  it("刚好 2.5 秒放行（下限是「不得短于」）", () => {
    expect(checkManhuaDialogueVoice({ totalSec: 2.6, voicedSec: MANHUA_VOICE_MIN_SEC }).ok).toBe(
      true,
    );
  });

  it("建议区间内不带告警", () => {
    const v = checkManhuaDialogueVoice({ totalSec: 3.3, voicedSec: 3.1 });
    expect(v).toEqual({ ok: true });
  });

  it("区间外只提示不拦 —— 硬闸只有 2.5s 那一道", () => {
    const v = checkManhuaDialogueVoice({ totalSec: 5.2, voicedSec: 5.0 });
    expect(v.ok).toBe(true);
    expect(v.ok === true && v.warnZh).toContain("建议区间");
  });

  it("超过参考音频 30 秒上限拒绝，且不许用 atrim 硬切表演", () => {
    const v = checkManhuaDialogueVoice({ totalSec: 31, voicedSec: 30.5 });
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.actionZh).toContain("拆句分段");
  });

  it("拿总时长冒充人声时长会被识破", () => {
    const v = checkManhuaDialogueVoice({ totalSec: 3, voicedSec: 4 });
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.reasonZh).toContain("超过总时长");
  });

  it("测量无效时不放行", () => {
    expect(checkManhuaDialogueVoice({ totalSec: Number.NaN, voicedSec: 3 }).ok).toBe(false);
    expect(checkManhuaDialogueVoice({ totalSec: 3, voicedSec: -1 }).ok).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  PLATFORM_COVER_ACCENTS,
  PLATFORM_COVER_SHELLS,
  composePlatformCoverShellDirective,
  pickPlatformCoverShell,
} from "./platformCoverShellPicker";

describe("pickPlatformCoverShell", () => {
  it("同一条选题永远得到同一套版式（用户重出不会觉得系统在抽奖）", () => {
    const a = pickPlatformCoverShell({ topicHook: "我每天吃十碗饭，反而瘦了" });
    const b = pickPlatformCoverShell({ topicHook: "我每天吃十碗饭，反而瘦了" });
    expect(a.shell.id).toBe(b.shell.id);
    expect(a.accent).toBe(b.accent);
    expect(a.typoMoves).toEqual(b.typoMoves);
  });

  it("不同选题会换壳，不是所有封面都长一样", () => {
    const ids = new Set(
      [
        "我每天吃十碗饭，反而瘦了",
        "带娃出门必备清单",
        "一个人搬家那晚我哭了",
        "什么是复利",
        "三年存下第一桶金",
        "被问爆的通勤穿搭",
      ].map((t) => pickPlatformCoverShell({ topicHook: t }).shell.id),
    );
    expect(ids.size).toBeGreaterThan(2);
  });

  it("清单向配清单壳，抒情向不会撞上大数字压屏", () => {
    expect(pickPlatformCoverShell({ topicHook: "带娃出门必备清单 8 件" }).shell.vibe).toBe("list");
    expect(pickPlatformCoverShell({ topicHook: "一个人搬家那晚我想哭" }).shell.vibe).toBe("emotion");
  });

  it("强调色只给一个，手法最多两个", () => {
    for (const topic of ["A", "反而瘦了", "必备清单", "温柔陪伴", "复利是什么"]) {
      const pick = pickPlatformCoverShell({ topicHook: topic });
      expect(PLATFORM_COVER_ACCENTS).toContain(pick.accent);
      expect(pick.typoMoves.length).toBeGreaterThanOrEqual(1);
      expect(pick.typoMoves.length).toBeLessThanOrEqual(2);
      expect(new Set(pick.typoMoves).size).toBe(pick.typoMoves.length);
    }
  });

  it("每个壳都有可执行的画面描述，不是形容词", () => {
    for (const shell of PLATFORM_COVER_SHELLS) {
      expect(shell.directive.length).toBeGreaterThan(12);
    }
  });

  it("拼出来的指令写清了「就用这一种」", () => {
    const text = composePlatformCoverShellDirective(
      pickPlatformCoverShell({ topicHook: "反而瘦了十斤" }),
    );
    expect(text).toContain("这张就用这一种");
    expect(text).toContain("只用这一个");
  });
});

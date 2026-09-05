import { describe, expect, it } from "vitest";
import {
  extractManhuaClipUserSupplement,
  mergeManhuaDerivedClipPrompt,
  stripManhuaClipUserSupplement,
  upsertManhuaClipUserSupplement,
} from "./manhuaClipUserSupplement";

describe("manhuaClipUserSupplement", () => {
  it("keeps only the user supplement when derived content is rebuilt", () => {
    const old = upsertManhuaClipUserSupplement("旧秒轴\n旧台词", "动作再克制一点");
    const next = mergeManhuaDerivedClipPrompt("新秒轴\n新台词", old);
    expect(next).toContain("新秒轴");
    expect(next).not.toContain("旧秒轴");
    expect(next).toContain("动作再克制一点");
    expect(extractManhuaClipUserSupplement(next)).toBe("动作再克制一点");
  });

  it("clears supplement without damaging the derived prompt", () => {
    const withExtra = upsertManhuaClipUserSupplement("系统主体", "补充");
    expect(stripManhuaClipUserSupplement(withExtra)).toBe("系统主体");
    expect(upsertManhuaClipUserSupplement(withExtra, "")).toBe("系统主体");
  });
});

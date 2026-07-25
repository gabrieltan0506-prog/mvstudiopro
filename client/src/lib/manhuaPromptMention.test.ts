import { describe, expect, it } from "vitest";
import { readMentionQuery } from "./manhuaPromptMention";

describe("readMentionQuery", () => {
  it("刚敲下 @ 时开面板，筛选词为空", () => {
    expect(readMentionQuery("沈照野推开门 @", 8)).toEqual({ at: 7, query: "" });
  });

  it("@ 后继续输入时带上筛选词", () => {
    expect(readMentionQuery("@角色", 3)).toEqual({ at: 0, query: "角色" });
  });

  it("遇到空格或换行就退出 @ 语境，避免整段文字都在弹面板", () => {
    expect(readMentionQuery("@角色1 抬手", 7)).toBeNull();
    expect(readMentionQuery("@角色1\n下一行", 8)).toBeNull();
  });

  it("普通文字不误触发", () => {
    expect(readMentionQuery("他抬起头", 4)).toBeNull();
  });
});

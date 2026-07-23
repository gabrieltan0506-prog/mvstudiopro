import { describe, expect, it } from "vitest";
import {
  formatManhuaFactoryUserError,
  manhuaFactoryStageLabelFromBlockId,
} from "./manhuaFactoryUserErrors";

describe("manhuaFactoryUserErrors", () => {
  it("maps zod too_big sourceText to plain Chinese", () => {
    const raw =
      'bible · [ { "origin": "string", "code": "too_big", "maximum": 12000, "path": [ "sourceText" ], "message": "Too big" } ]';
    expect(formatManhuaFactoryUserError(raw)).toMatch(/文案过长|缩短/);
  });

  it("maps keyart pad errors", () => {
    expect(
      formatManhuaFactoryUserError("关键静帧须走人物库垫图 + 改图；请先从人物库锁定角色"),
    ).toMatch(/参考底图|定妆/);
  });

  it("maps keyart edit failure with download reason", () => {
    expect(
      formatManhuaFactoryUserError("关键静帧改图失败：OpenAI ref download HTTP 403"),
    ).toMatch(/下载失败|预览/);
  });

  it("maps keyart prompt-too-long OpenAI 400", () => {
    expect(
      formatManhuaFactoryUserError(
        "关键静帧改图失败：OpenAI edits HTTP 400: Invalid 'prompt': string too long. Expected a string with maximum length 32000",
      ),
    ).toMatch(/过长|缩短|压缩/);
  });

  it("does not pretend every keyart failure is pad-access", () => {
    const out = formatManhuaFactoryUserError("关键静帧改图失败：出图繁忙请稍后");
    expect(out).toMatch(/繁忙|失败/);
    expect(out).not.toMatch(/一律|必须垫图不可访问/);
  });

  it("labels stages from block ids", () => {
    expect(manhuaFactoryStageLabelFromBlockId("bible-e01-x")).toBe("设定圣经");
    expect(manhuaFactoryStageLabelFromBlockId("keyart-e01-s01")).toBe("关键静帧");
  });
});

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

  it("labels stages from block ids", () => {
    expect(manhuaFactoryStageLabelFromBlockId("bible-e01-x")).toBe("设定圣经");
    expect(manhuaFactoryStageLabelFromBlockId("keyart-e01-s01")).toBe("关键静帧");
  });
});

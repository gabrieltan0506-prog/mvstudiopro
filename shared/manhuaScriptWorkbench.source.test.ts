import { describe, expect, it } from "vitest";
import {
  defaultWorkbenchShots,
  parseWorkbenchShotsFromText,
  parseWorkbenchShotsFromTextResult,
} from "./manhuaScriptWorkbench";

describe("真实逐镜解析来源标识", () => {
  it.each([undefined, null, "", " \n "])(
    "空稿 %s 保留原默认骨架并标占位",
    raw => {
      const result = parseWorkbenchShotsFromTextResult(raw);
      expect(result.isFallback).toBe(true);
      expect(result.shots).toEqual(defaultWorkbenchShots());
      expect(result.shots).toHaveLength(18);
      expect(result.shots[0]).toMatchObject({
        index: 1,
        durationSec: 0,
        actionZh: "落实本镜人物站位与动作",
      });
      expect(parseWorkbenchShotsFromText(raw)).toEqual(result.shots);
    }
  );

  it.each(["1. 阿菁牵住墨屠", "1. A\n2. B"])(
    "不足两条真实行不把编号当解析成功：%s",
    raw => {
      const result = parseWorkbenchShotsFromTextResult(raw);
      expect(result.isFallback).toBe(true);
      expect(result.shots).toEqual(defaultWorkbenchShots(raw.slice(0, 180)));
      expect(result.shots[0]?.actionZh).toBe(`开场交代：${raw}`);
      expect(parseWorkbenchShotsFromText(raw)).toEqual(result.shots);
    }
  );

  it("真实逐镜保留排序、动作与零占位秒，不注入默认骨架", () => {
    const raw = "2. 墨屠护住阿菁\n1. 阿菁牵住墨屠";
    const result = parseWorkbenchShotsFromTextResult(raw);
    expect(result.isFallback).toBe(false);
    expect(result.shots).toHaveLength(2);
    expect(
      result.shots.map(({ index, durationSec, actionZh }) => ({
        index,
        durationSec,
        actionZh,
      }))
    ).toEqual([
      { index: 1, durationSec: 0, actionZh: "阿菁牵住墨屠" },
      { index: 2, durationSec: 0, actionZh: "墨屠护住阿菁" },
    ]);
    expect(result.shots.every(shot => shot.dialogueZh === undefined)).toBe(
      true
    );
    expect(parseWorkbenchShotsFromText(raw)).toEqual(result.shots);
  });
});

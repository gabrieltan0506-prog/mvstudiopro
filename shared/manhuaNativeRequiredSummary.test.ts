import { describe, expect, it } from "vitest";
import {
  assertNativeRequiredSummary,
  restoreNativeRequiredSummary,
} from "./manhuaNativeRequiredSummary";

const complete = {
  reusableZh: "反应镜延迟揭示威胁",
  genPromptHintZh: "门框压缩人物活动空间",
};

describe("学习必交两栏", () => {
  for (const key of ["reusableZh", "genPromptHintZh"] as const) {
    for (const value of [
      undefined,
      null,
      "",
      " \n\t ",
      12,
      {},
      "本集未整理出该项",
    ]) {
      it(`${key} 拒绝 ${JSON.stringify(value)}`, () => {
        expect(() =>
          assertNativeRequiredSummary({ ...complete, [key]: value })
        ).toThrow("必须有非空内容");
      });
    }
  }
  it("整形漏栏从全部同源分片恢复，保留原稿和已有整形文字", () => {
    const sources = [
      complete,
      {
        ...complete,
        reusableZh: "以空镜收住冲突",
        genPromptHintZh: "远景背向离场",
      },
    ];
    const target = { genPromptHintZh: "已整理的整集画面要素", shots: [1, 2] };
    const result = restoreNativeRequiredSummary(target, sources);
    expect(result).toEqual({
      ...target,
      reusableZh: "【第1段】反应镜延迟揭示威胁\n【第2段】以空镜收住冲突",
    });
    expect(target).not.toHaveProperty("reusableZh");
    expect(sources[0]).toEqual(complete);
  });
  it("部分来源缺栏时不能拿前半集冒充完整恢复", () => {
    expect(() =>
      restoreNativeRequiredSummary({}, [complete, { reusableZh: "后段手法" }])
    ).toThrow("剧情要素");
    expect(() => restoreNativeRequiredSummary({}, [])).toThrow(
      "必须有非空内容"
    );
  });
});

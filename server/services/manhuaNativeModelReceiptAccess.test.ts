import { describe, expect, it } from "vitest";
import { shapeManhuaJobOutputForViewer } from "./manhuaNativeModelReceiptAccess";

describe("原生精读逐次回执 owner-only 输出边界", () => {
  const output = {
    seriesKey: "series-a",
    nativeModelReceipts: [{ callId: "call-1", status: "failed" }],
    nativeUsage: { inputTokens: 10 },
  };

  it("非 owner 的任意 Job 查询响应都裁掉逐次回执，但保留普通结果", () => {
    expect(shapeManhuaJobOutputForViewer(output, false)).toEqual({
      seriesKey: "series-a",
      nativeUsage: { inputTokens: 10 },
    });
    expect(output).toHaveProperty("nativeModelReceipts");
  });

  it("owner 保留完整回执，空值与非对象输出维持原契约", () => {
    expect(shapeManhuaJobOutputForViewer(output, true)).toEqual(output);
    expect(shapeManhuaJobOutputForViewer(undefined, false)).toBeUndefined();
    expect(shapeManhuaJobOutputForViewer("done", false)).toBe("done");
  });
});

import { describe, expect, it } from "vitest";
import { appendManhuaNativeModelReceipt } from "../../shared/manhuaNativeModelReceipt";
import { parseNativeProviderErrorReceipt } from "./manhuaNativeProviderReceipt";

describe("原生精读供应商错误回执", () => {
  it("保留 HTTP、code、message、request_id 与参数路径", () => {
    const receipt = parseNativeProviderErrorReceipt({
      httpStatus: 400,
      requestId: "header-request-id",
      responseText: JSON.stringify({
        error: {
          code: "invalid_parameter",
          message: "video input is too large",
          request_id: "body-request-id",
          param: "messages[0].content[3]",
          type: "invalid_request_error",
        },
      }),
    });
    expect(receipt).toMatchObject({
      httpStatus: 400,
      code: "invalid_parameter",
      message: "video input is too large",
      requestId: "header-request-id",
      param: "messages[0].content[3]",
      type: "invalid_request_error",
    });
  });

  it("移除凭证值与签名查询参数，但保留错误 JSON 结构", () => {
    const receipt = parseNativeProviderErrorReceipt({
      httpStatus: 403,
      responseText: JSON.stringify({
        error: {
          message: "read https://storage.googleapis.com/bucket/a.mp4?X-Goog-Signature=secret failed",
          api_key: "secret-key",
        },
      }),
    });
    expect(receipt.message).toContain("?[已移除访问参数]");
    expect(receipt.responseBody).toContain("[已移除凭证]");
    expect(receipt.responseBody).not.toContain("X-Goog-Signature");
    expect(receipt.responseBody).not.toContain("secret-key");
  });

  it("同一次外呼用 callId 原位更新，不丢 started 时间", () => {
    const started = appendManhuaNativeModelReceipt([], {
      callId: "call-1",
      model: "qwen3.8-max",
      route: "singapore_token_plan",
      stage: "visual_model",
      status: "started",
      episodeIndexes: [1],
    }, "2026-08-25T00:00:00.000Z");
    const completed = appendManhuaNativeModelReceipt(started, {
      callId: "call-1",
      model: "qwen3.8-max",
      route: "singapore_token_plan",
      stage: "visual_model",
      status: "completed",
      episodeIndexes: [1],
      inputTokens: 10,
    }, "2026-08-25T00:00:03.000Z");
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({
      status: "completed",
      startedAtIso: "2026-08-25T00:00:00.000Z",
      finishedAtIso: "2026-08-25T00:00:03.000Z",
      inputTokens: 10,
    });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 六审第4条/12C:画布出图只入队一次——轮询超时后继续查同一 jobId,
 * 绝不第二次 createJobSameOrigin(那会再打一次付费上游)。
 */
vi.mock("./jobs", () => ({
  createJobSameOrigin: vi.fn(),
  pollJobUntilTerminal: vi.fn(),
}));

import { createJobSameOrigin, pollJobUntilTerminal } from "./jobs";
import { runGptImage2 } from "./canvasRunBlock";

const createMock = vi.mocked(createJobSameOrigin);
const pollMock = vi.mocked(pollJobUntilTerminal);

describe("runGptImage2 · 单次入队契约", () => {
  beforeEach(() => {
    createMock.mockReset();
    pollMock.mockReset();
  });

  it("正常路径:入队一次、轮询一次、返回图片 URL,载荷不含任何计费字段", async () => {
    createMock.mockResolvedValue({ jobId: "job-1" } as never);
    pollMock.mockResolvedValue({
      status: "succeeded",
      output: { imageUrl: "https://gcs/img.png" },
    } as never);
    const url = await runGptImage2("p", "9:16");
    expect(url).toBe("https://gcs/img.png");
    expect(createMock).toHaveBeenCalledTimes(1);
    const params = (createMock.mock.calls[0][0] as unknown as {
      input: { params: Record<string, unknown> };
    }).input.params;
    expect(params.chargeOnServer).toBeUndefined();
    expect(params).not.toHaveProperty("chargeReceiptId");
    expect(params).not.toHaveProperty("retryOfJobId");
  });

  it("轮询超时:继续查询同一 jobId,createJobSameOrigin 只调用一次", async () => {
    createMock.mockResolvedValue({ jobId: "job-1" } as never);
    pollMock
      .mockRejectedValueOnce(new Error("job timed out"))
      .mockResolvedValueOnce({
        status: "succeeded",
        output: { imageUrl: "https://gcs/late.png" },
      } as never);
    const url = await runGptImage2("p", "16:9", { openaiOnly: true });
    expect(url).toBe("https://gcs/late.png");
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(pollMock).toHaveBeenCalledTimes(2);
    expect(pollMock.mock.calls[0][0]).toBe("job-1");
    expect(pollMock.mock.calls[1][0]).toBe("job-1");
  });

  it("非超时错误原样抛出,不做任何续查或重入队", async () => {
    createMock.mockResolvedValue({ jobId: "job-1" } as never);
    pollMock.mockRejectedValueOnce(new Error("内容审核未通过"));
    await expect(runGptImage2("p", "9:16")).rejects.toThrow(/审核/);
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(pollMock).toHaveBeenCalledTimes(1);
  });
});

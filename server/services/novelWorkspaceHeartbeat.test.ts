import { it, expect, vi } from "vitest";
import { readGlmSseStream } from "./sseChatStream";
it("收到真实流字节才调用并等待持久化心跳；旧调用不受影响", async () => {
  const bytes = new TextEncoder().encode(
    'data: {"choices":[{"delta":{"content":"正文"},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
  );
  const stream = () =>
    new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes);
        c.close();
      },
    });
  const heartbeat = vi.fn(async () => {});
  const response = await readGlmSseStream(stream(), undefined, {
    strictCompletion: true,
    onBytes: heartbeat,
  });
  expect(heartbeat).toHaveBeenCalledWith(bytes.length);
  expect(JSON.parse(response).choices[0].message.content).toBe("正文");
  expect(
    await readGlmSseStream(stream(), undefined, { strictCompletion: true })
  ).toBe(response);
  await expect(
    readGlmSseStream(stream(), undefined, {
      strictCompletion: true,
      onBytes: async () => {
        throw new Error("heartbeat not saved");
      },
    })
  ).rejects.toThrow("heartbeat not saved");
});

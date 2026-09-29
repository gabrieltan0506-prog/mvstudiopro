import { afterEach, expect, it, vi } from "vitest";
vi.mock("./flyHealthGate", () => ({ withFlyHealthGate: (_: unknown, fn: () => unknown) => fn() }));
vi.mock("./longJobsFlyOrigin", () => ({ withLongJobsFlyDirect: (p: string) => `https://api.test.invalid${p}`, flyHealthProbeOriginForUrl: () => "https://api.test.invalid" }));
import { partialJsonString, readableAdvisorStream, streamManhuaAdvisor } from "./manhuaAdvisorStream";
afterEach(() => vi.unstubAllGlobals());
it("未闭合转义与嵌套调度摘要可逐步显示", () => {
  expect(partialJsonString('{"answer":"第一行\\n下一句\\u4', "answer")).toBe("第一行\n下一句");
  const raw = JSON.stringify({ answer: JSON.stringify({ summaryZh: "下沉后切近景", cameras: [] }) });
  expect(readableAdvisorStream(raw, true)).toBe("下沉后切近景");
  expect(readableAdvisorStream('{"answer":{"summaryZh":"曹三逼近时短推', true)).toBe("曹三逼近时短推");
  expect(readableAdvisorStream('{"answer":{"summaryZh":"下沉后切近景","cameras":[', true)).toBe("下沉后切近景");
});
it("流到 UI 早于最终回执；仅结果事件可成功，原请求与付费授权保留", async () => {
  let ctrl!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start(c) { ctrl = c; } });
  const fetchMock = vi.fn().mockResolvedValue(new Response(stream, { headers: { "content-type": "text/event-stream" } }));
  vi.stubGlobal("fetch", fetchMock);
  const input = { requestId: "same-id", question: "推近", manhuaContext: {}, confirmPaid: true, confirmedCredits: 8 } as any;
  const texts: string[] = []; let finished = false;
  const call = streamManhuaAdvisor(input, d => texts.push(d)).then(r => { finished = true; return r; });
  const send = (event: string, data: unknown) => ctrl.enqueue(new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
  send("reset", {}); send("delta", { text: '{"answer":"推近' });
  await vi.waitFor(() => expect(texts).toContain("推近")); expect(finished).toBe(false);
  send("reset", {}); send("delta", { text: '{"answer":"下沉"}' });
  send("result", { answer: "下沉", remainingFreeToday: 2, paidUnitCredits: 8 }); ctrl.close();
  expect((await call).answer).toBe("下沉");
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(input);
  expect(fetchMock.mock.calls[0][1].credentials).toBe("include");
});
it.each(["eof", "payment"])("%s 不采信增量为成功且不自动重试", async kind => {
  const text = kind === "payment" ? 'event: error\ndata: {"message":"PAYMENT_REQUIRED 扣除8积分"}\n\n' : 'event: delta\ndata: {"text":"半截"}\n\n';
  const fetchMock = vi.fn().mockResolvedValue(new Response(text, { headers: { "content-type": "text/event-stream" } })); vi.stubGlobal("fetch", fetchMock);
  await expect(streamManhuaAdvisor({ manhuaContext: {} } as any, () => {})).rejects.toThrow(kind === "payment" ? /PAYMENT_REQUIRED/ : /连接中断/);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

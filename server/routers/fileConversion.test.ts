import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
const mocks = vi.hoisted(() => ({ get: vi.fn(), enqueue: vi.fn(), cancel: vi.fn(), stat: vi.fn(), read: vi.fn(), sign: vi.fn(), upload: vi.fn(), ticket: vi.fn(), checked: vi.fn(), credits: vi.fn() }));
vi.mock("../jobs/fileConversionRepository", () => ({ getConversionJob: mocks.get, enqueueConversionJob: mocks.enqueue, cancelConversionJob: mocks.cancel, conversionAhead: async () => 0, listConversionJobs: async () => [], freeConversionQuota: async () => ({ remaining: 3 }) }));
vi.mock("../services/fileConversionStorage", () => ({ readConversionSource: mocks.read }));
vi.mock("../jobs/fileConversionUploads", () => ({ createConversionUpload: mocks.upload, conversionUploadByObject: mocks.ticket, markConversionUploadChecked: mocks.checked }));
vi.mock("../services/fileConversionIp", () => ({ conversionDay: () => "2026-10-09", fileConversionIpHash: () => "c".repeat(64) }));
vi.mock("../jobs/workerRole", () => ({ heavyWorkerSplitEnabled: () => true }));
vi.mock("../credits", () => ({ getCredits: mocks.credits }));
import { fileConversionRouter } from "./fileConversion";
import { FILE_CONVERSION_PRICING } from "../../shared/fileConversion";
const caller = (id: number | null = 7) => fileConversionRouter.createCaller({ user: id ? { id, role: "user" } : null } as TrpcContext);
const id = `conv_${"a".repeat(59)}`;
const source = { objectName: "file-conversion/u7/sources/fixture", generation: "123", sha256: "b".repeat(64), bytes: 12, fileName: "test.pdf" };
const request = { kind: "file_conversion", phase: "inspect", formatId: "pdf-docx", source, lane: "free", day: "2026-10-09", ipHash: "c".repeat(64) };
const row = () => ({ id, userId: "7", lane: "free", status: "succeeded", input: request, output: { type: "inspection", source, billing: { needsOcr: false, available: true, credits: 0 } }, error: null, updatedAt: new Date() });
beforeEach(() => { vi.clearAllMocks(); mocks.credits.mockResolvedValue({ totalAvailable: 100 }); mocks.get.mockResolvedValue(row()); mocks.stat.mockResolvedValue({ generation: "123", byteLength: 12 }); mocks.read.mockResolvedValue({ byteLength: 12, sha256: source.sha256 }); mocks.enqueue.mockResolvedValue({ id, status: "queued" }); mocks.ticket.mockResolvedValue({ userId: "7", status: "uploaded", lane: "free", fileName: source.fileName, formatId: "pdf-docx", bytes: source.bytes, source }); });
describe("文件转换受保护入口", () => {
  it("未登录禁止取得上传权限", async () => {
    await expect(caller(null).upload({ fileName: "a.pdf", formatId: "pdf-docx", bytes: 1, lane: "free" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("跨账号读取、转换、停止和下载均拒绝", async () => {
    for (const call of [() => caller(8).status({ id }), () => caller(8).convert({ id, confirmedCredits: 0 }), () => caller(8).cancel({ id }), () => caller(8).download({ id })]) await expect(call()).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.enqueue).not.toHaveBeenCalled(); expect(mocks.cancel).not.toHaveBeenCalled(); expect(mocks.sign).not.toHaveBeenCalled();
  });
  it("检查阶段实字节不符或大于3MB不占名额", async () => {
    const args = { objectName: source.objectName, fileName: source.fileName, bytes: 12, formatId: "pdf-docx", lane: "free" as const };
    mocks.ticket.mockResolvedValue({ userId: "7", status: "uploaded", lane: "free", fileName: source.fileName, formatId: "pdf-docx", bytes: 3_000_001, source });
    await expect(caller().inspect(args)).rejects.toThrow("实际大小");
    await expect(caller().inspect({ ...args, bytes: 3_000_001 })).rejects.toThrow("3 MB");
    expect(mocks.enqueue).not.toHaveBeenCalled(); expect(mocks.read).not.toHaveBeenCalled();
  });
  it("扫描件不误用普通免费报价", async () => {
    mocks.get.mockResolvedValue({ ...row(), output: { ...row().output, billing: { needsOcr: true, available: false, credits: null } } });
    await expect(caller().convert({ id, confirmedCredits: 0 })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it("确认使用检查结果的SHA/实际费用，去掉结算标记并绑定报价版本", async () => {
    mocks.get.mockResolvedValue({ ...row(), input: { ...request, settled: true } });
    await caller().convert({ id, confirmedCredits: 0 });
    expect(mocks.enqueue).toHaveBeenCalledWith("7", { ...request, phase: "convert", quote: { credits: 0, pricingVersion: FILE_CONVERSION_PRICING.version } });
    await expect(caller().convert({ id, confirmedCredits: 1 })).rejects.toThrow("报价");
  });
  it("跨日确认按确认当天预约，不能借旧检查绕过今日额度", async () => {
    mocks.get.mockResolvedValue({ ...row(), input: { ...request, day: "2026-10-08", ipHash: "d".repeat(64) } });
    await caller().convert({ id, confirmedCredits: 0 });
    expect(mocks.enqueue).toHaveBeenCalledWith("7", expect.objectContaining({ day: "2026-10-09", ipHash: "c".repeat(64) }));
  });
  it("检查拒绝跨账号来源；自己文件先实读SHA再原子入队", async () => {
    const args = { objectName: source.objectName, fileName: source.fileName, bytes: source.bytes, formatId: "pdf-docx", lane: "free" as const };
    await expect(caller(8).inspect(args)).rejects.toThrow("归属"); expect(mocks.stat).not.toHaveBeenCalled();
    await caller().inspect(args);
    expect(mocks.read).toHaveBeenCalledWith("7", source, expect.objectContaining({ maxBytes: 3_000_000 }));
    expect(mocks.enqueue).toHaveBeenCalledWith("7", request);
    expect(mocks.checked).toHaveBeenCalledWith(source.objectName, "7");
  });
  it("未批准费率不开放付费上传或检查", async () => {
    const approved = { ...FILE_CONVERSION_PRICING };
    Object.assign(FILE_CONVERSION_PRICING, { standardCredits: null, scanCreditsPerMb: null });
    try {
      await expect(caller().upload({ fileName: "a.pdf", bytes: 12, formatId: "pdf-docx", lane: "paid" })).rejects.toThrow("费率尚未开放");
      expect(mocks.upload).not.toHaveBeenCalled();
    } finally { Object.assign(FILE_CONVERSION_PRICING, approved); }
  });
  it("付费扫描报价确认后仍入付费车道，伪造更低金额拒绝", async () => {
    const paid = { ...request, lane: "paid", source: { ...source, bytes: 20_000_001 } };
    mocks.get.mockResolvedValue({ ...row(), lane: "paid", input: paid,
      output: { type: "inspection", source: paid.source, billing: { needsOcr: true, available: true, credits: 6 } } });
    await expect(caller().convert({ id, confirmedCredits: 4 })).rejects.toThrow("报价");
    expect(mocks.enqueue).not.toHaveBeenCalled();
    await caller().convert({ id, confirmedCredits: 6 });
    expect(mocks.enqueue).toHaveBeenCalledWith("7", expect.objectContaining({ lane: "paid", phase: "convert",
      quote: { credits: 6, pricingVersion: FILE_CONVERSION_PRICING.version } }));
  });
  it("下载不签发他人结果或未完成输出", async () => {
    mocks.get.mockResolvedValue({ ...row(), output: { type: "converted", objectName: "file-conversion/u8/results/stolen/x.pdf" } });
    await expect(caller().download({ id })).rejects.toThrow(); expect(mocks.sign).not.toHaveBeenCalled();
  });
});

it("同一失败终态返回实际failed，不伪报queued", async () => {
  mocks.enqueue.mockResolvedValue({ id, status: "failed" });
  expect(await caller().convert({ id, confirmedCredits: 0 })).toEqual({ id, status: "failed" });
});
it("只签发单次网站上传入口，不暴露可绕过限制的GCS签名URL", async () => {
  mocks.upload.mockResolvedValue({ objectName: source.objectName, uploadUrl: "/api/file-conversion/upload/test-only", requiredHeaders: {} });
  const receipt = await caller().upload({ fileName: source.fileName, bytes: 12, formatId: "pdf-docx", lane: "free" });
  expect(receipt.uploadUrl).toMatch(/^\/api\/file-conversion\/upload\//);
  expect(mocks.upload).toHaveBeenCalledWith(expect.objectContaining({ bytes: 12, userId: "7", ipHash: "c".repeat(64) }));
});

it("免费上传不要求积分；付费余额不足不签发上传授权", async () => {
  mocks.credits.mockResolvedValue({ totalAvailable: 0 });
  await caller().upload({ fileName: source.fileName, bytes: 12, formatId: "pdf-docx", lane: "free" });
  expect(mocks.credits).not.toHaveBeenCalled();
  mocks.upload.mockClear();
  await expect(caller().upload({ fileName: source.fileName, bytes: 12, formatId: "pdf-docx", lane: "paid" })).rejects.toThrow("积分不足");
  expect(mocks.upload).not.toHaveBeenCalled();
});

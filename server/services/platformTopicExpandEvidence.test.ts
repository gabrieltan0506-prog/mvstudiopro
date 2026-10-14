import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createPlatformExpandEvidenceJournal, ExpandEvidencePersistenceError } from "./platformTopicExpandEvidence";
import { omitChineseStagingFromJobOutput } from "./platformImageChineseStaging";

describe("扩写模型回执", () => {
  it("保留上一轮原文，先可靠保存再更新内存；原文和解析对象分别校验", async () => {
    const previous = [{ stage: "raw", value: "上一轮原文" }];
    const persist = vi.fn(async () => {});
    const journal = createPlatformExpandEvidenceJournal(previous, persist);
    const raw = '{"blueprint":{"title":"原始标题"}}';
    const base = { pickId: "pick1", gateway: "原通道", attempt: 1 };
    await journal.record({ ...base, stage: "raw", value: raw });
    await journal.record({ ...base, stage: "parsed", value: JSON.parse(raw) });
    expect(previous).toHaveLength(1);
    expect(journal.entries).toHaveLength(3);
    const entries = journal.entries as Array<Record<string, unknown>>;
    expect(entries[0]).toEqual(previous[0]);
    expect(entries[1].sha256).toBe(createHash("sha256").update(JSON.stringify(raw)).digest("hex"));
    expect(entries[1].bytes).toBe(Buffer.byteLength(JSON.stringify(raw)));
    expect(entries[2].value).toEqual(JSON.parse(raw));
    expect(persist).toHaveBeenCalledTimes(2);
    expect(omitChineseStagingFromJobOutput({ expandAttemptEvidence: entries }).expandAttemptEvidence).toEqual(entries);
  });
  it("保存失败不报成功、不在内存伪造已经保存的记录", async () => {
    const journal = createPlatformExpandEvidenceJournal([], async () => { throw new Error("数据库离线"); });
    await expect(journal.record({ pickId: "p", gateway: "g", attempt: 1, stage: "raw", value: "正文" })).rejects.toBeInstanceOf(ExpandEvidencePersistenceError);
    expect(journal.entries).toEqual([]);
  });
});

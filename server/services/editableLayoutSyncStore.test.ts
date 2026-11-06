import { describe, it, expect, vi } from "vitest";
import { layoutFromSource } from "../../shared/editableLayout";
import { synchronizedKnowledgeCardSource } from "../../shared/knowledgeCardEditableLayout";
import { writeLayoutLibrary } from "./editableLayoutStore";
const document = () => layoutFromSource(synchronizedKnowledgeCardSource({ owner: "7", sourceId: "sync", fullMarkdown: "完整正文", illustrationMarkdown: "配图正文", detailLevel: "full", imageJobIds: ["original"] }));
describe("同步补图映射所有写入路径保护", () => {
  it("首存和新增稿件都不能绕过映射校验", async () => {
    const doc = document(); doc.publication!.imageReplacements = { other: "replacement" };
    const write = vi.fn();
    const deps = { write, read: vi.fn(async () => ({ generation: "1", buffer: Buffer.from(JSON.stringify({ library: { version: 1, owner: "7", documents: [] } })) })) };
    await expect(writeLayoutLibrary(7, { version: 1, owner: "7", documents: [doc] }, "0", deps as any)).rejects.toThrow("未对应原稿");
    await expect(writeLayoutLibrary(7, { version: 1, owner: "7", documents: [doc] }, "1", deps as any)).rejects.toThrow("未对应原稿");
    expect(write).not.toHaveBeenCalled();
  });
  it("省略整个映射字段也不能移除已有绑定", async () => {
    const doc = document(), old = structuredClone(doc);
    old.publication!.imageReplacements = { original: "replacement" };
    const write = vi.fn();
    const deps = { write, read: vi.fn(async () => ({ generation: "1", buffer: Buffer.from(JSON.stringify({ library: { version: 1, owner: "7", documents: [old] } })) })) };
    await expect(writeLayoutLibrary(7, { version: 1, owner: "7", documents: [doc] }, "1", deps as any)).rejects.toThrow("不能覆盖");
    expect(write).not.toHaveBeenCalled();
  });
});

describe("云稿来源身份与当前尝试保护", () => {
  it("原稿指纹不能被新输入覆盖或删除", async () => {
    const old = document(); old.publication!.inputFingerprint = "a".repeat(64);
    const doc = structuredClone(old); doc.publication!.inputFingerprint = "b".repeat(64);
    const write = vi.fn(), deps = { write, read: vi.fn(async () => ({ generation: "1", buffer: Buffer.from(JSON.stringify({ library: { version: 1, owner: "7", documents: [old] } })) })) };
    await expect(writeLayoutLibrary(7, { version: 1, owner: "7", documents: [doc] }, "1", deps as any)).rejects.toThrow("原稿快照不能覆盖");
    delete doc.publication!.inputFingerprint;
    await expect(writeLayoutLibrary(7, { version: 1, owner: "7", documents: [doc] }, "1", deps as any)).rejects.toThrow("原稿快照不能覆盖");
    expect(write).not.toHaveBeenCalled();
  });
  it("恢复后的新保存不能省略在途尝试记录", async () => {
    const doc = document(), old = structuredClone(doc);
    old.publication!.imageAttempts = { original: { requestId: "11111111-1111-4111-8111-111111111111", jobId: "kc_attempt" } };
    const write = vi.fn(), deps = { write, read: vi.fn(async () => ({ generation: "1", buffer: Buffer.from(JSON.stringify({ library: { version: 1, owner: "7", documents: [old] } })) })) };
    await expect(writeLayoutLibrary(7, { version: 1, owner: "7", documents: [doc] }, "1", deps as any)).rejects.toThrow("不能删除");
    expect(write).not.toHaveBeenCalled();
  });
});

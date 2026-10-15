import { describe, expect, it, vi } from "vitest";
import { newDigitalHumanDraft } from "../../shared/digitalHumanStudio";
import { readDigitalHumanCloudDraft, writeDigitalHumanCloudDraft } from "./digitalHumanDraftStore";
const draft = newDigitalHumanDraft("7", "a51d8a78-1c90-4f1d-9c1e-324e7a3f4659");
describe("数字人完整云稿与版本冲突", () => {
  it("不存在仅metadata404返回generation0，网络与正文错误不得当空稿", async () => {
    const deps = {read:vi.fn(async()=>{throw new Error("gcs_stat_failed:404");}),write:vi.fn()} as any;
    expect(await readDigitalHumanCloudDraft(7,deps)).toMatchObject({draft:null,generation:"0"});
    deps.read.mockRejectedValue(new Error("gcs_download_failed:404"));
    await expect(readDigitalHumanCloudDraft(7,deps)).rejects.toThrow("gcs_download_failed");
  });
  it("场景地点、机位与白模失效状态通过真实云稿序列化往返", async () => {
    const next = { ...draft, stageCamera: { kind: "single" as const, position: [3, 2, 1.5] as [number, number, number], target: [3, 4, 1.5] as [number, number, number], lens: 45, labelZh: "单人" },
      stageAnchors: [{ id: "window", labelZh: "窗边", point: [3, 4] as [number, number], worldTaskId: "world-test", sceneSource: "gs://test-only/scene.png" }], previsSpatialInvalidated: true };
    let stored: Buffer;
    const deps = { write: vi.fn(async (input: any) => { stored = input.buffer; return { generation: "12" }; }), read: vi.fn(async () => ({ buffer: stored, generation: "12" })) } as any;
    await writeDigitalHumanCloudDraft(7, next, "11", deps);
    expect((await readDigitalHumanCloudDraft(7, deps)).draft).toEqual(next);
  });
  it("写入绑定owner与generation，旧版本冲突不覆盖", async () => {
    const deps = {read:vi.fn(),write:vi.fn(async()=>({generation:"12"}))} as any;
    expect(await writeDigitalHumanCloudDraft(7,draft,"11",deps)).toMatchObject({generation:"12"});
    expect(deps.write.mock.calls[0][0]).toMatchObject({objectName:"digital-human-drafts/user-7/current.json",ifGenerationMatch:"11"});
    expect(JSON.parse(deps.write.mock.calls[0][0].buffer.toString()).draft).toEqual(draft);
    await expect(writeDigitalHumanCloudDraft(8,draft,"0",deps)).rejects.toThrow("账号");
    deps.write.mockRejectedValue(new Error("gcs_upload_failed:412:{}"));
    await expect(writeDigitalHumanCloudDraft(7,draft,"11",deps)).rejects.toThrow("云端数字人稿件已变化");
  });
});

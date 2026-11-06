import { describe, expect, it, vi } from "vitest";
import { layoutFromSource } from "../../shared/editableLayout";
import { readLayoutLibrary, writeLayoutLibrary } from "./editableLayoutStore";
vi.mock("./postProdMediaSource", () => ({
  loadSucceededJobOutputSources: vi.fn(async () => ({
    objects: new Set(["own.png"]),
    urls: new Set(),
  })),
  resolveRegisteredPostProdMediaSource: vi.fn(
    async (input: any, _deps: any, context: any) => {
      if (
        input.userId !== "7" ||
        !context.jobObjects.has("own.png") ||
        !input.source.includes("/own.png")
      )
        throw new Error("素材尚未登记");
      return "gs://test/own.png";
    }
  ),
}));
const library = {
  version: 1 as const,
  owner: "7",
  documents: [
    layoutFromSource({
      owner: "7",
      sourceId: "original",
      title: "原文",
      body: "完整正文",
      images: { 1: "https://test.invalid/p.png" },
    }),
  ],
};
function storage() {
  const map = new Map<string, { buffer: Buffer; generation: string }>();
  return {
    map,
    deps: {
      write: vi.fn(async (i: any) => {
        const old = map.get(i.objectName);
        if (i.ifGenerationMatch !== (old?.generation || "0"))
          throw new Error("gcs_upload_failed:412:{}");
        const value = {
          buffer: i.buffer,
          generation: String(Number(old?.generation || 0) + 1),
        };
        map.set(i.objectName, value);
        return value;
      }),
      read: vi.fn(async (i: any) => {
        const name = i.gcsUri.match(/editable-layouts\/.*$/)[0];
        const value = map.get(name);
        if (!value) throw new Error("gcs_stat_failed:404");
        return value;
      }),
    } as any,
  };
}
describe("完整稿件云端保存与恢复", () => {
  it("metadata版本被并发保存替换时重读最新稿，不把下载404当作空稿", async () => {
    const { deps } = storage();
    await writeLayoutLibrary(7, library, "0", deps);
    const updated = { ...library, documents: [] };
    await writeLayoutLibrary(7, updated, "1", deps);
    deps.read.mockClear();
    deps.read.mockRejectedValueOnce(new Error("gcs_download_failed:404"));
    expect(await readLayoutLibrary(7, deps)).toMatchObject({ generation: "2", library: updated });
    expect(deps.read).toHaveBeenCalledTimes(2);
    expect(deps.read.mock.calls[0]).toEqual(deps.read.mock.calls[1]);
  });
  it("持续下载404只读三次后失败，不无限重试或返回空稿", async () => {
    const { deps } = storage();
    deps.read.mockRejectedValue(new Error("gcs_download_failed:404"));
    await expect(readLayoutLibrary(7, deps)).rejects.toThrow("gcs_download_failed:404");
    expect(deps.read).toHaveBeenCalledTimes(3);
  });
  it("写前重读发现新版仍拒绝旧generation，不能覆盖并发保存", async () => {
    const { deps } = storage();
    await writeLayoutLibrary(7, library, "0", deps);
    const updated = { ...library, documents: [] };
    await writeLayoutLibrary(7, updated, "1", deps);
    deps.write.mockClear();
    deps.read.mockRejectedValueOnce(new Error("gcs_download_failed:404"));
    await expect(writeLayoutLibrary(7, library, "1", deps)).rejects.toThrow("已变化");
    expect(deps.write).not.toHaveBeenCalled();
    expect((await readLayoutLibrary(7, deps)).library).toEqual(updated);
  });
  it.each(["gcs_download_failed:401", "gcs_download_failed:403", "gcs_download_failed:503"])("%s不能作为版本竞态吞掉", async message => {
    const { deps } = storage();
    deps.read.mockRejectedValue(new Error(message));
    await expect(readLayoutLibrary(7, deps)).rejects.toThrow(message);
    expect(deps.read).toHaveBeenCalledTimes(1);
  });
  it("真实序列化保留内容、配图、版式和所有稿件，按账号隔离", async () => {
    const { deps } = storage();
    expect(await readLayoutLibrary(7, deps)).toMatchObject({
      library: null,
      generation: "0",
    });
    await writeLayoutLibrary(7, library, "0", deps);
    expect((await readLayoutLibrary(7, deps)).library).toEqual(library);
    expect((await readLayoutLibrary(8, deps)).library).toBeNull();
    await expect(writeLayoutLibrary(8, library, "0", deps)).rejects.toThrow(
      "账号"
    );
    expect(deps.write).toHaveBeenCalledTimes(1);
  });
  it("两个会话同时保存仅一份成功，旧版本不能覆盖新稿", async () => {
    const { deps } = storage();
    const results = await Promise.allSettled([
      writeLayoutLibrary(7, library, "0", deps),
      writeLayoutLibrary(7, { ...library, documents: [] }, "0", deps),
    ]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(
      (results.find(r => r.status === "rejected") as PromiseRejectedResult)
        .reason.message
    ).toContain("已变化");
    expect((await readLayoutLibrary(7, deps)).library).toEqual(library);
  });
  it("网络错误、损坏、错账号及写入回执缺失不伪装为空稿或成功", async () => {
    const { deps, map } = storage();
    deps.read.mockRejectedValueOnce(new Error("gcs_download_failed:503"));
    await expect(readLayoutLibrary(7, deps)).rejects.toThrow("503");
    await writeLayoutLibrary(7, library, "0", deps);
    const value = map.get("editable-layouts/user-7/library.json")!;
    value.buffer = Buffer.from(
      JSON.stringify({ format: "editable-layout-v1", owner: 8, library })
    );
    await expect(readLayoutLibrary(7, deps)).rejects.toThrow("身份");
    deps.write.mockResolvedValueOnce({});
    await expect(writeLayoutLibrary(7, library, "1", deps)).rejects.toThrow(
      "回执"
    );
  });
});

it("本人配图保存稳定对象，读取时重签，拒绝未登记素材且不覆盖旧稿", async () => {
  const { deps, map } = storage();
  const owned = {
    ...library,
    documents: [
      {
        ...library.documents[0],
        pages: [
          {
            ...library.documents[0].pages[0],
            imageUrl: "https://storage.googleapis.com/test/own.png?old=1",
          },
        ],
      },
    ],
  };
  const media = {
    normalize: vi.fn(async (owner: number, value: any) => {
      expect(owner).toBe(7);
      value.documents[0].pages[0].imageUrl = "gs://test/own.png";
    }),
    sign: vi.fn(() => "https://storage.googleapis.com/test/own.png?new=1"),
  };
  await writeLayoutLibrary(7, owned, "0", deps, media);
  expect(
    JSON.parse(
      map.get("editable-layouts/user-7/library.json")!.buffer.toString()
    ).library.documents[0].pages[0].imageUrl
  ).toBe("gs://test/own.png");
  expect(
    (await readLayoutLibrary(7, deps, media)).library!.documents[0].pages[0]
      .imageUrl
  ).toContain("?new=1");
  media.normalize.mockRejectedValueOnce(new Error("素材尚未登记"));
  await expect(writeLayoutLibrary(7, owned, "1", deps, media)).rejects.toThrow(
    "素材尚未登记"
  );
  expect(deps.write).toHaveBeenCalledTimes(1);
});

it("实际保存入口先核验本人素材归属，再落稳定对象；未登记不写入", async () => {
  const { deps, map } = storage();
  const doc = structuredClone(library);
  doc.documents[0].pages[0].imageUrl =
    "https://storage.googleapis.com/test/own.png?expired=1";
  await writeLayoutLibrary(7, doc, "0", deps);
  expect(
    JSON.parse(
      map.get("editable-layouts/user-7/library.json")!.buffer.toString()
    ).library.documents[0].pages[0].imageUrl
  ).toBe("gs://test/own.png");
  doc.documents[0].pages[0].imageUrl = "gs://test/someone-else.png";
  await expect(writeLayoutLibrary(7, doc, "1", deps)).rejects.toThrow(
    "素材尚未登记"
  );
  expect(deps.write).toHaveBeenCalledTimes(1);
});

describe("知识稿原始快照保护",()=>{
 it("保存后禁止替换原稿或去掉publication绕过保护",async()=>{
  const {deps}=storage();
  const doc=layoutFromSource({kind:"knowledge-publication",owner:"7",sourceId:"knowledge",title:"原主题",body:"原说明"});
  const lib={version:1 as const,owner:"7",documents:[doc]};
  await writeLayoutLibrary(7,lib,"0",deps);
  const changed=structuredClone(lib);changed.documents[0].publication!.source.pages[0].body="替换原说明";
  await expect(writeLayoutLibrary(7,changed,"1",deps)).rejects.toThrow("原稿快照");
  const stripped=structuredClone(lib);delete stripped.documents[0].publication;
  await expect(writeLayoutLibrary(7,stripped,"1",deps)).rejects.toThrow("原稿快照");
  expect((await readLayoutLibrary(7,deps)).library?.documents[0].publication?.source.pages[0].body).toBe("原说明");
 });
});

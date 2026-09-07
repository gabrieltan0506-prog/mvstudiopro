import { readFileSync } from "node:fs";
import JSZip from "jszip";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildManhuaCloudDraftPayload } from "@shared/manhuaCloudDraft";
import { collectManhuaBackupImageSources } from "./manhuaBackupImageSources";
import {
  __resetManhuaLocalMediaStoreForTests,
  getLocalMediaRecord,
  getLocalMediaRecordBySource,
  importLocalMediaRecords,
  isLocalMediaPointer,
  localMediaPointerId,
  resolveUrlForLocalPersist,
} from "./manhuaLocalMediaStore";

// Node 缺少浏览器 FileReader，只转换 Blob 输入；文件组织及 ZIP 编解码都用真实 JSZip。
class NodeCompatibleZip {
  private readonly zip = new JSZip();
  file(name: string, data: string | Blob) {
    this.zip.file(name, data instanceof Blob ? data.arrayBuffer() : data);
    return this;
  }
  async generateAsync(options: { compression: "STORE" }) {
    const data = await this.zip.generateAsync({
      ...options,
      type: "uint8array",
    });
    return new Blob([new Uint8Array(data)], { type: "application/zip" });
  }
}

function exportCallback(deps: Record<string, unknown>) {
  const source = ts.createSourceFile(
    "OmniCanvas.tsx",
    readFileSync(new URL("../pages/OmniCanvas.tsx", import.meta.url), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  let callbackText = "";
  function visit(node: ts.Node) {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(source) === "exportBackupFile" &&
      node.initializer &&
      ts.isCallExpression(node.initializer)
    )
      callbackText = node.initializer.arguments[0]!.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (!callbackText) throw new Error("找不到真实备份导出回调");
  callbackText = callbackText.replace(
    /import\("jszip"\)/g,
    'loadModule("jszip")'
  );
  const compiled = ts.transpileModule(`const callback = ${callbackText};`, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
    },
  }).outputText;
  return new Function(...Object.keys(deps), `${compiled}\nreturn callback;`)(
    ...Object.values(deps)
  ) as () => Promise<void>;
}

const imageBytes = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jvXkAAAAASUVORK5CYII=",
    "base64"
  )
);
const imageBlob = () => new Blob([imageBytes], { type: "image/png" });
const url = (name: string) => `https://test.invalid/${name}.png`;
type Payload = ReturnType<typeof buildManhuaCloudDraftPayload>;
type ManifestEntry = { file: string; sourceUrl: string; mime: string };

function setup(payload: Payload) {
  let downloaded: Blob | undefined;
  const anchor = { href: "", download: "", click: vi.fn() };
  const toast = { success: vi.fn(), warning: vi.fn(), error: vi.fn() };
  const fetchImage = vi.fn(async (_url: string, _options: unknown) => ({
    ok: false,
    blob: async () => new Blob(),
  }));
  const resolveMaterial = vi.fn(async (_gcsUri: string) => url("renewed"));
  const revoke = vi.fn();
  const validateImage = vi.fn(async (blob: Blob, mime: string) => {
    if (mime && !mime.startsWith("image/")) throw new Error("备份图片格式不对");
  });
  const run = exportCallback({
    latestDraftSnapshotRef: { current: { testSnapshot: true } },
    buildLocalCloudDraftSnapshot: () => payload,
    countDraftPayloadStats: () => ({
      nodes: 0,
      images: collectManhuaBackupImageSources(payload).length,
    }),
    collectManhuaBackupImageSources,
    resolveUrlForLocalPersist,
    isLocalMediaPointer,
    localMediaPointerId,
    getLocalMediaRecord,
    getLocalMediaRecordBySource,
    assertManhuaBackupImage: validateImage,
    assetImageGcsUri: () => undefined,
    resolveCanvasMaterialUrl: resolveMaterial,
    fetch: fetchImage,
    loadModule: async () => ({ default: NodeCompatibleZip }),
    document: { createElement: () => anchor },
    URL: {
      createObjectURL: (blob: Blob) => {
        downloaded = blob;
        return "blob:test-export";
      },
      revokeObjectURL: revoke,
    },
    toast,
  });
  return {
    run,
    toast,
    fetchImage,
    resolveMaterial,
    anchor,
    revoke,
    validateImage,
    async readZip() {
      expect(downloaded?.size).toBeGreaterThan(0);
      return JSZip.loadAsync(await downloaded!.arrayBuffer());
    },
  };
}

async function seedLocal(sourceUrl: string) {
  await importLocalMediaRecords([
    {
      sourceUrl,
      blob: imageBlob(),
      mime: "image/png",
    },
  ]);
}
beforeEach(async () => {
  await __resetManhuaLocalMediaStoreForTests();
});
afterEach(async () => {
  await __resetManhuaLocalMediaStoreForTests();
});

describe("真实备份导出 ZIP 与图片字节", () => {
  it.each(["text/html", "image/png"])(
    "HTTP200的%s错误内容或解码失败不报图片备份成功",
    async mime => {
      const payload = buildManhuaCloudDraftPayload({
        writerSession: {},
        blocks: [],
        edges: [],
        factoryPrefs: {
          customAssetRefs: [{ id: "broken", url: url("broken") }],
        },
      });
      const state = setup(payload);
      state.fetchImage.mockResolvedValueOnce({
        ok: true,
        blob: async () => new Blob(["<html>error</html>"], { type: mime }),
      });
      state.validateImage.mockRejectedValueOnce(new Error("备份图片无法读取"));
      await state.run();
      const zip = await state.readZip();
      expect(
        JSON.parse(await zip.file("assets-manifest.json")!.async("string"))
      ).toEqual([]);
      expect(state.validateImage).toHaveBeenCalledOnce();
      expect(state.toast.warning).toHaveBeenCalledWith(
        expect.stringContaining("图打包 0/1 张;1 张未取得可用图片")
      );
      expect(state.toast.success).not.toHaveBeenCalled();
    }
  );
  it("备份导入后签名刷新，再导出按长期身份取原字节而不重复联网", async () => {
    const original = url("old-board-signature");
    const renewed = url("new-board-signature");
    const gcsUri = "gs://test-bucket/board.png";
    await importLocalMediaRecords([
      { sourceUrl: original, gcsUri, blob: imageBlob(), mime: "image/png" },
    ]);
    await __resetManhuaLocalMediaStoreForTests({ keepRecords: true });
    const payload = buildManhuaCloudDraftPayload({
      writerSession: {},
      blocks: [],
      edges: [],
      factoryPrefs: {
        directorBoardMainByEpisode: { 1: { url: renewed, gcsUri } },
      },
    });
    const state = setup(payload);
    await state.run();
    const zip = await state.readZip();
    const manifest: ManifestEntry[] = JSON.parse(
      await zip.file("assets-manifest.json")!.async("string")
    );
    expect(manifest).toEqual([
      { file: "assets/001.png", sourceUrl: renewed, mime: "image/png" },
    ]);
    expect(await zip.file(manifest[0]!.file)!.async("uint8array")).toEqual(
      imageBytes
    );
    expect(state.fetchImage).not.toHaveBeenCalled();
    expect(state.resolveMaterial).not.toHaveBeenCalled();
    expect(state.toast.success).toHaveBeenCalledOnce();
  });
  it("节点外主图、候选、两级导演板进入真实 ZIP，跨副本去重，刷新映射后仍取本机字节", async () => {
    const refs = ["main", "candidate"].map(name => ({
      id: name,
      role: "character" as const,
      url: url(name),
      labelZh: name,
    }));
    const payload = buildManhuaCloudDraftPayload({
      writerSession: { customAssetRefs: refs },
      blocks: [],
      edges: [],
      factoryPrefs: {
        customAssetRefs: refs,
        directorBoardMainByEpisode: { 1: { url: url("board-main") } },
        directorBoardBySegment: {
          1: {
            1: { url: url("board-segment") },
            2: { url: url("board-main") },
          },
        },
      },
    });
    const expectedSources = [
      "main",
      "candidate",
      "board-main",
      "board-segment",
    ].map(url);
    for (const sourceUrl of expectedSources) await seedLocal(sourceUrl);
    await __resetManhuaLocalMediaStoreForTests({ keepRecords: true });
    const before = JSON.stringify(payload);
    const state = setup(payload);
    await state.run();
    const zip = await state.readZip();
    const manifest: ManifestEntry[] = JSON.parse(
      await zip.file("assets-manifest.json")!.async("string")
    );
    expect(manifest.map(item => item.sourceUrl)).toEqual(expectedSources);
    expect(manifest).toHaveLength(4);
    for (const entry of manifest) {
      expect(entry.mime).toBe("image/png");
      expect(await zip.file(entry.file)!.async("uint8array")).toEqual(
        imageBytes
      );
    }
    expect(
      Object.keys(zip.files).filter(name => /^assets\/.*\.png$/.test(name))
    ).toHaveLength(4);
    expect(
      JSON.parse(await zip.file("snapshot.json")!.async("string"))
    ).toEqual(payload);
    expect(JSON.stringify(payload)).toBe(before);
    expect(state.fetchImage).not.toHaveBeenCalled();
    expect(state.resolveMaterial).not.toHaveBeenCalled();
    expect(state.anchor.click).toHaveBeenCalledOnce();
    expect(state.revoke).toHaveBeenCalledWith("blob:test-export");
    expect(state.toast.success).toHaveBeenCalledWith(
      expect.stringContaining("图片 4 张随包")
    );
    expect(state.toast.warning).not.toHaveBeenCalled();
    expect(state.toast.error).not.toHaveBeenCalled();
  });

  it("长期身份续签后取字节，manifest 和 snapshot 保留原来源", async () => {
    const original = url("expired-asset");
    const gcsUri = "gs://test-bucket/asset.png";
    const payload = buildManhuaCloudDraftPayload({
      writerSession: {},
      blocks: [],
      edges: [],
      factoryPrefs: {
        customAssetRefs: [{ id: "asset", url: original, gcsUri }],
      },
    });
    const state = setup(payload);
    state.fetchImage.mockResolvedValue({
      ok: true,
      blob: async () => imageBlob(),
    });
    await state.run();
    expect(state.resolveMaterial).toHaveBeenCalledWith(gcsUri);
    expect(state.fetchImage).toHaveBeenCalledOnce();
    expect(state.fetchImage).toHaveBeenCalledWith(
      url("renewed"),
      expect.objectContaining({ credentials: "omit" })
    );
    const zip = await state.readZip();
    const manifest: ManifestEntry[] = JSON.parse(
      await zip.file("assets-manifest.json")!.async("string")
    );
    expect(manifest).toEqual([
      { file: "assets/001.png", sourceUrl: original, mime: "image/png" },
    ]);
    expect(await zip.file(manifest[0]!.file)!.async("uint8array")).toEqual(
      imageBytes
    );
    expect(
      JSON.parse(await zip.file("snapshot.json")!.async("string"))
    ).toEqual(payload);
    expect(state.toast.error).not.toHaveBeenCalled();
  });

  it("失效候选链接只进缺图警告，已有图片仍随包，不能冒充完整成功", async () => {
    const payload = buildManhuaCloudDraftPayload({
      writerSession: {},
      blocks: [],
      edges: [],
      factoryPrefs: {
        customAssetRefs: [
          { id: "main", url: url("main") },
          { id: "candidate", url: url("expired-candidate") },
        ],
      },
    });
    await seedLocal(url("main"));
    const state = setup(payload);
    await state.run();
    const zip = await state.readZip();
    const manifest: ManifestEntry[] = JSON.parse(
      await zip.file("assets-manifest.json")!.async("string")
    );
    expect(manifest).toEqual([
      { file: "assets/001.png", sourceUrl: url("main"), mime: "image/png" },
    ]);
    expect(await zip.file(manifest[0]!.file)!.async("uint8array")).toEqual(
      imageBytes
    );
    expect(
      JSON.parse(await zip.file("snapshot.json")!.async("string"))
    ).toEqual(payload);
    expect(state.fetchImage).toHaveBeenCalledOnce();
    expect(state.fetchImage).toHaveBeenCalledWith(
      url("expired-candidate"),
      expect.any(Object)
    );
    expect(state.toast.warning).toHaveBeenCalledWith(
      expect.stringContaining("图打包 1/2 张;1 张未取得可用图片")
    );
    expect(state.toast.success).not.toHaveBeenCalled();
    expect(state.toast.error).not.toHaveBeenCalled();
  });
});

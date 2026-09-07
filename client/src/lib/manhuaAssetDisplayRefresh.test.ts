import { readFileSync } from "node:fs";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { canKeepAssetImageDisplayUrl } from "./manhuaAssetImageSource";

const page = ts.createSourceFile(
  "OmniCanvas.tsx",
  readFileSync(new URL("../pages/OmniCanvas.tsx", import.meta.url), "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);
function realRefreshEffect(deps: Record<string, unknown>) {
  let text = "";
  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(page) === "useEffect"
    ) {
      const body = node.arguments[0]?.getText(page) || "";
      if (
        body.includes("const stale = customAssetRefs.filter(") &&
        body.includes("resignedPropGcsUriRef")
      )
        text = body;
    }
    ts.forEachChild(node, visit);
  }
  visit(page);
  if (!text) throw new Error("找不到真实资产续签 effect");
  const compiled = ts.transpileModule(`const effect = ${text};`, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
    },
  }).outputText;
  return new Function(...Object.keys(deps), `${compiled}\nreturn effect;`)(
    ...Object.values(deps)
  );
}
const original = {
  id: "new-ref",
  gcsUri: "gs://test-bucket/generated/current.png",
  url: "https://storage.googleapis.com/test-bucket/generated/current.png?X-Goog-Date=20260907T170620Z&X-Goog-Expires=604800&X-Goog-Signature=test-signature",
  primaryBindings: [],
};
afterEach(() => vi.restoreAllMocks());
describe("真实工作台资产续签入口", () => {
  it("新产物七天签名不发请求、不覆盖资产和主绑定", () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-07T19:06:00Z"));
    const resolveCanvasMaterialUrl = vi.fn();
    const setCustomAssetRefs = vi.fn();
    realRefreshEffect({
      customAssetRefs: [original],
      resignedPropGcsUriRef: { current: new Set() },
      canKeepAssetImageDisplayUrl,
      resolveCanvasMaterialUrl,
      setCustomAssetRefs,
    })();
    expect(resolveCanvasMaterialUrl).not.toHaveBeenCalled();
    expect(setCustomAssetRefs).not.toHaveBeenCalled();
  });
  it("旧过期签名经原接口恢复，同 ID 同对象保留旧资产字段", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-07T19:06:00Z"));
    const expired = {
      ...original,
      url: original.url.replace("604800", "3600"),
    };
    const freshUrl = original.url.replace("170620Z", "190620Z");
    const resolveCanvasMaterialUrl = vi.fn(async () => freshUrl);
    const setCustomAssetRefs = vi.fn();
    const cleanup = realRefreshEffect({
      customAssetRefs: [expired],
      resignedPropGcsUriRef: { current: new Set() },
      canKeepAssetImageDisplayUrl,
      resolveCanvasMaterialUrl,
      setCustomAssetRefs,
    })();
    await vi.waitFor(() => expect(setCustomAssetRefs).toHaveBeenCalledTimes(1));
    expect(resolveCanvasMaterialUrl).toHaveBeenCalledTimes(1);
    expect(resolveCanvasMaterialUrl).toHaveBeenCalledWith(original.gcsUri);
    expect(setCustomAssetRefs.mock.calls[0][0]([expired])).toEqual([
      { ...expired, url: freshUrl },
    ]);
    cleanup();
  });
  it("换工作区后旧请求迟到不更新；签名失败不写假地址", async () => {
    const expired = {
      ...original,
      url: "https://storage.googleapis.com/test-bucket/generated/current.png",
    };
    let done!: (url: string) => void;
    const setCustomAssetRefs = vi.fn();
    const base = {
      customAssetRefs: [expired],
      resignedPropGcsUriRef: { current: new Set() },
      canKeepAssetImageDisplayUrl,
      setCustomAssetRefs,
    };
    const cleanup = realRefreshEffect({
      ...base,
      resolveCanvasMaterialUrl: () =>
        new Promise<string>(resolve => {
          done = resolve;
        }),
    })();
    cleanup();
    done(original.url);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(setCustomAssetRefs).not.toHaveBeenCalled();
    realRefreshEffect({
      ...base,
      resolveCanvasMaterialUrl: async () => {
        throw new Error("拒绝读取");
      },
    })();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(setCustomAssetRefs).not.toHaveBeenCalled();
  });
});

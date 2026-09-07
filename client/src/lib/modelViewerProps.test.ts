import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ModelViewer, resolveModelViewerUrl } from "@/components/ModelViewer";

function renderedViewerDocument(props: Parameters<typeof ModelViewer>[0]) {
  const markup = renderToStaticMarkup(React.createElement(ModelViewer, props));
  const srcDoc = markup.match(/srcDoc="([^"]*)"/i)?.[1];
  if (!srcDoc) throw new Error("未生成查看器文档");
  return srcDoc
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

describe("查看器内嵌贴图策略", () => {
  for (const prop of ["src", "modelUrl", "glbUrl"] as const) {
    it(`${prop} 入口允许内嵌 GLB 贴图的 blob 读取，不放宽脚本来源`, () => {
      const html = renderedViewerDocument({
        [prop]: "https://cdn.example/model.glb",
      });
      const policy = html.match(
        /http-equiv="Content-Security-Policy" content="([^"]+)"/
      )?.[1];
      expect(policy).toBeTruthy();
      const directives = Object.fromEntries(
        policy!
          .split(";")
          .filter(part => part.trim())
          .map(part => {
            const [name, ...sources] = part.trim().split(/\s+/);
            return [name, sources];
          })
      );
      expect(directives["img-src"]).toEqual(["https:", "data:", "blob:"]);
      expect(directives["connect-src"]).toEqual(["https:", "blob:"]);
      expect(directives["script-src"]).toEqual(["'self'", "'unsafe-inline'"]);
      expect(directives["default-src"]).toEqual(["'none'"]);
      expect(html).toContain('src="https://cdn.example/model.glb"');
    });
  }

  it("贴图内部放行不允许用户传入 blob 模型地址", () => {
    expect(
      resolveModelViewerUrl({ glbUrl: "blob:https://cdn.example/model" })
    ).toBeNull();
    const html = renderToStaticMarkup(
      React.createElement(ModelViewer, {
        glbUrl: "blob:https://cdn.example/model",
      })
    );
    expect(html).not.toContain("<iframe");
  });
});

describe("resolveModelViewerUrl", () => {
  it("supports all public URL props in stable priority order", () => {
    expect(resolveModelViewerUrl({ src: "https://cdn.example/src.glb" })).toBe(
      "https://cdn.example/src.glb"
    );
    expect(
      resolveModelViewerUrl({
        modelUrl: "https://cdn.example/model.glb",
        src: "https://cdn.example/src.glb",
      })
    ).toBe("https://cdn.example/model.glb");
    expect(
      resolveModelViewerUrl({
        glbUrl: "https://cdn.example/glb.glb",
        modelUrl: "https://cdn.example/model.glb",
        src: "https://cdn.example/src.glb",
      })
    ).toBe("https://cdn.example/glb.glb");
  });

  it("returns null for an empty input", () => {
    expect(resolveModelViewerUrl({})).toBeNull();
  });

  it("rejects non-HTTPS and malformed model URLs before building srcDoc", () => {
    expect(resolveModelViewerUrl({ src: "javascript:alert(1)" })).toBeNull();
    expect(
      resolveModelViewerUrl({ src: "data:model/gltf-binary;base64,AAAA" })
    ).toBeNull();
    expect(resolveModelViewerUrl({ src: "not-a-url" })).toBeNull();
  });
});

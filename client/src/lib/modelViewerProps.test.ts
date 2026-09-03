import { describe, expect, it } from "vitest";
import { resolveModelViewerUrl } from "@/components/ModelViewer";

describe("resolveModelViewerUrl", () => {
  it("supports all public URL props in stable priority order", () => {
    expect(resolveModelViewerUrl({ src: "https://cdn.example/src.glb" })).toBe(
      "https://cdn.example/src.glb",
    );
    expect(
      resolveModelViewerUrl({
        modelUrl: "https://cdn.example/model.glb",
        src: "https://cdn.example/src.glb",
      }),
    ).toBe("https://cdn.example/model.glb");
    expect(
      resolveModelViewerUrl({
        glbUrl: "https://cdn.example/glb.glb",
        modelUrl: "https://cdn.example/model.glb",
        src: "https://cdn.example/src.glb",
      }),
    ).toBe("https://cdn.example/glb.glb");
  });

  it("returns null for an empty input", () => {
    expect(resolveModelViewerUrl({})).toBeNull();
  });
});

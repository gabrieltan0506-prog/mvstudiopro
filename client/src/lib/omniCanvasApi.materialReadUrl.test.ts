import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./longJobsFlyOrigin", () => ({
  withLongJobsFlyDirect: (path: string) => `https://api.mvstudiopro.com${path}`,
}));

import { resolveCanvasMaterialUrl } from "./omniCanvasApi";

describe("resolveCanvasMaterialUrl", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("通过 Fly API 主机换取 GCS 读链，避免 Vercel 检查页返回 HTML", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          url: "https://storage.googleapis.com/signed-preview",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(resolveCanvasMaterialUrl("gs://bucket/uploads/u7/a.png")).resolves.toBe(
      "https://storage.googleapis.com/signed-preview",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.mvstudiopro.com/api/google?op=materialReadUrl&gcsUri=gs%3A%2F%2Fbucket%2Fuploads%2Fu7%2Fa.png",
      { credentials: "include" },
    );
  });
});

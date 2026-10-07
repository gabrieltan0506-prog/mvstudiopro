import { afterEach, expect, it, vi } from "vitest";
import { defaultCanvasBlock } from "./canvasTypes";
import { runCanvasBlock } from "./canvasRunBlock";
import { createJobSameOrigin, pollJobUntilTerminal } from "./jobs";
import { defaultArtMotionSpec } from "../../../shared/artMotion";
vi.mock("./jobs", () => ({
  createJobSameOrigin: vi.fn(),
  pollJobUntilTerminal: vi.fn(),
}));
vi.mock("./longJobsFlyOrigin", () => ({
  withLongJobsFlyDirect: (url: string) => url,
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it("native video submission cannot bypass the art workbench", async () => {
  const block = {
    ...defaultCanvasBlock("video", 0, 0),
    artMotion: {
      version: 1 as const,
      spec: defaultArtMotionSpec(),
      history: [],
    },
  };
  const network = vi.fn(() => {
    throw new Error("unexpected network");
  });
  vi.stubGlobal("fetch", network);
  await expect(
    runCanvasBlock(
      { userId: "offline", userRole: "admin", optimizeCopy: async () => "" },
      block
    )
  ).rejects.toThrow("艺术动画");
  expect(createJobSameOrigin).not.toHaveBeenCalled();
  expect(network).not.toHaveBeenCalled();
});
it("source changes during resign stop image purchasing; frozen variant survives global preferences", async () => {
  const block = {
    ...defaultCanvasBlock("image", 0, 0),
    id: "image-world-object",
    imageMode: "edit" as const,
    prompt: "单个物件",
    refImageUrl:
      "https://storage.googleapis.com/offline/owned.png?X-Goog-Signature=old",
  };
  let changed = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      changed = true;
      return new Response(
        JSON.stringify({
          ok: true,
          url: "https://storage.googleapis.com/offline/owned.png?X-Goog-Signature=offline",
        })
      );
    })
  );
  await expect(
    runCanvasBlock(
      {
        userId: "offline",
        userRole: "admin",
        optimizeCopy: async () => "",
        assertCurrentSource: () => {
          if (changed) throw new Error("source changed");
        },
      },
      block
    )
  ).rejects.toThrow("source changed");
  expect(createJobSameOrigin).not.toHaveBeenCalled();
  vi.mocked(createJobSameOrigin).mockResolvedValue({
    jobId: "original",
  } as never);
  vi.mocked(pollJobUntilTerminal).mockResolvedValue({
    status: "succeeded",
    output: { imageUrl: "https://offline.invalid/result.png" },
  } as never);
  await runCanvasBlock(
    {
      userId: "offline",
      userRole: "admin",
      optimizeCopy: async () => "",
      imageVariants: ["sunburst"],
    },
    block
  );
  expect(createJobSameOrigin).toHaveBeenCalledTimes(1);
  expect(
    JSON.stringify(vi.mocked(createJobSameOrigin).mock.calls[0])
  ).toContain("sunburst");
});

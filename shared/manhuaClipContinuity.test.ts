import { describe, expect, it } from "vitest";
import { resolvePreviousEpisodeClipUrl } from "./manhuaClipContinuity";

describe("resolvePreviousEpisodeClipUrl", () => {
  it("returns nearest prior episode clip https url", () => {
    const url = resolvePreviousEpisodeClipUrl(
      [
        { id: "clip-e01", episodeIndex: 1, status: "done", outputUrl: "https://cdn.example/ep1.mp4" },
        { id: "clip-e02", episodeIndex: 2, status: "done", outputUrl: "https://cdn.example/ep2.mp4" },
        { id: "keyart-e03", episodeIndex: 3, status: "done", outputUrl: "https://cdn.example/k3.jpg" },
      ],
      3,
    );
    expect(url).toBe("https://cdn.example/ep2.mp4");
  });

  it("skips non-https and unfinished", () => {
    expect(
      resolvePreviousEpisodeClipUrl(
        [
          { id: "clip-e01", episodeIndex: 1, status: "running", outputUrl: "https://cdn.example/ep1.mp4" },
          { id: "clip-e01b", episodeIndex: 1, status: "done", outputUrl: "blob:x" },
        ],
        2,
      ),
    ).toBeUndefined();
  });
});

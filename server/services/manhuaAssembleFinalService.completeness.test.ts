import { describe, expect, it } from "vitest";
import { runManhuaAssembleFinal } from "./manhuaAssembleFinalService";

describe("runManhuaAssembleFinal completeness gate", () => {
  it("rejects an incomplete episode before music or render side effects", async () => {
    await expect(
      runManhuaAssembleFinal({
        clips: [
          {
            episodeIndex: 1,
            segmentIndex: 1,
            clipUrl: "https://cdn.example/pilot.mp4",
          },
        ],
        expectedSegments: [
          { episodeIndex: 1, segmentIndex: 1 },
          { episodeIndex: 1, segmentIndex: 2 },
        ],
        musicUrl: "https://cdn.example/music.mp3",
      }),
    ).rejects.toMatchObject({
      code: "manhua_assemble_incomplete",
      message: expect.stringContaining("不可导出半集"),
    });
  });
});

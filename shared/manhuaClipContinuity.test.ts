import { describe, expect, it } from "vitest";
import {
  MANHUA_CLIP_TAIL_FRAME_COUNT,
  MANHUA_CLIP_TAIL_WINDOW_SEC,
  resolveClipGlobalSegmentIndex,
  resolvePreviousEpisodeClipUrl,
  resolvePreviousSegmentClipUrl,
} from "./manhuaClipContinuity";
import {
  manhuaGlobalSegmentIndex,
  manhuaLocalSegmentIndex,
} from "./manhuaScriptWorkbench";

describe("manhua clip tail window for ~15s one-take", () => {
  it("samples last 3–5 seconds with multiple frames", () => {
    expect(MANHUA_CLIP_TAIL_WINDOW_SEC).toBeGreaterThanOrEqual(3);
    expect(MANHUA_CLIP_TAIL_WINDOW_SEC).toBeLessThanOrEqual(5);
    expect(MANHUA_CLIP_TAIL_FRAME_COUNT).toBeGreaterThanOrEqual(3);
  });
});

describe("manhua global segment numbering", () => {
  it("maps ep2 local1 → global 7 (budget 6 segs/ep)", () => {
    expect(manhuaGlobalSegmentIndex(1, 6)).toBe(6);
    expect(manhuaGlobalSegmentIndex(2, 1)).toBe(7);
    expect(manhuaLocalSegmentIndex(7, 2)).toBe(1);
    expect(manhuaLocalSegmentIndex(1, 2)).toBe(1); // legacy per-episode g01
  });
});

describe("resolvePreviousSegmentClipUrl", () => {
  it("g07 references g06 across episodes", () => {
    const url = resolvePreviousSegmentClipUrl(
      [
        {
          id: "clip-e01-g06-aaa",
          episodeIndex: 1,
          status: "done",
          outputUrl: "https://cdn.example/g06.mp4",
        },
        {
          id: "clip-e02-g07-bbb",
          episodeIndex: 2,
          status: "idle",
          outputUrl: undefined,
        },
      ],
      2,
      7,
    );
    expect(url).toBe("https://cdn.example/g06.mp4");
  });

  it("same-episode g02 references g01", () => {
    const url = resolvePreviousSegmentClipUrl(
      [
        {
          id: "clip-e01-g01-aaa",
          episodeIndex: 1,
          status: "done",
          outputUrl: "https://cdn.example/g01.mp4",
        },
        {
          id: "clip-e01-g02-bbb",
          episodeIndex: 1,
          status: "idle",
        },
      ],
      1,
      2,
    );
    expect(url).toBe("https://cdn.example/g01.mp4");
  });

  it("legacy ep2-g01 still resolves prev as ep1 last segment", () => {
    const url = resolvePreviousSegmentClipUrl(
      [
        {
          id: "clip-e01-g06-aaa",
          episodeIndex: 1,
          status: "done",
          outputUrl: "https://cdn.example/ep1-last.mp4",
        },
      ],
      2,
      1, // legacy local restart
    );
    expect(url).toBe("https://cdn.example/ep1-last.mp4");
  });
});

describe("resolvePreviousEpisodeClipUrl", () => {
  it("prefers last segment of prior episode", () => {
    const url = resolvePreviousEpisodeClipUrl(
      [
        {
          id: "clip-e01-g01-a",
          episodeIndex: 1,
          status: "done",
          outputUrl: "https://cdn.example/g01.mp4",
        },
        {
          id: "clip-e01-g06-b",
          episodeIndex: 1,
          status: "done",
          outputUrl: "https://cdn.example/g06.mp4",
        },
        {
          id: "clip-e02-g07-c",
          episodeIndex: 2,
          status: "done",
          outputUrl: "https://cdn.example/g07.mp4",
        },
      ],
      3,
    );
    expect(url).toBe("https://cdn.example/g07.mp4");
  });

  it("skips non-https and unfinished", () => {
    expect(
      resolvePreviousEpisodeClipUrl(
        [
          {
            id: "clip-e01-g06-a",
            episodeIndex: 1,
            status: "running",
            outputUrl: "https://cdn.example/ep1.mp4",
          },
          {
            id: "clip-e01-g05-b",
            episodeIndex: 1,
            status: "done",
            outputUrl: "blob:x",
          },
        ],
        2,
      ),
    ).toBeUndefined();
  });
});

describe("resolveClipGlobalSegmentIndex", () => {
  it("reads continuous g from id", () => {
    expect(
      resolveClipGlobalSegmentIndex({
        id: "clip-e02-g07-x",
        episodeIndex: 2,
      }),
    ).toBe(7);
  });
});

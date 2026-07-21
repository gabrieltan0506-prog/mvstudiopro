import { describe, expect, it } from "vitest";
import {
  resolveClipGlobalSegmentIndex,
  resolvePreviousEpisodeClipUrl,
  resolvePreviousSegmentClipUrl,
} from "./manhuaClipContinuity";
import {
  manhuaGlobalSegmentIndex,
  manhuaLocalSegmentIndex,
} from "./manhuaScriptWorkbench";

describe("manhua global segment numbering", () => {
  it("maps ep2 local1 → global 13", () => {
    expect(manhuaGlobalSegmentIndex(1, 12)).toBe(12);
    expect(manhuaGlobalSegmentIndex(2, 1)).toBe(13);
    expect(manhuaLocalSegmentIndex(13, 2)).toBe(1);
    expect(manhuaLocalSegmentIndex(1, 2)).toBe(1); // legacy per-episode g01
  });
});

describe("resolvePreviousSegmentClipUrl", () => {
  it("g13 references g12 across episodes", () => {
    const url = resolvePreviousSegmentClipUrl(
      [
        {
          id: "clip-e01-g12-aaa",
          episodeIndex: 1,
          status: "done",
          outputUrl: "https://cdn.example/g12.mp4",
        },
        {
          id: "clip-e02-g13-bbb",
          episodeIndex: 2,
          status: "idle",
          outputUrl: undefined,
        },
      ],
      2,
      13,
    );
    expect(url).toBe("https://cdn.example/g12.mp4");
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
          id: "clip-e01-g12-aaa",
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
          id: "clip-e01-g12-b",
          episodeIndex: 1,
          status: "done",
          outputUrl: "https://cdn.example/g12.mp4",
        },
        {
          id: "clip-e02-g13-c",
          episodeIndex: 2,
          status: "done",
          outputUrl: "https://cdn.example/g13.mp4",
        },
      ],
      3,
    );
    expect(url).toBe("https://cdn.example/g13.mp4");
  });

  it("skips non-https and unfinished", () => {
    expect(
      resolvePreviousEpisodeClipUrl(
        [
          {
            id: "clip-e01-g12-a",
            episodeIndex: 1,
            status: "running",
            outputUrl: "https://cdn.example/ep1.mp4",
          },
          {
            id: "clip-e01-g11-b",
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
        id: "clip-e02-g13-x",
        episodeIndex: 2,
      }),
    ).toBe(13);
  });
});

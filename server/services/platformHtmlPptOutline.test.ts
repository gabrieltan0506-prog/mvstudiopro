import { describe, expect, it } from "vitest";
import { splitHtmlPptOutlinePageChunks } from "./platformHtmlPptOutline";

describe("splitHtmlPptOutlinePageChunks", () => {
  it("keeps decks up to 10 pages in one chunk", () => {
    expect(splitHtmlPptOutlinePageChunks(10)).toEqual([10]);
  });

  it("splits 11–16 page decks into chunks of at most 6", () => {
    expect(splitHtmlPptOutlinePageChunks(11).every((n) => n <= 6)).toBe(true);
    expect(splitHtmlPptOutlinePageChunks(11).reduce((a, b) => a + b, 0)).toBe(11);
    expect(splitHtmlPptOutlinePageChunks(13).every((n) => n <= 6)).toBe(true);
    expect(splitHtmlPptOutlinePageChunks(13).reduce((a, b) => a + b, 0)).toBe(13);
    expect(splitHtmlPptOutlinePageChunks(16).reduce((a, b) => a + b, 0)).toBe(16);
    expect(Math.max(...splitHtmlPptOutlinePageChunks(16))).toBeLessThanOrEqual(6);
  });

  it("clamps below-minimum page counts to 10", () => {
    expect(splitHtmlPptOutlinePageChunks(5)).toEqual([10]);
    expect(splitHtmlPptOutlinePageChunks(8)).toEqual([10]);
  });
});

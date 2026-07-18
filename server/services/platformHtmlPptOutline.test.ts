import { describe, expect, it } from "vitest";
import { splitHtmlPptOutlinePageChunks } from "./platformHtmlPptOutline";

describe("splitHtmlPptOutlinePageChunks", () => {
  it("keeps decks up to 8 pages in one chunk", () => {
    expect(splitHtmlPptOutlinePageChunks(5)).toEqual([5]);
    expect(splitHtmlPptOutlinePageChunks(8)).toEqual([8]);
  });

  it("splits 9–16 page decks into chunks of at most 6", () => {
    expect(splitHtmlPptOutlinePageChunks(9).every((n) => n <= 6)).toBe(true);
    expect(splitHtmlPptOutlinePageChunks(9).reduce((a, b) => a + b, 0)).toBe(9);
    expect(splitHtmlPptOutlinePageChunks(13).every((n) => n <= 6)).toBe(true);
    expect(splitHtmlPptOutlinePageChunks(13).reduce((a, b) => a + b, 0)).toBe(13);
    expect(splitHtmlPptOutlinePageChunks(16).reduce((a, b) => a + b, 0)).toBe(16);
    expect(Math.max(...splitHtmlPptOutlinePageChunks(16))).toBeLessThanOrEqual(6);
  });
});

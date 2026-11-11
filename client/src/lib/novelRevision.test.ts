import { expect, it } from "vitest";
import {
  adoptNovelRevision,
  emptyNovelWorkspace,
  parseNovelRevisionEntry,
  recordNovelReviewOnly,
  recordNovelRevision,
  type NovelWorkspace,
} from "./novelWorkspace";
import { novelTestInputSchema } from "@shared/novelWorkspace";
import { REVISE_ORIGINAL, REVISE_REVIEW, REVISE_REVISED } from "@shared/novelRevise.fixture";

const input = novelTestInputSchema.parse({
  requestId: "33333333-3333-4333-8333-333333333333",
  roundId: "22222222-2222-4222-8222-222222222222",
  stage: "revise",
  topic: "t",
  direction: "d",
  templates: [],
  episodeCount: 1,
  chapterIndex: 2,
  reviseDraft: REVISE_ORIGINAL,
});
const result = {
  requestId: input.requestId,
  stage: "revise" as const,
  text: JSON.stringify({ chapterIndex: 2, original: REVISE_ORIGINAL, review: REVISE_REVIEW, revised: REVISE_REVISED }),
  templateIds: [],
  inputSha256: "a",
  resultSha256: "b",
};
const draft = (): NovelWorkspace => ({
  ...emptyNovelWorkspace(),
  chapters: ["第一集", REVISE_ORIGINAL, "第三集"],
});

it("记录审稿改稿不改正文；采用后修改版入正文、未修改版进历史版本", () => {
  const d = draft();
  const recorded = { ...d, ...recordNovelRevision(d, input, result) };
  expect(recorded.chapters[1]).toBe(REVISE_ORIGINAL);
  expect(recordNovelRevision(recorded, input, result)).toEqual({});
  const adopted = { ...recorded, ...adoptNovelRevision(recorded, input.requestId) };
  expect(adopted.chapters[1]).toBe(`账册\n\n${REVISE_REVISED.text}`);
  expect(adopted.chapterVersions?.at(-1)).toMatchObject({ index: 1, text: REVISE_ORIGINAL });
  expect(adopted.chapterWarnings?.["2"]).toMatch(/前文已修改/);
  expect(adopted.chapterRevisions?.[0].adoptedAt).toBeTruthy();
  expect(adopted.novelApproved).toBe("");
});
it("改稿失败只保留审稿意见，不可采用", () => {
  const d = draft();
  const next = { ...d, ...recordNovelReviewOnly(d, input, REVISE_REVIEW, "改稿未通过") };
  const parsed = parseNovelRevisionEntry(next.chapterRevisions![0]);
  expect(parsed?.review.verdict).toBe(REVISE_REVIEW.verdict);
  expect(parsed?.revised).toBeUndefined();
  expect(() => adoptNovelRevision(next, input.requestId)).toThrow();
});
it("坏记录不让整份草稿读取失败", () => {
  expect(parseNovelRevisionEntry({ index: 0, requestId: "x", savedAt: "", outcome: "{坏" })).toBeNull();
});

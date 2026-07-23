import { describe, expect, it } from "vitest";
import {
  buildManhuaCloudDraftPayload,
  isManhuaCloudDraftExpired,
  isManhuaCloudDraftNewer,
  isManhuaCloudDraftVideoBlock,
  parseManhuaCloudDraftPayload,
  sanitizeManhuaCloudDraftBlock,
} from "./manhuaCloudDraft";

describe("manhuaCloudDraft", () => {
  it("strips video outputs but keeps keyart image urls", () => {
    const keyart = sanitizeManhuaCloudDraftBlock({
      id: "keyart-e01-s01-a",
      kind: "image",
      x: 10,
      y: 20,
      width: 400,
      height: 360,
      prompt: "静帧",
      outputUrl: "https://cdn.example/k1.jpg",
      outputUrls: ["https://cdn.example/k1.jpg"],
      status: "done",
    });
    expect(keyart?.outputUrl).toContain("k1.jpg");

    const clip = sanitizeManhuaCloudDraftBlock({
      id: "clip-e01-s01-b",
      kind: "video",
      x: 0,
      y: 0,
      width: 400,
      height: 360,
      prompt: "成片",
      outputUrl: "https://cdn.example/c1.mp4",
      outputUrls: ["https://cdn.example/c1.mp4"],
      status: "done",
    });
    expect(isManhuaCloudDraftVideoBlock(clip!)).toBe(true);
    expect(clip?.outputUrl).toBeUndefined();
    expect(clip?.outputUrls).toEqual([]);
    expect(clip?.prompt).toContain("成片");
  });

  it("rejects blob urls for images", () => {
    const b = sanitizeManhuaCloudDraftBlock({
      id: "keyart-x",
      kind: "image",
      x: 0,
      y: 0,
      width: 400,
      height: 360,
      prompt: "x",
      outputUrl: "blob:https://local/abc",
    });
    expect(b?.outputUrl).toBeUndefined();
  });

  it("keeps site-relative manhua pad refs for keyart rerun", () => {
    const b = sanitizeManhuaCloudDraftBlock({
      id: "keyart-e01-s01-a",
      kind: "image",
      x: 0,
      y: 0,
      width: 400,
      height: 360,
      prompt: "静帧",
      imageMode: "edit",
      refImageUrl: "/manhua-scenes/scene_07.webp",
      editFusionUrls: ["/manhua-props/jade.png", "blob:https://local/x"],
      status: "idle",
    });
    expect(b?.refImageUrl).toBe("/manhua-scenes/scene_07.webp");
    expect(b?.editFusionUrls).toEqual(["/manhua-props/jade.png"]);
  });

  it("round-trips payload with writer pack", () => {
    const payload = buildManhuaCloudDraftPayload({
      clientUpdatedAt: "2026-07-20T06:00:00.000Z",
      writerSession: {
        topic: "都市逆袭",
        brief: "钩子",
        episodeCount: 3,
        writerPack: {
          seriesTitle: "花名册",
          logline: "改写现实",
          charactersMd: "- A",
          propsMd: "- B",
          locationsMd: "- C",
          episodes: [
            { index: 1, title: "一", body: "冲突正文足够长一些。", endHook: "悬念还在下一集" },
            { index: 2, title: "二", body: "再压一把。", endHook: "客服微笑未完" },
          ],
          rawMarkdown: "## 系列标题\n花名册\n",
          episodeCount: 2,
        },
        writerConfirmed: true,
      },
      blocks: [
        {
          id: "keyart-e01-s01",
          kind: "image",
          x: 0,
          y: 0,
          width: 400,
          height: 360,
          prompt: "k",
          outputUrl: "https://cdn.example/a.jpg",
        },
        {
          id: "clip-e01-s01",
          kind: "video",
          x: 0,
          y: 0,
          width: 400,
          height: 360,
          prompt: "v",
          outputUrl: "https://cdn.example/a.mp4",
        },
      ],
      edges: [{ fromId: "keyart-e01-s01", toId: "clip-e01-s01" }],
    });
    const again = parseManhuaCloudDraftPayload(JSON.stringify(payload));
    expect(again?.writerSession.writerPack?.seriesTitle).toBe("花名册");
    expect(again?.canvas.blocks.find((b) => b.id.startsWith("keyart"))?.outputUrl).toContain(".jpg");
    expect(again?.canvas.blocks.find((b) => b.id.startsWith("clip"))?.outputUrl).toBeUndefined();
  });

  it("compares cloud vs local timestamps", () => {
    expect(isManhuaCloudDraftNewer("2026-07-20T08:00:00.000Z", "2026-07-20T07:00:00.000Z")).toBe(
      true,
    );
    expect(isManhuaCloudDraftNewer("2026-07-20T07:00:00.000Z", "2026-07-20T08:00:00.000Z")).toBe(
      false,
    );
    expect(isManhuaCloudDraftNewer("2026-07-20T08:00:00.000Z", null)).toBe(true);
  });

  it("expires after retention window", () => {
    const now = Date.parse("2026-07-20T12:00:00.000Z");
    expect(isManhuaCloudDraftExpired("2026-06-19T12:00:00.000Z", now, 30)).toBe(true);
    expect(isManhuaCloudDraftExpired("2026-06-21T12:00:00.000Z", now, 30)).toBe(false);
  });
});

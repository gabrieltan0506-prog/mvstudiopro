import { expect, it, vi } from "vitest";
import { defaultCanvasBlock, normalizeCanvasBlock } from "./canvasTypes";
import {
  artMotionStateSchema,
  defaultArtMotionSpec,
} from "../../../shared/artMotion";
import { imageWorldStateSchema } from "../../../shared/imageWorld";
import {
  buildLocalCloudDraftSnapshot,
  cloudDraftBlocksToCanvas,
} from "./manhuaCloudDraftSync";
import {
  parseManhuaCloudDraftPayload,
  serializeManhuaCloudDraftPayload,
} from "../../../shared/manhuaCloudDraft";
it("actual local/cloud serializer preserves animation history, media, model unknown intent and image receipts", () => {
  const request = {
    id: "c1007000-1234-4234-8234-123456789abc",
    spec: defaultArtMotionSpec(),
    status: "succeeded",
    jobId: "art-job",
    gcsUri: "gs://offline/result.mp4",
  };
  const art = {
    ...defaultCanvasBlock("video", 0, 0),
    id: "art",
    artMotion: artMotionStateSchema.parse({
      version: 1,
      spec: defaultArtMotionSpec(),
      request,
      history: [{ ...request, id: "c1007001-1234-4234-8234-123456789abc" }],
      media: [
        {
          id: "pic",
          kind: "image",
          name: "图片",
          gcsUri: "gs://offline/pic.png",
        },
      ],
    }),
  };
  const plan = {
    scene: "木桌",
    ambience: "室内",
    objects: [
      {
        id: "cup",
        name: "杯",
        description: "白瓷",
        position: "左边",
        selected: true,
      },
    ],
  };
  const image = {
    ...defaultCanvasBlock("text", 0, 0),
    id: "image",
    imageWorld: imageWorldStateSchema.parse({
      version: 1,
      sourceBlockId: "source",
      sourceUrl: "https://offline.invalid/original.png",
      plan,
      objectBlockIds: { cup: "child" },
      generations: {
        child: {
          status: "submitting",
          jobIds: ["image-task"],
          expectedCount: 1,
          variants: ["flare"],
          prompt: "提取左杯",
          sourceUrl: "https://offline.invalid/original.png",
        },
      },
      pending: {
        cup: {
          kind: "object",
          assetRef: "child",
          sourceUri: "gs://offline/cup.png",
          name: "杯",
          plan,
          model: "marble-1.1",
        },
      },
    }),
  };
  const payload = buildLocalCloudDraftSnapshot({
    writerSession: {},
    blocks: [art, image],
    edges: [],
  });
  const serialized = serializeManhuaCloudDraftPayload(payload),
    parsed = parseManhuaCloudDraftPayload(serialized);
  expect(parsed).toBeTruthy();
  const restored = cloudDraftBlocksToCanvas(parsed!.canvas.blocks);
  expect(restored[0].artMotion).toEqual(art.artMotion);
  expect(restored[1].imageWorld).toEqual(image.imageWorld);
  expect(
    normalizeCanvasBlock(JSON.parse(JSON.stringify(image))).imageWorld?.pending
      .cup.sourceUri
  ).toBe("gs://offline/cup.png");
});

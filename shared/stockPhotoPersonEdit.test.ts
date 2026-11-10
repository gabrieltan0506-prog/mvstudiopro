import { describe, expect, it } from "vitest";
import { buildStockPhotoPersonEditPrompt, pickStockPhotoPersonEditPeople, stockPhotoPersonEditInputSchema, stockPhotoPersonEditReferenceOrder } from "./stockPhotoPersonEdit";

const base = {
  requestId: "a51d8a78-1c90-4f1d-9c1e-324e7a3f4659",
  baseAssetId: `sf_${"a".repeat(48)}`,
  actionText: "他撑透明伞站在橱窗前开口演唱",
  aspectRatio: "9:16" as const,
};
const lead = { slot: "lead" as const, source: "gs://b/uploads/u7/face.jpg", identityPhoto: true, wardrobeEn: "dark charcoal overcoat" };
const partner = { slot: "partner" as const, source: "gs://b/canvas/w.png", identityPhoto: false };

describe("实拍照放入人物重绘：输入与指令", () => {
  it("cast 与人物顺序必须对齐（双人=男主在前、女主在后）", () => {
    expect(stockPhotoPersonEditInputSchema.safeParse({ ...base, cast: "lead", people: [lead] }).success).toBe(true);
    expect(stockPhotoPersonEditInputSchema.safeParse({ ...base, cast: "both", people: [lead, partner] }).success).toBe(true);
    expect(stockPhotoPersonEditInputSchema.safeParse({ ...base, cast: "both", people: [partner, lead] }).success).toBe(false);
    expect(stockPhotoPersonEditInputSchema.safeParse({ ...base, cast: "partner", people: [lead] }).success).toBe(false);
    expect(stockPhotoPersonEditInputSchema.safeParse({ ...base, cast: "lead", people: [lead], baseAssetId: "gs://x/y.jpg" }).success).toBe(false);
  });
  it("底图固定为 image 1，人物按序号点名；真人照只锁脸、定妆帧锁脸与服装", () => {
    const prompt = buildStockPhotoPersonEditPrompt({ people: [lead, partner], actionText: "她转身离开", relightText: "黄昏改雨夜" });
    expect(prompt).toMatch(/Image 1 is a REAL street photograph and is the BASE PLATE/);
    expect(prompt).toMatch(/THE LEAD = the real person in image 2\. FACE LOCK/);
    expect(prompt).toMatch(/do NOT copy its background, studio lighting or clothing\. Wardrobe: dark charcoal overcoat\./);
    expect(prompt).toMatch(/THE PARTNER = the character in image 3 \(character card\): keep the same face, hairstyle and outfit/);
    expect(prompt).toMatch(/ACTION: 她转身离开/);
    expect(prompt).toMatch(/RELIGHT: 黄昏改雨夜/);
    expect(buildStockPhotoPersonEditPrompt({ people: [lead], actionText: "x" })).not.toMatch(/RELIGHT/);
    expect(stockPhotoPersonEditReferenceOrder("gs://b/stock/base.jpg", [lead, partner])).toEqual(["gs://b/stock/base.jpg", lead.source, partner.source]);
  });
  it("前台按 cast 取人物，缺人给出中文原因", () => {
    const options = [{ slot: "lead" as const, source: lead.source, label: "演唱者", identityPhoto: true }];
    expect(pickStockPhotoPersonEditPeople("lead", options)).toEqual({ people: [{ slot: "lead", source: lead.source, identityPhoto: true }] });
    expect(pickStockPhotoPersonEditPeople("both", options)).toEqual({ missingZh: "还没有女主的人物参考" });
  });
});

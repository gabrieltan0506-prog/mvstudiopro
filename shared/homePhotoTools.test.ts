import { describe, expect, it } from "vitest";
import {
  HOME_OLD_PHOTO_RESTORE_CREDITS,
  HOME_PHOTO_ANIMATE_15S_CREDITS,
  HOME_PHOTO_ANIMATE_DEFAULT_RESOLUTION,
  HOME_PHOTO_ANIMATE_DURATIONS,
  HOME_PHOTO_ANIMATE_RESOLUTIONS,
  buildOldPhotoRestorePrompt,
  homePhotoAnimateCredits,
  isHomePhotoAnimateDuration,
  isHomePhotoAnimateResolution,
} from "./homePhotoTools";
import { imageUpscaleTotalCredits } from "./plans";

describe("首页照片工具定价", () => {
  it("首页高清放大固定为 2×15 / 4×35 积分", () => {
    expect(imageUpscaleTotalCredits("homePhotoUpscaleBase", "x2")).toBe(15);
    expect(imageUpscaleTotalCredits("homePhotoUpscaleBase", "x4")).toBe(35);
  });

  it("高清修复固定为 10 积分", () => {
    expect(HOME_OLD_PHOTO_RESTORE_CREDITS).toBe(10);
  });

  it("人物动起来按现有 15 秒售价等比例按秒拆分", () => {
    expect(HOME_PHOTO_ANIMATE_15S_CREDITS).toBe(118);
    expect(HOME_PHOTO_ANIMATE_DURATIONS).toEqual([5, 10, 15]);
    expect(homePhotoAnimateCredits(5)).toBe(40);
    expect(homePhotoAnimateCredits(10)).toBe(79);
    expect(homePhotoAnimateCredits(15)).toBe(118);
  });

  it("1080p 在对应 720p 秒档上加 20% 并向上取整", () => {
    expect(HOME_PHOTO_ANIMATE_DEFAULT_RESOLUTION).toBe("720p");
    expect(HOME_PHOTO_ANIMATE_RESOLUTIONS).toEqual(["720p", "1080p"]);
    expect(homePhotoAnimateCredits(5, "1080p")).toBe(48);
    expect(homePhotoAnimateCredits(10, "1080p")).toBe(95);
    expect(homePhotoAnimateCredits(15, "1080p")).toBe(142);
  });

  it("只接受首页暴露的三个时长", () => {
    expect(isHomePhotoAnimateDuration(5)).toBe(true);
    expect(isHomePhotoAnimateDuration("10")).toBe(true);
    expect(isHomePhotoAnimateDuration(15)).toBe(true);
    expect(isHomePhotoAnimateDuration(6)).toBe(false);
    expect(isHomePhotoAnimateDuration("auto")).toBe(false);
  });

  it("只接受 HappyHorse 首页开放的两个清晰度", () => {
    expect(isHomePhotoAnimateResolution("720p")).toBe(true);
    expect(isHomePhotoAnimateResolution("1080p")).toBe(true);
    expect(isHomePhotoAnimateResolution("4K")).toBe(false);
    expect(isHomePhotoAnimateResolution(undefined)).toBe(false);
  });
});

describe("老照片修复提示词", () => {
  it("锁定人物身份、构图与禁止项", () => {
    const prompt = buildOldPhotoRestorePrompt();
    expect(prompt).toContain("严格保持所有人物的身份");
    expect(prompt).toContain("原始构图");
    expect(prompt).toContain("鲜活、明亮");
    expect(prompt).toContain("禁止美颜换脸");
    expect(prompt).toContain("禁止");
    expect(prompt).toContain("水印");
  });
});

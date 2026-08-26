/**
 * 参数组合校验。**不发任何网络请求**——这里锁的正是「传错不报错、
 * 只是静默不生效」的那几种组合，跑到线上才发现就是白烧一单。
 */
import { describe, expect, it } from "vitest";
import {
  EVOLINK_SUNO_GENERATION_PATH,
  EVOLINK_SUNO_MODEL,
  assertEvolinkSunoRequest,
  pickEvolinkSunoAudioUrls,
  type EvolinkSunoRequest,
} from "./evolinkSunoMusic";

const bgm: EvolinkSunoRequest = {
  model: EVOLINK_SUNO_MODEL,
  custom_mode: true,
  instrumental: true,
  style: "instrumental score, guzheng, slow build",
  title: "古言种田·配乐",
  duration: 30,
  negative_tags: "vocals, singing",
};

describe("端点常量", () => {
  it("与文档一致", () => {
    expect(EVOLINK_SUNO_GENERATION_PATH).toBe("/v1/audios/generations");
    expect(EVOLINK_SUNO_MODEL).toBe("suno-v5.5-beta");
  });
});

describe("参数组合硬校验", () => {
  it("标准 BGM 配方放行", () => {
    expect(() => assertEvolinkSunoRequest(bgm)).not.toThrow();
  });

  it("simple mode 传 duration 拒绝 —— 文档明写不生效，且不报错", () => {
    expect(() =>
      assertEvolinkSunoRequest({ ...bgm, custom_mode: false, prompt: "x", duration: 30 }),
    ).toThrow("custom_mode=true");
  });

  it("simple mode 传 style/title/negative_tags 一律拒绝，别让人以为生效了", () => {
    for (const k of ["style", "title", "negative_tags"] as const) {
      expect(() =>
        assertEvolinkSunoRequest({
          model: EVOLINK_SUNO_MODEL,
          custom_mode: false,
          instrumental: true,
          prompt: "x",
          [k]: "y",
        } as EvolinkSunoRequest),
      ).toThrow("不生效");
    }
  });

  it("duration 越界拒绝（10–360 整数）", () => {
    expect(() => assertEvolinkSunoRequest({ ...bgm, duration: 9 })).toThrow("10–360");
    expect(() => assertEvolinkSunoRequest({ ...bgm, duration: 361 })).toThrow("10–360");
    expect(() => assertEvolinkSunoRequest({ ...bgm, duration: 30.5 })).toThrow("10–360");
  });

  it("custom_mode 缺 style 或 title 拒绝", () => {
    expect(() => assertEvolinkSunoRequest({ ...bgm, style: "" })).toThrow("style 必填");
    expect(() => assertEvolinkSunoRequest({ ...bgm, title: "" })).toThrow("title 必填");
  });

  it("要人声却没给歌词拒绝（custom_mode 下 prompt 即歌词）", () => {
    expect(() =>
      assertEvolinkSunoRequest({ ...bgm, instrumental: false, prompt: "" }),
    ).toThrow("歌词必填");
  });

  it("非 V5.5 一律拒绝 —— 其它版本没有 duration，段表对不齐", () => {
    expect(() =>
      assertEvolinkSunoRequest({ ...bgm, model: "suno-v5-beta" as never }),
    ).toThrow("duration");
  });

  it("simple mode 缺 prompt 拒绝", () => {
    expect(() =>
      assertEvolinkSunoRequest({
        model: EVOLINK_SUNO_MODEL,
        custom_mode: false,
        instrumental: true,
      }),
    ).toThrow("prompt 必填");
  });
});

describe("取音频地址（按可信结构读，不靠 URL 长相猜）", () => {
  it("result_data.clips 多变体全部返回 —— skill 要求先量再听", () => {
    expect(
      pickEvolinkSunoAudioUrls({
        result_data: { clips: [{ audio_url: "https://a/1.mp3" }, { audio_url: "https://a/2.mp3" }] },
      }),
    ).toEqual(["https://a/1.mp3", "https://a/2.mp3"]);
  });

  it("result_data 是数组时也能读", () => {
    expect(pickEvolinkSunoAudioUrls({ result_data: [{ audio_url: "https://a/1.mp3" }] })).toEqual([
      "https://a/1.mp3",
    ]);
  });

  it("results[] 字符串数组能读 —— 上一版把这种形状全丢了", () => {
    expect(pickEvolinkSunoAudioUrls({ results: ["https://a/2.mp3"] })).toEqual(["https://a/2.mp3"]);
  });

  it("无扩展名的签名下载链能读 —— 上一版按扩展名过滤把它挡掉了", () => {
    expect(pickEvolinkSunoAudioUrls({ result_data: { audio_url: "https://a/dl?id=1" } })).toEqual([
      "https://a/dl?id=1",
    ]);
  });

  it("封面图不当音频 —— audio_image_url 根本不在取值位置里", () => {
    expect(
      pickEvolinkSunoAudioUrls({
        audio_image_url: "https://cdn/cover.jpg",
        audio_url: "https://cdn/song.mp3",
      }),
    ).toEqual(["https://cdn/song.mp3"]);
  });

  it("去重，且只收 https", () => {
    expect(
      pickEvolinkSunoAudioUrls({
        result_data: {
          audio_url: "https://a/1.mp3",
          audioUrl: "https://a/1.mp3",
          download_url: "http://a/2.mp3",
        },
      }),
    ).toEqual(["https://a/1.mp3"]);
  });

  it("没有音频时返回空数组，不抛", () => {
    expect(pickEvolinkSunoAudioUrls({ status: "pending" })).toEqual([]);
    expect(pickEvolinkSunoAudioUrls(null)).toEqual([]);
    expect(pickEvolinkSunoAudioUrls([])).toEqual([]);
  });
});


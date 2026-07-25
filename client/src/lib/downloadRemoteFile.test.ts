import { describe, expect, it } from "vitest";
import { guessRemoteFileName } from "./downloadRemoteFile";

describe("guessRemoteFileName", () => {
  /** 产物是 GCS 签名地址，一长串 X-Goog-* 参数绝不能进文件名 */
  it("剥掉签名参数，只留文件名", () => {
    expect(
      guessRemoteFileName(
        "https://storage.googleapis.com/b/manhua/seg01.mp4?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Signature=abc",
        "第01段",
      ),
    ).toBe("seg01.mp4");
  });

  it("路径里没有扩展名时按类型补，并用可读的段名兜底", () => {
    expect(guessRemoteFileName("https://cdn.example/objects/9f2c1a", "第01段成片")).toBe(
      "第01段成片",
    );
    expect(guessRemoteFileName("https://cdn.example/a/b.mp4?t=1", "x")).toBe("b.mp4");
  });

  /** 段名可能含中文与标点；Windows 非法字符会让保存直接失败 */
  it("兜底名里的非法字符换成下划线", () => {
    expect(guessRemoteFileName("https://cdn.example/noext", '第1段/断月桥:"雨夜"')).toBe(
      "第1段_断月桥_雨夜_",
    );
  });

  it("URL 编码的中文文件名解回可读", () => {
    expect(guessRemoteFileName("https://cdn.example/%E7%AC%AC01%E6%AE%B5.mp4", "x")).toBe(
      "第01段.mp4",
    );
  });
});

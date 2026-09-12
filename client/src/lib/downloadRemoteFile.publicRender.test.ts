import { describe, expect, it } from "vitest";
import { guessRemoteFileName } from "./downloadRemoteFile";
describe("公开稳定代理的下载文件名", () => {
  it.each(["rendered-video.mp4", "scene-voice-track.mp3"])("保留%s扩展名", (file) => {
    expect(guessRemoteFileName(`https://test.invalid/api/jobs?op=blobMedia&blobPath=${encodeURIComponent(`gcs-renders/test/${file}`)}`, "成片")).toBe(file);
  });
  it("旧Blob直链保持不变", () => {
    expect(guessRemoteFileName("https://test.blob.vercel-storage.com/renders/old.mp4?x=1", "成片")).toBe("old.mp4");
  });
});

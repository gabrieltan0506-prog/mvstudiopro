import { expect, it } from "vitest";
import { assertOwnPlatformQaFileUri, assertPlatformQaWorkerFileUri, platformQaUserPrefix } from "./platformQaUpload";

/** 平台追问附件归属：入队只收本人前缀；worker 只收 QA 桶 platform-qa/ 下的对象（任务会读取并删除该对象）。 */
const B = "qa-bucket";

it("入队：别人前缀、旧的无主格式、别的桶、别的目录、越界、https 一律拒绝；本人前缀返回规范地址", () => {
  for (const uri of [
    "gs://qa-bucket/platform-qa/u8/1-abc.pdf",
    "gs://qa-bucket/platform-qa/u77/1-abc.pdf",
    "gs://qa-bucket/platform-qa/1-abc.pdf",
    "gs://other-bucket/platform-qa/u7/1-abc.pdf",
    "gs://qa-bucket/uploads/u7/secret.mp4",
    "gs://qa-bucket/platform-qa/u7/../u8/1.pdf",
    "gs://qa-bucket/platform-qa/u7/sub/1.pdf",
    "gs://qa-bucket/platform-qa/u7/",
    "https://storage.googleapis.com/qa-bucket/platform-qa/u7/1.pdf",
    "https://evil.example/a.pdf",
  ]) {
    expect(() => assertOwnPlatformQaFileUri(uri, 7, B), uri).toThrow("platform_qa_file_not_allowed");
  }
  expect(assertOwnPlatformQaFileUri(` gs://qa-bucket/${platformQaUserPrefix(7)}1762-AbC_d-1.pdf `, 7, B)).toBe("gs://qa-bucket/platform-qa/u7/1762-AbC_d-1.pdf");
  expect(() => platformQaUserPrefix("///")).toThrow("platform_qa_file_not_allowed");
});

it("worker：只收 QA 桶 platform-qa/ 下的附件（新旧两种格式），其余不读不删", () => {
  for (const uri of [
    "gs://other-bucket/platform-qa/u7/1.pdf",
    "gs://qa-bucket/uploads/u7/secret.mp4",
    "gs://qa-bucket/pdf-async/html/7/1.html",
    "gs://qa-bucket/platform-qa/../uploads/u7/secret.mp4",
    "gs://qa-bucket/platform-qa/u7/../../uploads/x.mp4",
    "gs://qa-bucket/platform-qa/a/b/c.pdf",
    "gs://qa-bucket/platform-qa/notuser/1.pdf/",
    "gs://qa-bucket/platform-qa/",
    "https://evil.example/a.pdf",
    "",
  ]) {
    expect(() => assertPlatformQaWorkerFileUri(uri, B), uri).toThrow("platform_qa_file_not_allowed");
  }
  expect(assertPlatformQaWorkerFileUri("gs://qa-bucket/platform-qa/u7/1-a.pdf", B)).toEqual({ bucket: B, objectName: "platform-qa/u7/1-a.pdf", gcsUri: "gs://qa-bucket/platform-qa/u7/1-a.pdf" });
  expect(assertPlatformQaWorkerFileUri("gs://qa-bucket/platform-qa/1762000000000-abcd1234.pdf", B).objectName).toBe("platform-qa/1762000000000-abcd1234.pdf");
});

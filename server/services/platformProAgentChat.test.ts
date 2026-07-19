import { describe, expect, it } from "vitest";
import { buildProAgentInputParts } from "./platformProAgentChat.js";

describe("buildProAgentInputParts", () => {
  it("maps PDF to input_file with detail auto", () => {
    const parts = buildProAgentInputParts({
      transcript: "请分析这份 PDF",
      attachments: [
        {
          name: "brief.pdf",
          mimeType: "application/pdf",
          dataBase64: "data:application/pdf;base64,JVBERi0xLjQ=",
          byteLength: 12,
        },
      ],
    });
    expect(parts[0]).toMatchObject({ type: "input_text", text: "请分析这份 PDF" });
    expect(parts[1]).toMatchObject({
      type: "input_file",
      filename: "brief.pdf",
      file_data: "data:application/pdf;base64,JVBERi0xLjQ=",
      detail: "auto",
    });
  });

  it("maps images to input_image", () => {
    const parts = buildProAgentInputParts({
      transcript: "看图",
      attachments: [
        {
          name: "shot.png",
          mimeType: "image/png",
          dataBase64: "data:image/png;base64,iVBORw0KGgo=",
        },
      ],
    });
    expect(parts[1]).toMatchObject({
      type: "input_image",
      image_url: "data:image/png;base64,iVBORw0KGgo=",
    });
  });

  it("rejects video with clear message", () => {
    expect(() =>
      buildProAgentInputParts({
        transcript: "看视频",
        attachments: [
          {
            name: "clip.mp4",
            mimeType: "video/mp4",
            dataBase64: "data:video/mp4;base64,AAAA",
          },
        ],
      }),
    ).toThrow(/视频/);
  });
});

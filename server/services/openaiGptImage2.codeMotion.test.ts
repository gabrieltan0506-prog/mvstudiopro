import { afterEach, expect, it, vi } from "vitest";
const upload = vi.hoisted(() =>
  vi.fn(async () => "https://example.test/generated/image.png")
);
vi.mock("./evolinkGptImage2.js", () => ({
  uploadBufferToPlatformStorage: upload,
}));
vi.mock("./manhuaKeyartPadReference.js",()=>({padImageBufferToSize:async(buffer:Buffer)=>buffer}));
vi.mock("./openaiImageKeyPool.js", () => ({
  resolveOpenAiImageKeyChain: () => [
    { key: "test-key", slot: "test" },
    { key: "test-key-2", slot: "test2" },
  ],
  shouldRetryOpenAiImageWithOtherKey: () => true,
}));
import { postOpenAiGptImage2AndUpload } from "./openaiGptImage2";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

it("free exact model and medium quality survive global Flare/quality overrides; raw response is saved before upload", async () => {
  vi.stubEnv("OPENAI_GPT_IMAGE2_MODEL", "gpt-image-2.5-flare");
  vi.stubEnv("GPT_IMAGE2_QUALITY", "max");
  let saved = false;
  const fetchMock = vi.fn(async (_url, request) => {
    expect(JSON.parse(request.body)).toMatchObject({
      model: "gpt-image-2-2026-04-21",
      quality: "medium",
    });
    return new Response(
      JSON.stringify({
        data: [
          { b64_json: Buffer.from("TEST_ONLY_NOT_IMAGE").toString("base64") },
        ],
      }),
      { status: 200 }
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  upload.mockImplementationOnce(async () => {
    expect(saved).toBe(true);
    return "https://example.test/generated/image.png";
  });
  await expect(
    postOpenAiGptImage2AndUpload("场景", "code-motion/test", {
      exactModel: "gpt-image-2-2026-04-21",
      quality: "medium",
      strictRequest: true,
      persistResponse: async reply => {
        expect(JSON.parse(reply.body).data).toHaveLength(1);
        saved = true;
      },
    })
  ).resolves.toBe("https://example.test/generated/image.png");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("paid Sunburst is exact; ambiguous submit and receipt-save failure stop without second key or duplicate purchase", async () => {
  vi.stubEnv("OPENAI_GPT_IMAGE2_MODEL", "gpt-image-2.5-flare");
  const fetchMock = vi.fn(async (_url, request) => {
    expect(JSON.parse(request.body).model).toBe("gpt-image-2.5-sunburst");
    return new Response(JSON.stringify({ data: [{ b64_json: "dGVzdA==" }] }), {
      status: 200,
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  await expect(
    postOpenAiGptImage2AndUpload("场景", "code-motion/test", {
      exactModel: "gpt-image-2.5-sunburst",
      strictRequest: true,
      persistResponse: async () => {
        throw Error("receipt storage down");
      },
    })
  ).rejects.toMatchObject({ kind: "unknown" });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(upload).not.toHaveBeenCalled();
});

it.each([ ["gpt-image-2-2026-04-21","medium"], ["gpt-image-2.5-sunburst","high"] ] as const)("%s reference edit uses exact model/quality and both original images once",async(model,quality)=>{
  vi.stubEnv("OPENAI_GPT_IMAGE2_MODEL","gpt-image-2.5-flare");
  let edits=0;
  const fetchMock=vi.fn(async(url:string,request?:RequestInit)=>{
    if(url.includes("/reference/"))return new Response(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
    expect(url).toContain("/v1/images/edits");edits++;
    const body=(request!.body as Buffer).toString();
    expect(body).toContain(model);expect(body).toContain(quality);
    expect(body.match(/name="image\[\]"/g)).toHaveLength(2);
    return new Response(JSON.stringify({data:[{b64_json:"dGVzdA=="}]}),{status:200});
  });
  vi.stubGlobal("fetch",fetchMock);
  await postOpenAiGptImage2AndUpload("保留原图身份修复画幅","code-motion/test",{exactModel:model,quality,strictRequest:true,imageUrls:["https://fixture.test/reference/1","https://fixture.test/reference/2"],persistResponse:async()=>{}});
  expect(edits).toBe(1);expect(fetchMock).toHaveBeenCalledTimes(3);
});

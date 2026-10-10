import { afterEach, describe, expect, it, vi } from "vitest";
import { submitEvolinkSeedanceVideo } from "./evolinkSeedanceVideo";
const input = {
  version: "2.0-mini" as const,
  mode: "reference_to_video" as const,
  prompt: "技术图移动",
  imageUrls: ["https://example.test/ref.png"],
  audioUrls: ["https://example.test/ref.wav"],
  duration: 5,
  quality: "480p" as const,
};
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("EvoLink submit receipt boundary (fake HTTP, no paid generation)", () => {
  it("archives the exact HTTP body before returning the task handle", async () => {
    vi.stubEnv("EVOLINK_API_KEY", "technical-fixture-not-a-secret");
    const body = '{"id":"fixture-id","status":"pending","usage":{"cost":0}}';
    const seen: unknown[] = [];
    const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      seen.push(JSON.parse(String(init?.body)));
      return new Response(body, { status: 200 });
    });
    vi.stubGlobal("fetch", fetch);
    const result = await submitEvolinkSeedanceVideo({
      ...input,
      persistSubmitReceipt: async receipt => {
        seen.push(receipt);
      },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(seen[0]).toMatchObject({
      model: "seedance-2.0-mini-reference-to-video",
      quality: "480p",
      duration: 5,
      audio_urls: input.audioUrls,
    });
    expect(seen[1]).toEqual({ status: 200, body });
    expect(result.evolinkTaskId).toBe("fixture-id");
  });
  it.each([400, 429, 500])(
    "persists %s evidence and distinguishes only definitive rejection",
    async status => {
      vi.stubEnv("EVOLINK_API_KEY", "technical-fixture-not-a-secret");
      const body = JSON.stringify({ error: { message: `fixture-${status}` } });
      const receipt = vi.fn(async () => {});
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(body, { status }))
      );
      const result = await submitEvolinkSeedanceVideo({
        ...input,
        persistSubmitReceipt: receipt,
      }).catch(error => error);
      expect(receipt).toHaveBeenCalledWith({ status, body });
      expect(result.message).toBe(`fixture-${status}`);
      expect(result.kind).toBe(status === 400 ? "rejected" : undefined);
    }
  );
});

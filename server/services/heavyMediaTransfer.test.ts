import { afterEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { withHeavyMediaContext } from "../jobs/heavyMediaContext";
vi.mock("./gcs", () => ({
  getGcsBucketName: () => "offline",
  signGsUriV4ReadUrl: () => "https://fixture.invalid/source",
  uploadStreamToGcs: vi.fn(),
}));
import { materializeHeavyMediaSource } from "./heavyLearnMedia";
afterEach(() => vi.unstubAllGlobals());
const bytes = Buffer.from("offline source bytes");
const uri = `gs://offline/heavy-media-sources/u7/${createHash("sha256").update(bytes).digest("hex")}.mp4`;
const run = (work: () => Promise<unknown>) =>
  withHeavyMediaContext({ userId: "7", executionId: "transfer" }, work);
it("streams owned object bytes and validates SHA before native work, then removes only temporary media", async () => {
  let temporary = "";
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(bytes, {
          headers: { "content-length": String(bytes.length) },
        })
    )
  );
  await run(() =>
    materializeHeavyMediaSource(uri, async file => {
      temporary = file;
      expect(await readFile(file)).toEqual(bytes);
      return true;
    })
  );
  await expect(stat(temporary)).rejects.toMatchObject({ code: "ENOENT" });
});
it("foreign ownership, corrupt bytes and oversized transfer never reach native preparation", async () => {
  const work = vi.fn();
  const fetch = vi.fn(async () => new Response("wrong bytes"));
  vi.stubGlobal("fetch", fetch);
  await expect(
    run(() => materializeHeavyMediaSource(uri.replace("u7/", "u8/"), work))
  ).rejects.toThrow("source");
  expect(fetch).not.toHaveBeenCalled();
  await expect(
    run(() => materializeHeavyMediaSource(uri, work))
  ).rejects.toThrow("integrity");
  fetch.mockImplementationOnce(
    async () =>
      new Response("small", {
        headers: { "content-length": String(801 * 1024 * 1024) },
      })
  );
  await expect(
    run(() => materializeHeavyMediaSource(uri, work))
  ).rejects.toThrow("limits");
  expect(work).not.toHaveBeenCalled();
});

import { describe, expect, it, vi } from "vitest";
import { analyzeImageWorld } from "./imageWorldAnalysis";
function fixture() {
  const store = new Map<string, Buffer>(),
    local = new Map<string, Buffer>(),
    events: string[] = [];
  const raw = {
    choices: [
      {
        finish_reason: "stop",
        message: {
          content: JSON.stringify({
            scene: "暖光木桌",
            ambience: "室内静音",
            objects: [
              {
                id: "cup-left",
                name: "杯",
                description: "白瓷",
                position: "左边",
                selected: true,
              },
              {
                id: "cup-right",
                name: "杯",
                description: "黑陶",
                position: "右边",
                selected: true,
              },
            ],
          }),
        },
      },
    ],
  };
  const deps = {
    spool: vi.fn(async (name: string, buffer: Buffer) => {
      local.set(name, Buffer.from(buffer));
    }),
    local: vi.fn(async (name: string) => local.get(name) ?? null),
    resolve: vi.fn(async ({ source }: { source: string }) => source),
    bucket: () => "offline",
    sign: () => "https://offline.invalid/image",
    create: vi.fn(
      async ({
        objectName,
        buffer,
      }: {
        objectName: string;
        buffer: Buffer;
      }) => {
        if (store.has(objectName)) return { created: false };
        store.set(objectName, buffer);
        return { created: true };
      }
    ),
    save: vi.fn(
      async ({
        objectName,
        buffer,
      }: {
        objectName: string;
        buffer: Buffer;
      }) => {
        store.set(objectName, buffer);
        events.push(objectName.split("/").at(-1)!);
        return {
          gcsUri: `gs://offline/${objectName}`,
          bucket: "offline",
          objectName,
        };
      }
    ),
    read: vi.fn(async ({ gcsUri }: { gcsUri: string }) => {
      const objectName = gcsUri.replace("gs://offline/", "");
      if (!store.has(objectName))
        throw new Error("gcs_download_failed:404:not_found");
      return { buffer: store.get(objectName)!, bucket: "offline", objectName };
    }),
    invoke: vi.fn(async (_input: any, audit: any) => {
      expect(audit.singleAttempt).toBe(true);
      await audit.onPreparedRequest(
        { messages: [{ content: "test" }] },
        "OpenAI"
      );
      await audit.onRawCompletion({
        text: JSON.stringify(raw),
        status: 200,
        contentType: "application/json",
        route: "OpenAI",
      });
      return raw.choices[0].message.content;
    }),
  };
  return { deps, store, local, events, raw };
}
describe("one-shot image analysis", () => {
  it("permanently stores raw before parsed, keeps both objects and resumes without another model call", async () => {
    const f = fixture(),
      input = { requestId: "request", sourceUri: "gs://owned/image.png" };
    const a = await analyzeImageWorld(7, input, f.deps as any);
    const b = await analyzeImageWorld(7, input, f.deps as any);
    expect(a.objectCount).toBe(2);
    expect(b.text).toBe(a.text);
    expect(f.deps.invoke).toHaveBeenCalledTimes(1);
    expect(f.events.indexOf("response.raw.json")).toBeLessThan(
      f.events.indexOf("response.parsed.json")
    );
    expect(a.evidence.every(e => e.bytes > 0 && e.sha256.length === 64)).toBe(
      true
    );
    await expect(
      analyzeImageWorld(
        7,
        { ...input, sourceUri: "gs://owned/other.png" },
        f.deps as any
      )
    ).rejects.toThrow("更换来源");
  });
  it("unknown upstream result and archive failure cannot buy a second call", async () => {
    const f = fixture();
    f.deps.invoke.mockRejectedValue(new Error("network unknown"));
    const input = { requestId: "unknown", sourceUri: "gs://owned/image.png" };
    await expect(analyzeImageWorld(7, input, f.deps as any)).rejects.toThrow(
      "network unknown"
    );
    await expect(analyzeImageWorld(7, input, f.deps as any)).rejects.toThrow(
      "未重复调用"
    );
    expect(f.deps.invoke).toHaveBeenCalledTimes(1);
  });
  it("recovers a raw response after interruption without re-sending or losing an object", async () => {
    const f = fixture();
    const save = f.deps.save.getMockImplementation()!;
    let reject = true;
    f.deps.save.mockImplementation(async p => {
      if (p.objectName.endsWith("analysis.parsed.json") && reject) {
        reject = false;
        throw new Error("archive failure");
      }
      return save(p);
    });
    const input = { requestId: "resume", sourceUri: "gs://owned/image.png" };
    await expect(analyzeImageWorld(7, input, f.deps as any)).rejects.toThrow(
      "archive failure"
    );
    expect((await analyzeImageWorld(7, input, f.deps as any)).objectCount).toBe(
      2
    );
    expect(f.deps.invoke).toHaveBeenCalledTimes(1);
  });
});

it("status never creates a missing intent; local raw survives a cloud archive outage", async () => {
  const f = fixture(),
    input = { requestId: "local-recovery", sourceUri: "gs://owned/image.png" };
  await expect(
    analyzeImageWorld(7, input, f.deps as any, true)
  ).rejects.toThrow("未找到");
  expect(f.deps.create).not.toHaveBeenCalled();
  expect(f.deps.invoke).not.toHaveBeenCalled();
  const save = f.deps.save.getMockImplementation()!;
  let failed = false;
  f.deps.save.mockImplementation(async p => {
    if (!failed && p.objectName.endsWith("response.raw.json")) {
      failed = true;
      throw new Error("cloud outage");
    }
    return save(p);
  });
  await expect(analyzeImageWorld(7, input, f.deps as any)).rejects.toThrow(
    "cloud outage"
  );
  expect(
    Array.from(f.local.keys()).some(k => k.endsWith("response.raw.json"))
  ).toBe(true);
  expect(
    (await analyzeImageWorld(7, input, f.deps as any, true)).objectCount
  ).toBe(2);
  expect(f.deps.invoke).toHaveBeenCalledTimes(1);
  expect(f.deps.create).toHaveBeenCalledTimes(1);
});
it("local disk failure does not prevent the independent permanent cloud copy", async () => {
  const f = fixture();
  f.deps.spool.mockRejectedValue(new Error("disk full"));
  const output = await analyzeImageWorld(
    7,
    { requestId: "cloud-only", sourceUri: "gs://owned/image.png" },
    f.deps as any
  );
  expect(output.objectCount).toBe(2);
  expect(
    Array.from(f.store.keys()).some(k => k.endsWith("response.raw.json"))
  ).toBe(true);
  expect(f.deps.invoke).toHaveBeenCalledTimes(1);
});

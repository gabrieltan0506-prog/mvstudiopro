/** User-authorized fixed probe: two tiers × six images; no retries or replacement jobs. Fly-only. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import sharp from "sharp";
import { postOpenAiGptImage2AndUpload } from "../server/services/openaiGptImage2";
import {
  uploadBufferToGcs,
  inspectGcsObjectBounded,
  signGsUriV4ReadUrl,
  getGcsBucketName,
} from "../server/services/gcs";
import { codeMotionProjectSchema } from "../shared/codeMotion";
import {
  codeMotionImagePrompts,
  codeMotionImagePolicy,
} from "../shared/codeMotionImageProduction";
if (!process.env.FLY_APP_NAME)
  throw Error("This authorized probe runs only inside the existing Fly rig.");
const dir = path.resolve(process.argv[2] || "/tmp/pr1697-ruixin-probe"),
  out = path.join(dir, "images");
await mkdir(out, { recursive: true });
const run = "pr1697-ruixin-20261010",
  hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");
async function archive(name: string, value: unknown) {
  const bytes = Buffer.from(JSON.stringify(value, null, 2));
  await writeFile(path.join(out, name), bytes, { flag: "wx" });
  return uploadBufferToGcs({
    objectName: `code-motion/probes/${run}/images/${name}`,
    buffer: bytes,
    contentType: "application/json",
    ifGenerationMatch: "0",
  });
}
async function one(tier: "free" | "paid", index: number, anchor?: string) {
  const project = codeMotionProjectSchema.parse(
      JSON.parse(
        await readFile(
          path.join(dir, `${tier}.normalized.project.json`),
          "utf8"
        )
      )
    ),
    shot = codeMotionImagePrompts(project)[index],
    policy = codeMotionImagePolicy(tier, index);
  const name = `${tier}-${index}`,
    request = {
      run,
      tier,
      index,
      projectId: project.id,
      ...shot,
      ...policy,
      aspectRatio: "9:16",
      references: anchor ? [anchor] : [],
      requestedAt: new Date().toISOString(),
      retryPolicy: "none",
      scope: "one of six images for this tier; reference identity continuity",
    };
  try {
    const previous = JSON.parse(
      await readFile(path.join(out, `${name}.result.json`), "utf8")
    );
    console.log(JSON.stringify({ event: "restore", tier, index, ...previous }));
    return previous.gcsUri as string;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  // Local + permanent create-only intent precedes the paid model call. Any partial/unknown attempt blocks rerun.
  await archive(`${name}.request.json`, request);
  const log: string[] = [],
    captureError: { message?: string } = {};
  console.log(
    JSON.stringify({
      event: "submit",
      tier,
      index,
      model: policy.model,
      quality: policy.quality,
      hasAnchor: !!anchor,
    })
  );
  try {
    const image = await postOpenAiGptImage2AndUpload(
      shot.prompt,
      `code-motion/probes/${run}/images/${tier}`,
      {
        exactModel: policy.model,
        quality: policy.quality,
        aspectRatio: "9:16",
        strictRequest: true,
        lane: "keyart",
        imageUrls: anchor ? [signGsUriV4ReadUrl(anchor, 3600)] : undefined,
        flowLog: log,
        captureError,
        persistResponse: async response => {
          await archive(`${name}.raw.json`, response);
        },
      }
    );
    if (!image)
      throw Error(
        captureError.message ||
          "No generated image returned; request is not retried."
      );
    let uri = image;
    if (uri.startsWith("https://storage.googleapis.com/"))
      uri =
        "gs://" +
        uri.slice("https://storage.googleapis.com/".length).split("?")[0];
    let bytes: Buffer;
    if (uri.startsWith("gs://")) {
      const chunks: Buffer[] = [];
      await inspectGcsObjectBounded({
        gcsUri: uri,
        maxBytes: 20 * 1024 * 1024,
        timeoutMs: 30000,
        onChunk: b => {
          chunks.push(Buffer.from(b));
        },
      });
      bytes = Buffer.concat(chunks);
    } else {
      const response = await fetch(image, {
        signal: AbortSignal.timeout(60000),
      });
      if (!response.ok)
        throw Error(`Generated output download HTTP ${response.status}`);
      bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > 20 * 1024 * 1024)
        throw Error("Generated output exceeds size bound");
    }
    const metadata = await sharp(bytes).metadata();
    const archived = await uploadBufferToGcs({
      objectName: `code-motion/probes/${run}/images/${tier}/${index}-${hash(bytes)}.png`,
      buffer: bytes,
      contentType: metadata.format === "jpeg" ? "image/jpeg" : "image/png",
      ifGenerationMatch: "0",
    });
    uri = archived.gcsUri;
    await writeFile(path.join(out, `${name}.png`), bytes, { flag: "wx" });
    const result = {
      tier,
      sceneIndex: index,
      gcsUri: uri,
      sha256: hash(bytes),
      bytes: bytes.length,
      width: metadata.width,
      height: metadata.height,
      model: policy.model,
      quality: policy.quality,
      referenceAnchor: anchor || null,
      completedAt: new Date().toISOString(),
      classification:
        "real provider output via production image service; not authenticated router or online acceptance",
    };
    await archive(`${name}.result.json`, result);
    await archive(`${name}.flow.json`, { log });
    console.log(JSON.stringify({ event: "succeeded", ...result }));
    return uri;
  } catch (error) {
    await archive(`${name}.failure.json`, {
      tier,
      index,
      error: error instanceof Error ? error.message : String(error),
      retries: 0,
      at: new Date().toISOString(),
    });
    console.log(
      JSON.stringify({
        event: "failed",
        tier,
        index,
        error: error instanceof Error ? error.message : String(error),
      })
    );
    throw error;
  }
}
const heartbeat = setInterval(
  () =>
    console.log(
      JSON.stringify({ event: "heartbeat", at: new Date().toISOString() })
    ),
  30000
);
try {
  const outcomes = await Promise.allSettled(
    (["free", "paid"] as const).map(async tier => {
      const anchor = await one(tier, 0);
      for (const group of [[2, 3], [1, 4], [5]]) {
        const results = await Promise.allSettled(
          group.map(index => one(tier, index, anchor))
        );
        if (results.some(r => r.status === "rejected"))
          throw Error(
            `${tier}: a fixed image failed; no extra images or retry issued`
          );
      }
    })
  );
  await archive("summary.json", {
    run,
    outcomes: outcomes.map((x, i) => ({
      tier: i === 0 ? "free" : "paid",
      status: x.status,
      ...(x.status === "rejected" ? { error: String(x.reason) } : {}),
    })),
    completedAt: new Date().toISOString(),
    maximumImages: 12,
  });
  if (outcomes.some(x => x.status === "rejected")) process.exitCode = 1;
} finally {
  clearInterval(heartbeat);
}

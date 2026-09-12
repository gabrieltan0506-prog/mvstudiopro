/** 只能在 Fly 服务端执行；默认清点，不删除源。SDK 令牌只读取服务端环境。 */
import { randomUUID } from "node:crypto";
import { mkdir, open } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { list, head, get } from "@vercel/blob";
import {
  getGcsBucketName,
  uploadBufferToGcsIfAbsent,
  statGcsObjectVersion,
  inspectGcsObjectBounded,
} from "../services/gcs.js";
import {
  hashBytes,
  MigrationFailure,
  runBlobGcsMigration,
  validateMigrationOptions,
  type MigrationOptions,
} from "./blobGcsMigration.js";

export function parseMigrationArgs(args: string[]) {
  const options: MigrationOptions & {
    access: "public" | "private";
    store: "MVSP" | "BLOB";
  } = {
    copy: false,
    maxObjectBytes: 64 * 1024 * 1024,
    maxTransferBytes: 1024 * 1024 * 1024,
    delayMs: 250,
    access: "public",
    store: "MVSP",
  };
  const keys: Record<
    string,
    "maxObjectBytes" | "maxTransferBytes" | "delayMs"
  > = {
    "--max-object-bytes": "maxObjectBytes",
    "--max-transfer-bytes": "maxTransferBytes",
    "--delay-ms": "delayMs",
  };
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key === "--copy") {
      options.copy = true;
      continue;
    }
    const value = args[++i];
    if (key === "--access" && (value === "public" || value === "private"))
      options.access = value;
    else if (key === "--store" && (value === "MVSP" || value === "BLOB"))
      options.store = value;
    else if (keys[key] && /^\d+$/.test(value || ""))
      options[keys[key]] = Number(value);
    else throw new MigrationFailure("invalid_arguments");
  }
  validateMigrationOptions(options);
  return options;
}

export async function migrationMain(args: string[]) {
  // 参数先白名单校验；拒绝 --token 等输入且错误信息不回显参数。
  const options = parseMigrationArgs(args);
  if (
    process.env.FLY_APP_NAME !== "mvstudiopro" ||
    !process.env.FLY_MACHINE_ID?.trim()
  )
    throw new MigrationFailure("fly_server_required");
  const token =
    options.store === "MVSP"
      ? process.env.MVSP_READ_WRITE_TOKEN
      : process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new MigrationFailure("missing_blob_token");
  const runId = randomUUID();
  const directory = `/data/blob-gcs-migration/${runId}`;
  await mkdir(directory, { recursive: true });
  const bucket = getGcsBucketName();
  let sequence = 0;
  const signal = () => AbortSignal.timeout(120_000);
  const record = async (kind: string, value: unknown) => {
    const name = `${String(++sequence).padStart(8, "0")}-${kind}.json`;
    const bytes = Buffer.from(JSON.stringify(value, null, 2));
    const file = await open(`${directory}/${name}`, "wx", 0o600);
    try {
      await file.writeFile(bytes);
      await file.sync();
    } finally {
      await file.close();
    }
    const objectName = `blob-migration/evidence/${runId}/${name}`;
    const receipt = await uploadBufferToGcsIfAbsent({
      objectName,
      buffer: bytes,
      contentType: "application/json",
      bucket,
      signal: signal(),
    });
    if (!receipt.created) throw new MigrationFailure("evidence_name_collision");
    const localReceipt = await open(
      `${directory}/${name}.receipt.json`,
      "wx",
      0o600
    );
    try {
      await localReceipt.writeFile(
        JSON.stringify({
          objectName,
          gcsUri: `gs://${bucket}/${objectName}`,
          bytes: bytes.length,
          sha256: hashBytes(bytes),
          generation: receipt.generation,
        })
      );
      await localReceipt.sync();
    } finally {
      await localReceipt.close();
    }
  };
  await record("run", {
    runId,
    options,
    targetBucket: bucket,
    sourceStoreVariable:
      options.store === "MVSP"
        ? "MVSP_READ_WRITE_TOKEN"
        : "BLOB_READ_WRITE_TOKEN",
    concurrency: 1,
    sourceDeleted: 0,
  });
  try {
    const summary = await runBlobGcsMigration(options, {
      list: cursor =>
        list({
          token,
          cursor,
          limit: 100,
          mode: "expanded",
          abortSignal: signal(),
        }),
      head: entry => head(entry.url, { token, abortSignal: signal() }),
      read: async (entry, maxBytes) => {
        const response = await get(entry.url, {
          token,
          access: options.access,
          // Fly 实测：SDK 2.3.0 的 false 会附加 cache=0，当前 Blob 返回400。
          // 保留默认缓存访问；身份一致性由响应ETag、多次head及GCS generation验真保证。
          useCache: true,
          headers: { "If-Match": entry.etag },
          abortSignal: signal(),
        });
        if (!response || response.statusCode !== 200)
          throw new MigrationFailure("source_read_not_200");
        const reader = response.stream.getReader();
        try {
          if (
            response.blob.etag !== entry.etag ||
            response.blob.size !== entry.size ||
            response.blob.pathname !== entry.pathname
          )
            throw new MigrationFailure("source_get_identity_changed");
          const chunks: Buffer[] = [];
          let length = 0;
          while (true) {
            const item = await reader.read();
            if (item.done) break;
            length += item.value.length;
            if (length > maxBytes || length > entry.size)
              throw new MigrationFailure("source_size_exceeded");
            chunks.push(Buffer.from(item.value));
          }
          return {
            bytes: Buffer.concat(chunks, length),
            etag: response.blob.etag,
            pathname: response.blob.pathname,
          };
        } finally {
          await reader.cancel().catch(() => undefined);
          reader.releaseLock();
        }
      },
      create: (objectName, buffer, contentType) =>
        uploadBufferToGcsIfAbsent({
          objectName,
          buffer,
          contentType,
          bucket,
          signal: signal(),
        }),
      inspect: async (objectName, maxBytes) => {
        const gcsUri = `gs://${bucket}/${objectName}`;
        const before = await statGcsObjectVersion({ gcsUri, signal: signal() });
        const result = await inspectGcsObjectBounded({
          gcsUri,
          maxBytes,
          generation: before.generation,
          signal: signal(),
        });
        const after = await statGcsObjectVersion({ gcsUri, signal: signal() });
        if (before.generation !== after.generation)
          throw new MigrationFailure("target_generation_changed");
        return {
          generation: before.generation,
          bytes: result.byteLength,
          sha256: result.sha256,
        };
      },
      record,
      pause: ms => new Promise(resolve => setTimeout(resolve, ms)),
    });
    console.log(JSON.stringify({ directory, ...summary }));
    if (summary.failed || summary.pending) process.exitCode = 2;
  } catch (error) {
    await record("fatal", {
      error:
        error instanceof MigrationFailure ? error.message : "operation_failed",
    }).catch(() => undefined);
    throw new MigrationFailure(
      error instanceof MigrationFailure ? error.message : "operation_failed"
    );
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  migrationMain(process.argv.slice(2)).catch(error => {
    console.error(
      error instanceof MigrationFailure ? error.message : "operation_failed"
    );
    process.exitCode = 1;
  });
}

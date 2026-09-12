/** Blob 迁移准备：只清点或复制验真；不提供删除源对象的能力。 */
import { createHash } from "node:crypto";

export type BlobEntry = {
  url: string;
  pathname: string;
  size: number;
  etag: string;
  uploadedAt: Date | string;
};
export type BlobPage = {
  blobs: BlobEntry[];
  hasMore: boolean;
  cursor?: string;
};
export type BlobHead = BlobEntry & { contentType: string };
export type MigrationOptions = {
  copy: boolean;
  maxObjectBytes: number;
  maxTransferBytes: number;
  delayMs: number;
};
export type MigrationDeps = {
  list: (cursor?: string) => Promise<BlobPage>;
  head: (entry: BlobEntry) => Promise<BlobHead>;
  read: (
    entry: BlobHead,
    maxBytes: number
  ) => Promise<{ bytes: Buffer; etag: string; pathname: string }>;
  create: (
    objectName: string,
    bytes: Buffer,
    contentType: string
  ) => Promise<{ created: boolean; generation?: string }>;
  inspect: (
    objectName: string,
    maxBytes: number
  ) => Promise<{ generation: string; bytes: number; sha256: string }>;
  record: (kind: string, value: unknown) => Promise<void>;
  pause: (milliseconds: number) => Promise<void>;
};
export const hashBytes = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
export class MigrationFailure extends Error {}
function assert(condition: unknown, code: string): asserts condition {
  if (!condition) throw new MigrationFailure(code);
}
function same(a: BlobEntry, b: BlobEntry) {
  return (
    a.url === b.url &&
    a.pathname === b.pathname &&
    a.size === b.size &&
    a.etag === b.etag &&
    new Date(a.uploadedAt).getTime() === new Date(b.uploadedAt).getTime()
  );
}
function valid(entry: BlobEntry) {
  let url: URL;
  try {
    url = new URL(entry.url);
  } catch {
    throw new MigrationFailure("invalid_source_url");
  }
  assert(
    url.protocol === "https:" &&
      /\.blob\.vercel-storage\.com$/.test(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash,
    "invalid_source_url"
  );
  assert(
    typeof entry.pathname === "string" &&
      entry.pathname.length > 0 &&
      Number.isSafeInteger(entry.size) &&
      entry.size >= 0 &&
      typeof entry.etag === "string" &&
      entry.etag.length > 0 &&
      Number.isFinite(new Date(entry.uploadedAt).getTime()),
    "invalid_source_identity"
  );
}
export function validateMigrationOptions(options: MigrationOptions) {
  assert(
    Number.isSafeInteger(options.maxObjectBytes) &&
      options.maxObjectBytes > 0 &&
      options.maxObjectBytes <= 256 * 1024 * 1024,
    "invalid_object_limit"
  );
  assert(
    Number.isSafeInteger(options.maxTransferBytes) &&
      options.maxTransferBytes > 0 &&
      Number.isSafeInteger(options.delayMs) &&
      options.delayMs >= 0 &&
      options.delayMs <= 60_000,
    "invalid_batch_limit"
  );
}
export async function runBlobGcsMigration(
  options: MigrationOptions,
  deps: MigrationDeps
) {
  validateMigrationOptions(options);
  const summary = {
    mode: options.copy ? "copy" : "inventory",
    pages: 0,
    listed: 0,
    copied: 0,
    resumed: 0,
    pending: 0,
    failed: 0,
    transferReservedBytes: 0,
    inventoryComplete: false,
    sourceDeleted: 0,
  };
  const cursors = new Set<string>();
  const seen = new Map<string, string>();
  let cursor: string | undefined;
  do {
    const page = await deps.list(cursor);
    // 必须先持久化原始 SDK 页，不先过滤、抽样或消费。
    await deps.record("list-page", {
      requestCursor: cursor ?? null,
      response: page,
    });
    assert(
      Array.isArray(page.blobs) && typeof page.hasMore === "boolean",
      "invalid_list_page"
    );
    summary.pages++;
    for (const entry of page.blobs) {
      summary.listed++;
      let result: Record<string, unknown> = {
        source: entry,
        status: "inventoried",
      };
      try {
        valid(entry);
        const identity = hashBytes(
          JSON.stringify([
            entry.pathname,
            entry.size,
            entry.etag,
            new Date(entry.uploadedAt).toISOString(),
          ])
        );
        const previous = seen.get(entry.url);
        assert(
          !previous || previous === identity,
          "source_changed_between_pages"
        );
        seen.set(entry.url, identity);
        if (previous) {
          result.status = "duplicate_identical";
        } else if (options.copy) {
          const requiredBytes = entry.size * 3;
          if (
            entry.size > options.maxObjectBytes ||
            requiredBytes >
              options.maxTransferBytes - summary.transferReservedBytes
          ) {
            summary.pending++;
            result.status = "pending_limit";
          } else {
            summary.transferReservedBytes += requiredBytes;
            const before = await deps.head(entry);
            assert(same(entry, before), "source_changed_before_read");
            const source = await deps.read(before, options.maxObjectBytes);
            assert(
              source.bytes.length === entry.size &&
                source.etag === entry.etag &&
                source.pathname === entry.pathname,
              "source_changed_during_read"
            );
            assert(
              same(entry, await deps.head(entry)),
              "source_changed_after_read"
            );
            const objectName = `blob-migration/objects/${hashBytes(entry.url)}`;
            const sha256 = hashBytes(source.bytes);
            // 在副作用前记录计划与源摘要，崩溃后仍能解释目标对象的来源。
            await deps.record("copy-plan", {
              source: entry,
              objectName,
              bytes: source.bytes.length,
              sha256,
            });
            const created = await deps.create(
              objectName,
              source.bytes,
              before.contentType
            );
            assert(
              !created.created ||
                Boolean(created.generation && /^\d+$/.test(created.generation)),
              "target_generation_missing"
            );
            const target = await deps.inspect(
              objectName,
              options.maxObjectBytes
            );
            assert(
              !created.generation || created.generation === target.generation,
              "target_generation_changed"
            );
            assert(
              target.bytes === entry.size && target.sha256 === sha256,
              "target_content_collision"
            );
            assert(
              same(entry, await deps.head(entry)),
              "source_changed_after_copy"
            );
            result = {
              source: entry,
              objectName,
              bytes: target.bytes,
              sha256,
              generation: target.generation,
              status: created.created ? "copied_verified" : "resumed_verified",
            };
            if (created.created) summary.copied++;
            else summary.resumed++;
          }
        }
      } catch (error) {
        summary.failed++;
        // SDK 异常可能携带请求细节；日志只记录白名单错误码，绝不序列化凭证或原始 Error。
        result = {
          ...result,
          status: "failed",
          error:
            error instanceof MigrationFailure
              ? error.message
              : "operation_failed",
        };
      }
      await deps.record("object-result", result);
      await deps.pause(options.delayMs);
    }
    if (!page.hasMore) {
      summary.inventoryComplete = true;
      break;
    }
    assert(
      typeof page.cursor === "string" &&
        page.cursor.length > 0 &&
        !cursors.has(page.cursor),
      "pagination_cursor_missing_or_repeated"
    );
    cursors.add(page.cursor);
    cursor = page.cursor;
    await deps.pause(options.delayMs);
  } while (true);
  await deps.record("summary", summary);
  return summary;
}

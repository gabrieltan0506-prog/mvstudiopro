import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { assertGrowthColdStoreChunkIntegrity } from "./trendStore";

describe("growth cold-store batch integrity", () => {
  it("接受大小与SHA-256都一致的分片", () => {
    const raw = Buffer.from("verified-part");
    expect(() => assertGrowthColdStoreChunkIntegrity("part-0000", raw, {
      bytes: raw.length,
      sha256: createHash("sha256").update(raw).digest("hex"),
    })).not.toThrow();
  });

  it("拒绝截断或内容被替换的分片", () => {
    const raw = Buffer.from("verified-part");
    const sha256 = createHash("sha256").update(raw).digest("hex");
    expect(() => assertGrowthColdStoreChunkIntegrity("truncated", raw.subarray(0, 4), {
      bytes: raw.length,
      sha256,
    })).toThrow("growth_cold_store_chunk_mismatch:truncated");
    expect(() => assertGrowthColdStoreChunkIntegrity("changed", Buffer.from("changed-part!"), {
      bytes: raw.length,
      sha256,
    })).toThrow("growth_cold_store_chunk_mismatch:changed");
  });
});

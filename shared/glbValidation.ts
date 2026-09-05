const GLB_HEADER_BYTES = 12;
const GLB_CHUNK_HEADER_BYTES = 8;
const GLB_JSON_CHUNK_TYPE = 0x4e4f534a;
const DEFAULT_MAX_JSON_BYTES = 64 * 1024 * 1024;

function copyInto(target: Uint8Array, targetOffset: number, source: Uint8Array): void {
  target.set(source, targetOffset);
}

function uint32Le(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}

/**
 * 有界、增量的 GLB 2.0 结构验证器。
 * 仅缓存 JSON chunk；二进制 chunk 边读边丢，避免为了验真把整个模型常驻内存。
 */
export class Glb2StreamValidator {
  private readonly header = new Uint8Array(GLB_HEADER_BYTES);
  private readonly chunkHeader = new Uint8Array(GLB_CHUNK_HEADER_BYTES);
  private readonly jsonParts: Uint8Array[] = [];
  private readonly maxJsonBytes: number;
  private headerFilled = 0;
  private chunkHeaderFilled = 0;
  private currentChunkRemaining = 0;
  private currentChunkIsJson = false;
  private chunkCount = 0;
  private jsonBytes = 0;
  private declaredLength = 0;
  private logicalOffset = 0;
  private totalReceived = 0;
  private finished = false;

  constructor(maxJsonBytes = DEFAULT_MAX_JSON_BYTES) {
    this.maxJsonBytes = Math.max(1, Math.floor(Number(maxJsonBytes) || DEFAULT_MAX_JSON_BYTES));
  }

  push(input: Uint8Array): void {
    if (this.finished) throw new Error("invalid_glb_state");
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    this.totalReceived += bytes.byteLength;
    let offset = 0;

    while (offset < bytes.byteLength) {
      if (this.headerFilled < GLB_HEADER_BYTES) {
        const take = Math.min(GLB_HEADER_BYTES - this.headerFilled, bytes.byteLength - offset);
        copyInto(this.header, this.headerFilled, bytes.subarray(offset, offset + take));
        this.headerFilled += take;
        offset += take;
        if (
          this.headerFilled >= 4 &&
          (this.header[0] !== 0x67 || this.header[1] !== 0x6c ||
            this.header[2] !== 0x54 || this.header[3] !== 0x46)
        ) {
          throw new Error("invalid_glb_magic");
        }
        if (this.headerFilled === GLB_HEADER_BYTES) {
          if (uint32Le(this.header, 4) !== 2) throw new Error("invalid_glb_header");
          this.declaredLength = uint32Le(this.header, 8);
          if (this.declaredLength < GLB_HEADER_BYTES + GLB_CHUNK_HEADER_BYTES) {
            throw new Error("invalid_glb_header");
          }
          this.logicalOffset = GLB_HEADER_BYTES;
          if (this.totalReceived > this.declaredLength) throw new Error("invalid_glb_header");
        }
        continue;
      }

      if (this.currentChunkRemaining > 0) {
        const take = Math.min(this.currentChunkRemaining, bytes.byteLength - offset);
        if (this.currentChunkIsJson) {
          this.jsonBytes += take;
          if (this.jsonBytes > this.maxJsonBytes) throw new Error("invalid_glb_json_too_large");
          this.jsonParts.push(bytes.slice(offset, offset + take));
        }
        offset += take;
        this.logicalOffset += take;
        this.currentChunkRemaining -= take;
        if (this.currentChunkRemaining === 0) {
          this.chunkCount += 1;
          this.currentChunkIsJson = false;
        }
        continue;
      }

      const take = Math.min(
        GLB_CHUNK_HEADER_BYTES - this.chunkHeaderFilled,
        bytes.byteLength - offset,
      );
      copyInto(this.chunkHeader, this.chunkHeaderFilled, bytes.subarray(offset, offset + take));
      this.chunkHeaderFilled += take;
      offset += take;
      if (this.chunkHeaderFilled !== GLB_CHUNK_HEADER_BYTES) continue;

      const chunkLength = uint32Le(this.chunkHeader, 0);
      const chunkType = uint32Le(this.chunkHeader, 4);
      if (chunkLength % 4 !== 0) throw new Error("invalid_glb_chunk");
      if (this.chunkCount === 0 && chunkType !== GLB_JSON_CHUNK_TYPE) {
        throw new Error("invalid_glb_json_chunk");
      }
      if (this.logicalOffset + GLB_CHUNK_HEADER_BYTES + chunkLength > this.declaredLength) {
        throw new Error("invalid_glb_chunk");
      }
      this.logicalOffset += GLB_CHUNK_HEADER_BYTES;
      this.chunkHeaderFilled = 0;
      this.currentChunkRemaining = chunkLength;
      this.currentChunkIsJson = this.chunkCount === 0;
      if (chunkLength === 0) {
        this.chunkCount += 1;
        this.currentChunkIsJson = false;
      }
    }

    if (this.declaredLength && this.totalReceived > this.declaredLength) {
      throw new Error("invalid_glb_header");
    }
  }

  finish(): void {
    if (this.finished) return;
    this.finished = true;
    if (this.headerFilled < GLB_HEADER_BYTES) throw new Error("invalid_glb_header");
    if (
      this.totalReceived !== this.declaredLength ||
      this.logicalOffset !== this.declaredLength ||
      this.chunkHeaderFilled !== 0 ||
      this.currentChunkRemaining !== 0 ||
      this.chunkCount < 1
    ) {
      throw new Error("invalid_glb_chunk");
    }

    try {
      const jsonBytes = new Uint8Array(this.jsonBytes);
      let offset = 0;
      for (const part of this.jsonParts) {
        jsonBytes.set(part, offset);
        offset += part.byteLength;
      }
      const text = new TextDecoder("utf-8", { fatal: true }).decode(jsonBytes).trim();
      const parsed = JSON.parse(text) as { asset?: { version?: unknown } } | null;
      if (!parsed || Array.isArray(parsed) || parsed.asset?.version !== "2.0") {
        throw new Error("invalid_glb_json");
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("invalid_glb_")) throw error;
      throw new Error("invalid_glb_json");
    }
  }
}

export function assertValidGlb2(bytes: Uint8Array): void {
  const validator = new Glb2StreamValidator();
  validator.push(bytes);
  validator.finish();
}

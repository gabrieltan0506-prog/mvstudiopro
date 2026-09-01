export type NativeProbeManifestSegment = {
  segmentIndex: number;
  startSec: number;
  endSec: number;
  gsUri: string;
  bytes: number;
  hasAudio: boolean;
};

export type NativeProbeManifest = {
  schemaVersion: 1;
  sourceDigest: string;
  sourceDurationSec: number;
  segments: NativeProbeManifestSegment[];
};

const TIME_TOLERANCE_SEC = 1e-6;

function strictRecord(
  value: unknown,
  keys: readonly string[],
  label: string,
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}必须是对象`);
  }
  const record = value as Record<string, unknown>;
  if (
    Reflect.ownKeys(record).some((key) => typeof key !== "string" || !keys.includes(key))
    || keys.some((key) => !Object.prototype.hasOwnProperty.call(record, key))
  ) {
    throw new Error(`${label}字段不完整或含有未允许字段`);
  }
  return record;
}

function nonNegativeFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label}必须是有限的非负数字`);
  }
  return value;
}

function parseGsUri(value: unknown, label: string): string {
  if (typeof value !== "string" || /[\s\\?#]/.test(value)) {
    throw new Error(`${label}必须是无查询、片段和反斜杠的gs://对象地址`);
  }
  const match = /^gs:\/\/([a-z0-9][a-z0-9._-]{1,220}[a-z0-9])\/(.+)$/.exec(value);
  if (!match || match[1].split(".").some((part) => part.length === 0 || part.length > 63)) {
    throw new Error(`${label}缺少合法的bucket或对象路径`);
  }
  // 与gcs.ts的normalizeObjectName保持不动点一致，防止校验、签名和模型读到不同对象。
  if (!/^[a-zA-Z0-9/_\-.]+$/.test(match[2]) || match[2].startsWith("/") || match[2].includes("--")) {
    throw new Error(`${label}的对象名会被生产GCS工具改写，不能复用`);
  }
  const pathsToCheck = [match[2]];
  try {
    let decodedPath = decodeURIComponent(match[2]);
    while (decodedPath !== pathsToCheck[pathsToCheck.length - 1]) {
      pathsToCheck.push(decodedPath);
      if (!/%[0-9a-f]{2}/i.test(decodedPath)) break;
      // 多重编码也不能掩盖../；保留原地址，不把解码结果交给调用方。
      decodedPath = decodeURIComponent(decodedPath);
    }
  } catch {
    throw new Error(`${label}含有无效的路径编码`);
  }
  // 先检查原始对象路径，再检查解码结果；不能用会自动消掉../的URL规范化。
  for (const objectPath of pathsToCheck) {
    if (
      /[\u0000-\u001f\u007f\\?#]/.test(objectPath)
      || objectPath.split("/").some((part) => part === "." || part === "..")
    ) {
      throw new Error(`${label}不得包含路径遍历或控制字符`);
    }
  }
  return value;
}

/** 只验证调用方提供的身份和时间映射；不读取对象，也不推算默认300秒分片。 */
export function parseNativeProbeManifest(value: unknown): NativeProbeManifest {
  const root = strictRecord(value, [
    "schemaVersion", "sourceDigest", "sourceDurationSec", "segments",
  ], "探针manifest");
  if (root.schemaVersion !== 1) {
    throw new Error("探针manifest的schemaVersion必须为1");
  }
  if (typeof root.sourceDigest !== "string" || root.sourceDigest.length !== 64 || !/^[0-9a-f]{64}$/.test(root.sourceDigest)) {
    throw new Error("探针manifest的sourceDigest必须是64位小写十六进制摘要");
  }
  const sourceDurationSec = nonNegativeFiniteNumber(root.sourceDurationSec, "全片时长");
  if (sourceDurationSec === 0) throw new Error("全片时长必须大于0");
  if (!Array.isArray(root.segments) || root.segments.length === 0) {
    throw new Error("探针manifest必须包含非空segments数组及明确的时间映射");
  }
  // 永久证据对象名只允许segmentIndex为0..31，在任何付费调用前对齐该契约。
  if (root.segments.length > 32) throw new Error("探针manifest最多包含32个分片");

  const seenUris = new Set<string>();
  let previousEndSec = 0;
  // Array.from也会访问稀疏数组空洞，避免map跳过空洞后错误接受不完整映射。
  const segments = Array.from(root.segments, (value, index): NativeProbeManifestSegment => {
    const label = `分片${index}`;
    const segment = strictRecord(value, [
      "segmentIndex", "startSec", "endSec", "gsUri", "bytes", "hasAudio",
    ], label);
    if (segment.segmentIndex !== index) {
      throw new Error(`${label}的segmentIndex必须从0开始按数组顺序连续递增`);
    }
    const startSec = nonNegativeFiniteNumber(segment.startSec, `${label}.startSec`);
    const endSec = nonNegativeFiniteNumber(segment.endSec, `${label}.endSec`);
    if (endSec <= startSec) throw new Error(`${label}的endSec必须大于startSec`);
    if (index === 0 ? startSec !== 0 : Math.abs(startSec - previousEndSec) > TIME_TOLERANCE_SEC) {
      throw new Error(`${label}没有从上一片终点连续覆盖；首片必须从0开始`);
    }
    const gsUri = parseGsUri(segment.gsUri, `${label}.gsUri`);
    if (seenUris.has(gsUri)) throw new Error(`${label}重复使用了已有gsUri`);
    if (typeof segment.bytes !== "number" || !Number.isInteger(segment.bytes) || segment.bytes <= 0) {
      throw new Error(`${label}.bytes必须是正整数`);
    }
    if (typeof segment.hasAudio !== "boolean") {
      throw new Error(`${label}.hasAudio必须显式为boolean`);
    }
    seenUris.add(gsUri);
    previousEndSec = endSec;
    return {
      segmentIndex: index,
      startSec,
      endSec,
      gsUri,
      bytes: segment.bytes,
      hasAudio: segment.hasAudio,
    };
  });
  if (Math.abs(previousEndSec - sourceDurationSec) > TIME_TOLERANCE_SEC) {
    throw new Error("探针manifest的分片必须连续覆盖至sourceDurationSec，不能缺尾或超出全片");
  }
  return { schemaVersion: 1, sourceDigest: root.sourceDigest, sourceDurationSec, segments };
}

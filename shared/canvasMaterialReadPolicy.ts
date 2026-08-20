export function isAllowedCanvasMaterialGcsUri(
  rawUri: unknown,
  allowedBuckets: readonly unknown[],
): boolean {
  const uri = String(rawUri || "").trim();
  const match = /^gs:\/\/([^/]+)\/(.+)$/.exec(uri);
  if (!match || !match[2] || match[2].includes("..")) return false;
  const bucket = match[1];
  const allowed = new Set(
    allowedBuckets.map((value) => String(value || "").trim()).filter(Boolean),
  );
  return allowed.has(bucket);
}

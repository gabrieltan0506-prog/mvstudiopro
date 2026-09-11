// 上传、增量核验与恢复共用命名路由；旧 Release 永久保留作兼容读取。
export const LEGACY_GROWTH_RELEASE = "growth-cold-store-latest";

export function growthColdStoreReleaseTag(assetName) {
  if (
    !/^[0-9A-Za-z._-]+$/.test(assetName) ||
    assetName === "." ||
    assetName === ".."
  ) {
    throw new Error("非法冷备资产名");
  }
  const batch = assetName.match(
    /^(?:growth-platform-current-complete|platform-current-[A-Za-z0-9_]+)\.batch-(\d+-\d+)\.(?:tar\.)?part-\d+$/
  );
  if (batch) return `growth-current-batch-${batch[1]}`;
  const archive = assetName.match(
    /^archive-(\d{4}-\d{2}-\d{2})(?:-\d{2})?\.(?:manifest\.json|tar\.gz(?:\.part-\d+)?)$/
  );
  if (archive) return `growth-archive-${archive[1]}`;
  return LEGACY_GROWTH_RELEASE;
}

export function growthColdStoreAssetUrls(baseUrl, assetName) {
  const base = baseUrl.replace(/\/$/, "");
  if (!base) return [];
  const tag = growthColdStoreReleaseTag(assetName);
  const legacy = `${base}/${assetName}`;
  // 自定义镜像仍按原契约读取，不猜测它的目录结构。
  if (
    tag === LEGACY_GROWTH_RELEASE ||
    !base.endsWith(`/releases/download/${LEGACY_GROWTH_RELEASE}`)
  )
    return [legacy];
  return [
    `${base.slice(0, -LEGACY_GROWTH_RELEASE.length)}${tag}/${assetName}`,
    legacy,
  ];
}

export async function fetchGrowthColdStoreAsset(baseUrl, assetName, options) {
  for (const url of growthColdStoreAssetUrls(baseUrl, assetName)) {
    const response = await fetch(url, options);
    // 只有明确不存在才读旧仓；鉴权/限流/网络故障不能伪装成旧数据。
    if (response.status !== 404) return response;
  }
  return null;
}

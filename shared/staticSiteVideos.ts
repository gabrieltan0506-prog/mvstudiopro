import receipt from './staticSiteVideoManifest.json';

export type StaticSiteVideo = typeof receipt.assets[number];
export const staticVideoOrigin = 'https://mvstudiopro.fly.dev';
export const staticVideoEndpoint = (asset: StaticSiteVideo) => `/api/static-site-video/${asset.sha256}`;

/** 清单是已完整验读的固定公开素材，不接受请求指定桶、对象或远端网址。 */
export function validateStaticVideoReceipt(value: typeof receipt) {
  if (value.schemaVersion !== 1 || value.complete !== true || value.sourceDeleted !== false
    || value.bucket !== 'mv-studio-pro-vertex-video-temp' || !value.assets.length) throw Error('invalid_video_receipt');
  const paths = new Set<string>();
  for (const a of value.assets) {
    if (!/^\/(home-assets|blog-assets)\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.mp4$/.test(a.path)
      || a.path.includes('..') || paths.has(a.path) || !/^[a-f0-9]{64}$/.test(a.sha256)
      || !Number.isSafeInteger(a.bytes) || a.bytes <= 0 || a.bytes > 64 * 1024 ** 2
      || a.objectName !== `site-static-videos/sha256/${a.sha256}/${a.path.split('/').at(-1)}`
      || !/^\d+$/.test(a.generation) || a.temporaryHold !== true
      || a.contentType !== 'video/mp4' || !Number.isFinite(Date.parse(a.verifiedAt))
      || !(a.media?.duration > 0) || !(a.media?.width > 0) || !(a.media?.height > 0)) throw Error('invalid_video_asset');
    paths.add(a.path);
  }
  return value;
}
export const staticVideoReceipt = validateStaticVideoReceipt(receipt);

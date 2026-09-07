import React, { useCallback, useRef } from "react";
import {
  getLocalMediaRecordBySource,
  getLocalMediaRecord,
  makeLocalMediaRecordId,
} from "@/lib/manhuaLocalMediaStore";
import { assetImageGcsUri } from "@/lib/manhuaAssetImageSource";
import { resolveCanvasMaterialUrl } from "@/lib/omniCanvasApi";

const pendingDisplayUrls = new Map<string, Promise<string>>();

/** 本机指针不是云对象；只有可还原的 GCS 身份才允许向已鉴权入口续签。 */
function displayGcsUri(source: string): string | undefined {
  if (!source.startsWith("gs://")) return assetImageGcsUri(source);
  if (!/^gs:\/\/[^/?#\\]+\/[^?#\\]+$/.test(source)) return;
  try {
    const parts = source.slice(5).split("/").map(decodeURIComponent);
    if (
      parts.some(
        part => !part || part === "." || part === ".." || /[\\/]/.test(part)
      )
    )
      return;
    return assetImageGcsUri(
      `https://storage.googleapis.com/${source.slice(5)}`
    );
  } catch {
    return;
  }
}

/** 只合并在途请求，不缓存已签地址；长开页面下一次失败仍可重新续签。 */
export async function renewManhuaAssetImageDisplayUrl(
  source: string
): Promise<string | null> {
  const gcsUri = displayGcsUri(source);
  if (!gcsUri) return null;
  const existing = pendingDisplayUrls.get(gcsUri);
  if (existing) return existing;
  let timer: ReturnType<typeof setTimeout>;
  const request = Promise.race([
    Promise.resolve().then(() => resolveCanvasMaterialUrl(gcsUri)),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("图片地址刷新超时")), 15_000);
    }),
  ])
    .then(url => {
      if (!url.startsWith("https://") || assetImageGcsUri(url) !== gcsUri)
        throw new Error("图片地址刷新未返回同一图片");
      return url;
    })
    .finally(() => {
      clearTimeout(timer);
      if (pendingDisplayUrls.get(gcsUri) === request)
        pendingDisplayUrls.delete(gcsUri);
    });
  pendingDisplayUrls.set(gcsUri, request);
  return request;
}

export function manhuaAssetImageLocalOnly(source: string | undefined): boolean {
  return /^(?:gs:\/\/|local-media:)/i.test(source || "");
}

/** 签名只是展示地址；稳定身份和旧节点槽位均仅用于本机只读查找。 */
export async function readManhuaAssetImageBlob(
  source: string,
  blockId?: string
): Promise<Blob | null> {
  const stored = await getLocalMediaRecordBySource(source);
  if (stored?.blob?.size) return stored.blob;
  const stable = assetImageGcsUri(source);
  if (stable) {
    const byIdentity = await getLocalMediaRecordBySource(stable);
    if (byIdentity?.blob?.size) return byIdentity.blob;
  }
  const legacy = blockId
    ? await getLocalMediaRecord(makeLocalMediaRecordId(blockId, "output"))
    : null;
  return legacy?.sourceUrl === source ? legacy.blob : null;
}

type FallbackOptions<Event> = {
  source: string;
  readBlob: (source: string) => Promise<Blob | null>;
  createUrl: (blob: Blob) => string;
  revokeUrl: (url: string) => void;
  display: (url: string) => void;
  finalError: (event: Event) => void;
  renewUrl?: (source: string) => Promise<string | null>;
};

/** 每个原来源只查询一次；控制器退役后迟到字节不能更新新图片。 */
export function createManhuaAssetImageFallback<Event>(
  options: FallbackOptions<Event>
) {
  let disposed = false;
  let attempted = false;
  let renewed = false;
  let pending = false;
  let notified = false;
  let ownedUrl: string | undefined;
  const notify = (event: Event) => {
    if (disposed || notified) return;
    notified = true;
    options.finalError(event);
  };
  const releaseLocalUrl = () => {
    if (!ownedUrl) return;
    options.revokeUrl(ownedUrl);
    ownedUrl = undefined;
  };
  return {
    async fail(event: Event): Promise<void> {
      if (disposed || pending || notified) return;
      pending = true;
      try {
        if (!attempted) {
          attempted = true;
          // 本机读取失败和缺字节一样，继续同一有界云端恢复；不改写原缓存。
          let blob: Blob | null = null;
          try {
            blob = await options.readBlob(options.source);
          } catch {
            /* 继续续签 */
          }
          if (disposed) return;
          if (blob?.size) {
            ownedUrl = options.createUrl(blob);
            options.display(ownedUrl);
            return;
          }
        }
        if (!renewed && options.renewUrl) {
          renewed = true;
          const url = await options.renewUrl(options.source);
          if (disposed) return;
          if (url) {
            options.display(url);
            releaseLocalUrl();
            return;
          }
        }
        notify(event);
      } catch {
        notify(event);
      } finally {
        pending = false;
      }
    },
    dispose() {
      disposed = true;
      releaseLocalUrl();
    },
  };
}

/** 仅替换 DOM 展示地址；原始 src、资产身份和生成请求完全不变。 */
export function ManhuaAssetImage({
  src,
  onError,
  onLoad,
  localMediaBlockId,
  ...props
}: React.ImgHTMLAttributes<HTMLImageElement> & { localMediaBlockId?: string }) {
  type ImageError = React.SyntheticEvent<HTMLImageElement, Event>;
  const errorHandler = useRef(onError);
  errorHandler.current = onError;
  const imageNode = useRef<HTMLImageElement | null>(null);
  const controller = useRef<ReturnType<
    typeof createManhuaAssetImageFallback<ImageError>
  > | null>(null);
  const bindImage = useCallback(
    (node: HTMLImageElement | null) => {
      controller.current?.dispose();
      controller.current = null;
      imageNode.current = node;
      if (!node) return;
      const current = createManhuaAssetImageFallback<ImageError>({
        source: src || "",
        readBlob: source => readManhuaAssetImageBlob(source, localMediaBlockId),
        renewUrl: renewManhuaAssetImageDisplayUrl,
        createUrl: blob => URL.createObjectURL(blob),
        revokeUrl: url => URL.revokeObjectURL(url),
        display: url => {
          node.src = url;
        },
        finalError: event => errorHandler.current?.(event),
      });
      controller.current = current;
      if (manhuaAssetImageLocalOnly(src)) {
        // 不把 gs/本机指针交给浏览器发请求；用真实 DOM 事件进入同一有界回退链。
        queueMicrotask(() => {
          if (controller.current === current)
            node.dispatchEvent(new Event("error"));
        });
      }
      return () => {
        current.dispose();
        if (controller.current === current) controller.current = null;
        if (imageNode.current === node) imageNode.current = null;
      };
    },
    [src, localMediaBlockId]
  );
  return (
    <img
      {...props}
      key={src}
      ref={bindImage}
      src={manhuaAssetImageLocalOnly(src) ? undefined : src}
      onLoad={event => {
        if (event.currentTarget === imageNode.current) onLoad?.(event);
      }}
      onError={event => {
        if (event.currentTarget !== imageNode.current) return;
        // React 回调结束会清 currentTarget；最终失败业务回调仍应取得同一图片元素。
        const savedEvent = Object.assign(Object.create(event), {
          currentTarget: event.currentTarget,
          target: event.target,
        }) as ImageError;
        void controller.current?.fail(savedEvent);
      }}
    />
  );
}

import React, { useCallback, useRef } from "react";
import {
  getLocalMediaRecordBySource,
  getLocalMediaRecord,
  makeLocalMediaRecordId,
} from "@/lib/manhuaLocalMediaStore";
import { assetImageGcsUri } from "@/lib/manhuaAssetImageSource";

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
};

/** 每个原来源只查询一次；控制器退役后迟到字节不能更新新图片。 */
export function createManhuaAssetImageFallback<Event>(
  options: FallbackOptions<Event>
) {
  let disposed = false;
  let attempted = false;
  let pending = false;
  let notified = false;
  let ownedUrl: string | undefined;
  const notify = (event: Event) => {
    if (disposed || notified) return;
    notified = true;
    options.finalError(event);
  };
  return {
    async fail(event: Event): Promise<void> {
      if (disposed || pending || notified) return;
      if (attempted) {
        notify(event);
        return;
      }
      attempted = true;
      pending = true;
      try {
        const blob = await options.readBlob(options.source);
        if (disposed) return;
        if (!blob?.size) {
          notify(event);
          return;
        }
        ownedUrl = options.createUrl(blob);
        options.display(ownedUrl);
      } catch {
        notify(event);
      } finally {
        pending = false;
      }
    },
    dispose() {
      disposed = true;
      if (ownedUrl) {
        options.revokeUrl(ownedUrl);
        ownedUrl = undefined;
      }
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

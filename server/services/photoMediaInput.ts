import http from "node:http";
import https from "node:https";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { open, rm, rename } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isPrivateOrReservedAddress } from "./remoteImageFetch.js";

/** 规范化映射 IPv6，再检查公网地址；请求始终绑定这次验证的 DNS 结果。 */
export function isUnsafePhotoAddress(address: string): boolean {
  let value = address.toLowerCase();
  if (isIP(value) === 6) {
    value = new URL(`http://[${value}]/`).hostname.slice(1, -1);
    const mapped = /^::ffff:([a-f0-9]{1,4}):([a-f0-9]{1,4})$/.exec(value);
    if (mapped) {
      const n = parseInt(mapped[1], 16) * 65536 + parseInt(mapped[2], 16);
      value = [24, 16, 8, 0].map(shift => (n >>> shift) & 255).join(".");
    } else if (!value.startsWith("2") && !value.startsWith("3")) return true;
  }
  return !isIP(value) || isPrivateOrReservedAddress(value);
}

/** 仅下载公开媒体，逐块限制体积；不用生产令牌，也不允许 DNS 二次解析。 */
export async function downloadPhotoMedia(
  url: string,
  maxBytes: number,
  destination?: string
): Promise<Buffer> {
  const signal = AbortSignal.timeout(90_000);
  let current = new URL(url);
  for (let redirect = 0; redirect <= 4; redirect++) {
    if (
      !["http:", "https:"].includes(current.protocol) ||
      current.username ||
      current.password
    )
      throw new Error("媒体地址不安全");
    const hostname = current.hostname.replace(/^\[|\]$/g, "");
    const addresses = isIP(hostname)
      ? [{ address: hostname, family: isIP(hostname) }]
      : await lookup(hostname, { all: true });
    if (
      !addresses.length ||
      addresses.some(a => isUnsafePhotoAddress(a.address))
    )
      throw new Error("媒体地址不安全");
    const address = addresses[0];
    const response = await new Promise<http.IncomingMessage>(
      (resolve, reject) => {
        const request = (current.protocol === "https:" ? https : http).get(
          current,
          {
            signal,
            lookup: ((
              _host: string,
              options: { all?: boolean },
              callback: (...args: any[]) => void
            ) => {
              callback(
                null,
                options.all ? [address] : address.address,
                address.family
              );
            }) as never,
          },
          resolve
        );
        request.on("error", reject);
      }
    );
    if ([301, 302, 303, 307, 308].includes(response.statusCode || 0)) {
      response.destroy();
      if (!response.headers.location || redirect === 4)
        throw new Error("媒体跳转无效");
      current = new URL(response.headers.location, current);
      continue;
    }
    if ((response.statusCode || 0) < 200 || (response.statusCode || 0) >= 300) {
      response.destroy();
      throw new Error("媒体下载失败");
    }
    if (Number(response.headers["content-length"]) > maxBytes) {
      response.destroy();
      throw new Error("image_too_large");
    }
    const chunks: Buffer[] = [];
    let size = 0;
    const output = destination ? await open(destination, "wx") : null;
    try {
      for await (const chunk of response) {
        size += chunk.length;
        if (size > maxBytes) {
          response.destroy();
          throw new Error("image_too_large");
        }
        if (output) await output.writeFile(chunk);
        else chunks.push(Buffer.from(chunk));
      }
      if (!size) throw new Error("媒体内容为空");
      return output ? Buffer.alloc(0) : Buffer.concat(chunks);
    } finally {
      await output?.close();
    }
  }
  throw new Error("媒体跳转无效");
}

export function parsePhotoVideoMetadata(raw: string) {
  const data = JSON.parse(raw);
  const video = data.streams?.find(
    (s: { codec_type?: string }) => s.codec_type === "video"
  );
  const width = Number(video?.width),
    height = Number(video?.height);
  const duration = Number(data.format?.duration);
  if (
    ![width, height, duration].every(n => Number.isFinite(n) && n > 0) ||
    duration > 600
  )
    throw new Error("视频必须可播放，时长不超过600秒");
  const short = Math.min(width, height);
  const sourceResolution =
    short <= 480
      ? "480p"
      : short <= 720
        ? "720p"
        : short <= 768
          ? "768p"
          : short <= 1080
            ? "1080p"
            : short <= 1440
              ? "2k"
              : "4k";
  return {
    width,
    height,
    durationSec: Math.max(1, Math.round(duration)),
    sourceResolution,
  };
}

/** 服务端实读原片，扣费前验证时长和分辨率；ffprobe只可读取本地文件。 */
export async function probePhotoVideoInput(url: string) {
  const {
    reservePhotoTempSpace,
    photoTempDir,
    photoTempName,
    photoTempUrl,
    schedulePhotoTempRemoval,
  } = await import("./photoTemporaryMedia.js");
  const reservation = await reservePhotoTempSpace();
  const pendingName = photoTempName("upload");
  const file = path.join(photoTempDir(), pendingName);
  try {
    await downloadPhotoMedia(url, 512 * 1024 * 1024, file);
    const { stdout } = await promisify(execFile)(
      "ffprobe",
      [
        "-v",
        "error",
        "-protocol_whitelist",
        "file",
        "-show_streams",
        "-show_format",
        "-of",
        "json",
        file,
      ],
      { timeout: 30_000, maxBuffer: 1024 * 1024 }
    );
    const metadata = parsePhotoVideoMetadata(stdout);
    // 计费所验的字节与上游消费同一个只读副本，防止外部URL在检查后换成另一条长片。
    const name = pendingName.replace(/upload$/, "mp4");
    await rename(file, path.join(photoTempDir(), name));
    schedulePhotoTempRemoval(name);
    return { ...metadata, verifiedSourceUrl: photoTempUrl(name) };
  } finally {
    try {
      await rm(file, { force: true });
    } finally {
      reservation.release();
    }
  }
}

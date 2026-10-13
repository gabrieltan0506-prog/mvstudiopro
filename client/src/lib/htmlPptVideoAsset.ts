/** 经已有鉴权下载入口读取MP4；限制单片80MB，不接受HTML错误页。 */
export async function loadPptVideoData(url: string): Promise<{ data: string; bytes: number }> {
  const limit = 80 * 1024 * 1024;
  const response = await fetch(url, { credentials: "include", signal: AbortSignal.timeout(120_000) });
  if (!response.ok || !response.body) throw new Error("原视频暂时无法读取，未导出缺视频PPT");
  if (Number(response.headers.get("content-length")) > limit) { await response.body.cancel(); throw new Error("单片超过80MB，未导出；原视频保留"); }
  const reader = response.body.getReader(), parts: ArrayBuffer[] = [];
  let bytes = 0;
  while (true) {
    const chunk = await reader.read(); if (chunk.done) break;
    bytes += chunk.value.length;
    if (bytes > limit) { await reader.cancel(); throw new Error("单片超过80MB，未导出；原视频保留"); }
    parts.push(new Uint8Array(chunk.value).buffer);
  }
  const blob = new Blob(parts, { type: "video/mp4" });
  const header = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  if (String.fromCharCode(...Array.from(header.slice(4, 8))) !== "ftyp") throw new Error("原任务未返回有效MP4，未导出");
  const data = await new Promise<string>((resolve, reject) => { const file = new FileReader(); file.onload = () => resolve(String(file.result)); file.onerror = () => reject(new Error("视频读取失败")); file.readAsDataURL(blob); });
  return { data, bytes };
}

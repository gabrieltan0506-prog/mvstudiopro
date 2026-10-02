/**
 * 四视角拼板切图（客户端）。
 *
 * 跨集场景出的是「同一地点四机位」2×2 拼板，人看着直观、一次出图也省积分，
 * 但整张不能当垫图：模型会把四格读成四个不同地点。发引擎前切开只喂一格。
 */
import { withLongJobsFlyDirect } from "@/lib/longJobsFlyOrigin";
import { resolveUrlForCloudSync } from "@/lib/manhuaLocalMediaStore";

export type ManhuaSheetTileSlot = "topLeft" | "topRight" | "bottomLeft" | "bottomRight";

export type ManhuaSheetTile = {
  slot: ManhuaSheetTileSlot;
  labelZh: string;
  url: string;
};

export async function cropManhuaSheet2x2(input: {
  sheetUrl: string;
  objectPrefix?: string;
  existingTiles?: Partial<Record<ManhuaSheetTileSlot, string>>;
}): Promise<ManhuaSheetTile[]> {
  // 恢复草稿后的 blob/local-media 只供显示；服务端仍校验原云图的归属及像素。
  const sourceUrl = (value: string): string => {
    const original = String(value || "").trim();
    const traced = /^(?:blob:|local-media:)/.test(original)
      ? resolveUrlForCloudSync(original)
      : original;
    if (!traced || (!/^https:\/\//i.test(traced) && !traced.startsWith("/api/canvas-media/"))) {
      throw new Error("拼板或裁切图无法追溯到原云端地址，本次未提交；请重新选择原图");
    }
    return traced;
  };
  const sheetUrl = sourceUrl(input.sheetUrl);
  const existingTiles = input.existingTiles
    ? Object.fromEntries(Object.entries(input.existingTiles).map(([slot, value]) => [slot, sourceUrl(value)]))
    : undefined;
  const url = withLongJobsFlyDirect("/api/jobs?op=manhuaCropSheet2x2");
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      sheetUrl,
      existingTiles,
      objectPrefix: input.objectPrefix || "",
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    tiles?: ManhuaSheetTile[];
    error?: string;
  };
  if (!res.ok || !json.tiles?.length) {
    throw new Error(json.error || "拼板切分失败");
  }
  return json.tiles;
}

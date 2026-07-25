/**
 * 四视角拼板切图（客户端）。
 *
 * 跨集场景出的是「同一地点四机位」2×2 拼板，人看着直观、一次出图也省积分，
 * 但整张不能当垫图：模型会把四格读成四个不同地点。发引擎前切开只喂一格。
 */
import { withLongJobsFlyDirect } from "@/lib/longJobsFlyOrigin";

export type ManhuaSheetTileSlot = "topLeft" | "topRight" | "bottomLeft" | "bottomRight";

export type ManhuaSheetTile = {
  slot: ManhuaSheetTileSlot;
  labelZh: string;
  url: string;
};

export async function cropManhuaSheet2x2(input: {
  sheetUrl: string;
  objectPrefix?: string;
}): Promise<ManhuaSheetTile[]> {
  const url = withLongJobsFlyDirect("/api/jobs?op=manhuaCropSheet2x2");
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "omit",
    body: JSON.stringify({
      sheetUrl: input.sheetUrl,
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

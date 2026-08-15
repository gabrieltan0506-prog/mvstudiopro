/**
 * 扩写模板解析 fail-closed 测试（审查返工 [3]+[9]，2026-08-15）：
 * mt_* / legacy tpl_* / 畸形 id 三分类；无 publicCode 卡两条路都进不了扩写；
 * 响应侧只回 { publicId, nameZh } 匿名句柄。
 */
import { describe, expect, it, vi } from "vitest";
import type { ManhuaViralTemplateCard } from "../../shared/manhuaViralTemplateBank";

const codedCard = {
  id: "tpl_series_deadbeef0001",
  nameZh: "某爆款剧真名节奏",
  laneZh: "爽文逆袭",
  summaryZh: "s",
  hook3sZh: "h",
  beatGrid: [{ atSec: 0, conflictZh: "c", visualZh: "v" }],
  scenePoolHints: [],
  castShape: { leadDesireZh: "a", pressureZh: "b" },
  densityHints: { minBodyChars: 280, minDialogueLines: 8, minLocationHits: 2 },
  sourceRefs: [],
  status: "approved",
  publicCode: "A7F2",
} as unknown as ManhuaViralTemplateCard;

const noCodeCard = {
  ...codedCard,
  id: "tpl_series_nocode000002",
  nameZh: "无码剧真名",
  publicCode: undefined,
} as unknown as ManhuaViralTemplateCard;

vi.mock("./gcs.js", () => ({
  downloadGcsObject: vi.fn(async ({ gcsUri }: { gcsUri: string }) => {
    const card = gcsUri.includes("nocode") ? noCodeCard : codedCard;
    return { buffer: Buffer.from(JSON.stringify(card), "utf8") };
  }),
  listGcsObjectNamesByPrefix: vi.fn(async () => [
    "manhua-template-learn/approved/tpl_series_deadbeef0001.json",
    "manhua-template-learn/approved/tpl_series_nocode000002.json",
  ]),
  uploadBufferToGcs: vi.fn(async () => ({ bucket: "b", objectName: "o", gcsUri: "gs://b/o" })),
}));

import { resolveViralTemplateForExpand } from "./manhuaViralTemplateStore";

describe("resolveViralTemplateForExpand", () => {
  it("公开句柄 mt_* 解析成功，响应只含匿名句柄", async () => {
    const r = await resolveViralTemplateForExpand("mt_a7f2");
    expect("error" in r).toBe(false);
    if ("error" in r) return;
    expect(r.card.id).toBe("tpl_series_deadbeef0001");
    expect(r.appliedTemplate).toEqual({ publicId: "mt_a7f2", nameZh: "爽文逆袭·爆款节奏 A7F2" });
    expect(JSON.stringify(r.appliedTemplate)).not.toContain("tpl_series");
    expect(JSON.stringify(r.appliedTemplate)).not.toContain("真名");
  });

  it("legacy 内部 id（有码卡）兼容通过，响应同样匿名", async () => {
    const r = await resolveViralTemplateForExpand("tpl_series_deadbeef0001");
    expect("error" in r).toBe(false);
    if ("error" in r) return;
    expect(r.appliedTemplate.publicId).toBe("mt_a7f2");
  });

  it("无 publicCode 的卡走 legacy 内部 id 也被拒（堵旧 id 后门）", async () => {
    const r = await resolveViralTemplateForExpand("tpl_series_nocode000002");
    expect(r).toEqual({ error: "no_public_code" });
  });

  it("畸形 id 直接拒", async () => {
    expect(await resolveViralTemplateForExpand("../../etc/passwd")).toEqual({ error: "bad_id" });
    expect(await resolveViralTemplateForExpand("mt_%00")).toEqual({ error: "bad_id" });
    expect(await resolveViralTemplateForExpand("")).toEqual({ error: "bad_id" });
  });

  it("不存在的公开句柄拒", async () => {
    expect(await resolveViralTemplateForExpand("mt_ffff")).toEqual({ error: "not_found" });
  });
});

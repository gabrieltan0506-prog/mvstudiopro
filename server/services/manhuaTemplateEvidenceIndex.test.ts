import { expect, it, vi } from "vitest";
import { extractTemplateEvidence, rankTemplateEvidence } from "./manhuaTemplateEvidenceIndex";
import { createManhuaAdvisorKnowledge } from "./manhuaAdvisorKnowledge";
import type { ManhuaViralTemplateCard } from "../../shared/manhuaViralTemplateBank";
const card = (code: string, method: string) => ({ id: `tpl_${code}`, publicCode: code, nameZh: "私有来源", status: "approved", laneZh: "古言种田", summaryZh: method, reusableZh: method,
  beatGrid: [{ atSec: 0, conflictZh: "私有剧情", visualZh: "私有画面复述", lightingZh: "逆光下的侧脸轮廓" }], sourceRefs: [{ url: "PRIVATE_URL" }], subtitleTrack: [{ textZh: "PRIVATE_SUBTITLE" }], evidenceFrames: [{ objectName: "PRIVATE_OBJECT" }] }) as ManhuaViralTemplateCard;
it("完整索引长创作字段和逐镜导演观察，不读取原字幕、媒体地址与剧情复述", () => {
  const input = card("A123", "中段".repeat(3000) + "尾部证据");
  const chunks = extractTemplateEvidence(input);
  expect(chunks.filter(c => c.field === "writerCapability").map(c => c.text).join("")).toContain("尾部证据");
  expect(chunks.some(c => c.field === "beatGrid[0].lightingZh")).toBe(true);
  for (const privateText of ["PRIVATE_", "私有来源", "私有剧情", "私有画面"]) expect(JSON.stringify(chunks)).not.toContain(privateText);
});
it("普通问题自动检索真实内容，正文不能把无关问题变成推荐", () => {
  const rows = [card("A123", "对白反应使用停顿"), card("B456", "打斗用近处遮挡增强冲击")].map(c => ({ publicId: c.publicCode!, evidence: extractTemplateEvidence(c) }));
  expect(rankTemplateEvidence(rows, "打斗如何增强冲击")[0]?.publicId).toBe("B456");
  expect(rankTemplateEvidence(rows, "天气预报", "打斗冲击")).toEqual([]);
});
it("刷新私有证据后咨询不用编号；版本变化拒绝旧证据，失败与删卡保留正确边界", async () => {
  let generation = "1", objects = [{ name: "manhua-template-learn/approved/tpl_A123.json", generation }];
  const read = vi.fn(async () => ({ buffer: Buffer.from(JSON.stringify(card("A123", "逆光轮廓稳定"))), generation }));
  const store = createManhuaAdvisorKnowledge({ list: async () => objects, read });
  expect(store.inspect().status).toBe("not_scanned"); expect(read).not.toHaveBeenCalled();
  expect(await store.retrieveEvidence("逆光")).toContain("逆光轮廓稳定");
  const snapshot = await store.refresh(); expect(snapshot.snapshot?.templates[0]?.evidenceChunks).toBeGreaterThan(0);
  expect(JSON.stringify(store.inspect())).not.toContain("逆光轮廓稳定");
  const reference = await store.retrieveEvidence("逆光"); expect(reference).toContain("逆光轮廓稳定"); expect(reference).toContain("beatGrid[0].lightingZh"); expect(reference).toContain("generation");
  generation = "2"; await expect(store.retrieveEvidence("逆光")).rejects.toThrow("版本无法核对");
  expect(await store.retrieveEvidence("逆光")).toContain("暂时未就绪");
  objects = []; await store.refresh(); expect(await store.retrieveEvidence("逆光")).toContain("未找到相关原文");
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCreativeEvidenceReview, type CreativeEvidenceReviewInput } from "./creativeEvidenceReview";
import {
  REFINE_CHANGES_KEPT_ZH,
  REFINE_DEFAULT_LIMITATION_ZH,
  normalizeEvidencePath,
  repairRefinementEnvelope,
  repairReviewObject,
  restoreDraftSections,
} from "./creativeRefinementRepair";
import { MUSIC_MV_ADVISOR_INSTRUCTIONS, MUSIC_MV_REFINE_ENVELOPE_ZH, musicMvHardConstraintsZh } from "./musicMvCraft";

/** PR#1766 2026-11-09 探针 b890d15a：6 次 refine 的原始回包（脱敏，concepts 正文省略），全部在服务端校验被拒。 */
type Fixture = {
  durationSec: number;
  draftSections: Array<Record<string, unknown>>;
  draftSummaryZh: string;
  draftUncertaintiesZh: string[];
  attempts: Record<string, Record<string, unknown>>;
};
const fixture: Fixture = JSON.parse(readFileSync(new URL("./__fixtures__/pr1766-refine-raw.json", import.meta.url), "utf8"));
const candidate = { kind: "music_mv_v1", sourceKey: "SOURCE_KEY", summaryZh: fixture.draftSummaryZh, sections: fixture.draftSections, uncertaintiesZh: fixture.draftUncertaintiesZh, concepts: "<4 concepts omitted>" };
const evidenceSections = fixture.draftSections.map(section => ({ ...section, emotion: { ...(section.emotion as Record<string, unknown>), visualZh: "仅音频，未观察画面" } }));
const input: CreativeEvidenceReviewInput = {
  sourceTaskId: "task",
  durationSec: fixture.durationSec,
  mediaKind: "audio",
  sourceEvidence: { media: { kind: "native_music_evidence_v1", sourceKey: "SOURCE_KEY", summaryZh: "听音总结", sections: evidenceSections, uncertaintiesZh: ["拍点待试听", "切口待试听"] }, creativeLibrary: { entries: [], selectedIds: [] } },
  candidate,
  requirements: "设计MV",
};
/** 服务端 refine 接收路径（与 musicMvAdvisor.refineChain 同序）：根对象修复 → review 修复 → 合同校验 → 回填初稿 sections。 */
function accept(decoded: unknown) {
  const shell = repairRefinementEnvelope(decoded, input.candidate);
  const root = shell.value as Record<string, unknown>;
  const review = repairReviewObject(root.review, { ...input, candidate: root.proposal });
  const parsedReview = parseCreativeEvidenceReview(review.value, { ...input, candidate: root.proposal });
  const restored = restoreDraftSections(root.proposal, fixture.draftSections);
  return { shell, review, parsedReview, restored, changesZh: root.changesZh as string[] };
}

describe("联合创作回包确定性修复（PR#1766 探针 6 次原始输出全部复活）", () => {
  it("六次原始回包经修复后全部通过合同校验，且 sections 与初稿逐字一致", () => {
    for (const [name, decoded] of Object.entries(fixture.attempts)) {
      const result = accept(decoded);
      expect(result.parsedReview.verdict, name).toMatch(/approved|revise|needs_media_review/);
      expect(JSON.stringify((result.restored.value as Record<string, unknown>).sections), name).toBe(JSON.stringify(fixture.draftSections));
      expect(result.changesZh.length, name).toBeGreaterThan(0);
    }
  });
  it("(a) 模型把 emotion.visualZh 改回证据原文 → 回填初稿 sections，逐段记录改了哪个字段", () => {
    const result = accept(fixture.attempts["refine-hop-1-glm-5.3-flashx"]);
    expect(result.restored.replaced).toBe(true);
    expect(result.restored.fixes).toHaveLength(7);
    expect(result.restored.fixes.every(fix => fix.field === "emotion.visualZh")).toBe(true);
    expect(String(result.restored.fixes[0].before)).toBe("仅音频，未观察画面");
    expect(String(result.restored.fixes[0].after)).toContain("画面建议");
    expect(result.shell.fixes).toEqual([]);
    // 夹具省略了 concepts 正文，指向 /candidate/concepts/... 的路径会被截到 /candidate/concepts；其余审阅内容无需修复。
    expect(result.review.fixes.filter(fix => !String(fix.before).startsWith("/candidate/concepts/"))).toEqual([]);
  });
  it("(b) 重写只回了 review 根对象 → 以初稿为 proposal 包成 envelope，changesZh 标明原稿保留", () => {
    const raw = fixture.attempts["refine-hop-1-glm-5.3-flashx-rewrite"];
    expect(Object.keys(raw)).toEqual(["verdict", "summaryZh", "findings", "mediaReview", "inspirationZh", "limitationsZh"]);
    const result = accept(raw);
    expect(result.shell.fixes.map(fix => fix.code)).toEqual(["review_only_root", "changes_missing"]);
    expect((result.shell.value as Record<string, unknown>).proposal).toEqual(candidate);
    expect(result.changesZh).toEqual([REFINE_CHANGES_KEPT_ZH]);
    expect(result.parsedReview.findings.length).toBeGreaterThan(0);
    expect(result.restored.replaced).toBe(false);
  });
  it("(c) DeepSeek 重写漏 limitationsZh → 补合同默认局限；字符串形式的 changesZh/limitationsZh 包成数组", () => {
    const result = accept(fixture.attempts["refine-hop-3-deepseek_deepseek-v4.1-flash-1017-rewrite"]);
    expect(result.review.fixes.map(fix => fix.code)).toContain("limitations_missing");
    expect(result.parsedReview.limitationsZh).toEqual([REFINE_DEFAULT_LIMITATION_ZH]);
    const stringy = repairRefinementEnvelope({ proposal: candidate, review: { verdict: "approved", summaryZh: "好", findings: [], mediaReview: [], inspirationZh: "一条灵感", limitationsZh: "一条局限" }, changesZh: "改了标题" }, candidate);
    expect(stringy.value).toMatchObject({ changesZh: ["改了标题"] });
    const review = repairReviewObject((stringy.value as Record<string, unknown>).review, { ...input, candidate });
    expect(review.value).toMatchObject({ inspirationZh: ["一条灵感"], limitationsZh: ["一条局限"] });
    const aliased = repairRefinementEnvelope({ revisedProposal: candidate, review: {}, changes: ["x"] }, candidate);
    expect(Object.keys(aliased.value as object).sort()).toEqual(["changesZh", "proposal", "review"]);
  });
  it("(d) evidencePaths 漏中间层 / 引用不存在的键 → 归一到真实路径或最近合法祖先，不再整跳作废", () => {
    const result = accept(fixture.attempts["refine-hop-3-deepseek_deepseek-v4.1-flash-1017"]);
    const normalized = result.review.fixes.filter(fix => fix.code === "evidence_path_normalized");
    expect(normalized.map(fix => [fix.before, fix.after])).toContainEqual(["/candidate/sections/0/visualZh", "/candidate/sections/0/emotion/visualZh"]);
    const rewrite = accept(fixture.attempts["refine-hop-3-deepseek_deepseek-v4.1-flash-1017-rewrite"]);
    expect(rewrite.review.fixes.map(fix => [fix.before, fix.after])).toContainEqual(["/candidate/unsections", "/candidate"]);
    expect(normalizeEvidencePath("/candidate/sections/2/heardZh", input).path).toBe("/candidate/sections/2/heardZh");
    expect(normalizeEvidencePath("/sourceEvidence/sections/1/heardZh", input).path).toBe("/sourceEvidence/media/sections/1/heardZh");
    expect(normalizeEvidencePath("/nowhere/x", input).path).toBeUndefined();
    const dropped = repairReviewObject({ verdict: "revise", summaryZh: "s", findings: [{ id: "f1", severity: "note", evidencePaths: ["/nowhere"], observationZh: "o", suggestionZh: "s" }], mediaReview: [], inspirationZh: ["i"], limitationsZh: ["l"] }, input);
    expect((dropped.value as { findings: unknown[] }).findings).toEqual([]);
    expect(dropped.fixes.map(fix => fix.code)).toEqual(["evidence_path_dropped", "finding_dropped"]);
  });
  it("硬约束分 compose/refine 两版：refine 照抄 candidate.sections，并带回包骨架；compose 版仍进顾问系统提示", () => {
    expect(musicMvHardConstraintsZh("compose")).toContain("照抄所给 sourceEvidence.sections");
    expect(musicMvHardConstraintsZh("refine")).toContain("照抄输入 candidate.sections");
    expect(musicMvHardConstraintsZh("refine")).toContain("不得改回证据原文");
    expect(musicMvHardConstraintsZh("refine")).not.toContain("照抄所给 sourceEvidence.sections");
    expect(MUSIC_MV_ADVISOR_INSTRUCTIONS).toContain("照抄所给 sourceEvidence.sections");
    expect(MUSIC_MV_REFINE_ENVELOPE_ZH).toContain("/candidate/sections/0/emotion/visualZh");
    expect(MUSIC_MV_REFINE_ENVELOPE_ZH).toContain("limitationsZh");
  });
});

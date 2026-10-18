import { compileI2VMotionPrompt, MANHUA_SEEDANCE_DIRECTOR_PROMPT_MAX_CHARS } from "./jsonDirectorMiddleware";
import { stripManhuaPromptSlop } from "./manhuaDirectingWorkflow";
import { appendManhuaClipEngineOptics } from "./manhuaCineOpticsBank";
import { stripManhuaAssetUrlsFromPrompt } from "./manhuaAssetLockRegistry";
import { describe, expect, it } from "vitest";
import { MANHUA_VFX_DISTILLED } from "./manhuaVfxDistilled";
import { findManhuaVfxPreset, formatManhuaVfxDirection, searchManhuaVfxPresets } from "./manhuaVfxCatalog";
import { extractManhuaShotVfx, upsertManhuaShotVfx } from "./manhuaVfxSupplement";
import { mergeManhuaDerivedClipPrompt } from "./manhuaClipUserSupplement";
import evidence from "../docs/vfx-distillation-1019.json";

describe("三份来源的特效配方消费链", () => {
  it("长正文不再静默截掉已采用特效，无特效旧稿仍遵循旧长度契约", () => {
    const body = "原".repeat(MANHUA_SEEDANCE_DIRECTOR_PROMPT_MAX_CHARS);
    const withVfx = upsertManhuaShotVfx(body, 1, formatManhuaVfxDirection("vfx-environment-hinged-city"));
    expect(() => compileI2VMotionPrompt(withVfx, {appendRecipeAsConstraint: true})).toThrow("本次未提交");
    expect(compileI2VMotionPrompt(body + "尾部")).toHaveLength(MANHUA_SEEDANCE_DIRECTOR_PROMPT_MAX_CHARS);
  });
  it("全部来源可追溯，旧配方映射不产生重复编号", () => {
    expect(MANHUA_VFX_DISTILLED).toHaveLength(50);
    expect(evidence.recipes.map(p => p.id).sort()).toEqual(MANHUA_VFX_DISTILLED.map(p => p.id).sort());
    for (const p of evidence.recipes) {
      expect(evidence.sources[p.report as keyof typeof evidence.sources].sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(p.references.length).toBeGreaterThan(0);
      expect(p.references.every(r => r.caption.length > 10)).toBe(true);
    }
    for (const p of evidence.existingMappings) expect(findManhuaVfxPreset(p.id)).toBeDefined();
  });
  it("每条制作方法经采用、JSON恢复、重编译完整到达当前镜，保留他镜和自由补充", () => {
    for (const p of MANHUA_VFX_DISTILLED) {
      const direction = formatManhuaVfxDirection(p.id);
      expect(direction).toContain(p.methodZh);
      expect(direction.length).toBeLessThanOrEqual(3000);
      const initial = upsertManhuaShotVfx("系统正文\n【用户补充】\n保留原声线", 2, "第二镜保持原状");
      const adopted = upsertManhuaShotVfx(initial, 1, direction);
      const restored = JSON.parse(JSON.stringify({ prompt: adopted }));
      const final = mergeManhuaDerivedClipPrompt("新模型重编译正文", restored.prompt);
      expect(extractManhuaShotVfx(final, 1)).toBe(direction);
      expect(extractManhuaShotVfx(final, 2)).toBe("第二镜保持原状");
      expect(final).toContain("保留原声线");
      const outbound = stripManhuaAssetUrlsFromPrompt(appendManhuaClipEngineOptics(stripManhuaPromptSlop(
        compileI2VMotionPrompt(final, { appendRecipeAsConstraint: true })
      )));
      expect(outbound).toContain(p.methodZh);
      expect(outbound).toContain(p.resultZh);
      expect(final).not.toMatch(/黑客帝国|盗梦空间|少数派报告|尼奥|柯布|安德顿|Matrix|Inception|Minority|\.html|sha256/);
    }
  });
  it("按制作方法搜索，新空间配方与旧点到点折叠保持不同机制", () => {
    expect(searchManhuaVfxPresets("重力 转向").some(p => p.id === "vfx-environment-gravity-roll")).toBe(true);
    expect(searchManhuaVfxPresets("铰链").some(p => p.id === "vfx-environment-hinged-city")).toBe(true);
    expect(findManhuaVfxPreset("vfx-portal-point-fold")?.trajectoryZh).toContain("压缩");
  });
});

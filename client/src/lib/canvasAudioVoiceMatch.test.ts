import { expect, it, vi } from "vitest";
vi.mock("./trpc", () => ({ trpc: {} }));
import { matchCanvasDialogueVoice } from "../components/canvas/CanvasAudioStudio";
import { QWEN_TTS_VOICE_CATALOG, buildQwenTtsVoiceId } from "@shared/qwenTtsVoiceCatalog";
it("真实目录条件筛选，明确未试听；无条件/无匹配不编造声线", () => {
 const result = matchCanvasDialogueVoice({ gender: "女", ageBand: "adult", traitLike: "温柔" });
 const entry = QWEN_TTS_VOICE_CATALOG.find(v => buildQwenTtsVoiceId("plus", v.suffix) === result.voice)!;
 expect(entry.gender).toBe("女"); expect(entry.age).toBeGreaterThanOrEqual(18); expect(entry.age).toBeLessThanOrEqual(54);
 expect(entry.traitZh + entry.sceneZh).toContain("温柔"); expect(result.reasonZh).toContain("尚未试听验证");
 expect(matchCanvasDialogueVoice({}).voice).toBeUndefined();
 expect(matchCanvasDialogueVoice({ traitLike: "不存在的目录要求XYZ" }).voice).toBeUndefined();
});

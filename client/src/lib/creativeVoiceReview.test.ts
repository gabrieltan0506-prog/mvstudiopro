import { describe, expect, it } from "vitest";
import { parseVoiceReviewNotes, resolveVoiceTarget, validateReviewSeek } from "./creativeVoiceReview";
import { creativeVoiceActionSchema } from "@shared/creativeVoice";
import { parseAdvisorPendingRecovery } from "./manhuaAdvisorSession";
import { normalizeVoiceMessage } from "../../../server/services/creativeVoiceTransport";
describe("新增语音工作流边界", () => {
  it("镜头必须属于真实存在的集，不能把第三镜误当第三段", () => {
    const targets = [{ episode: 2, label: "第二集" }, { episode: 2, shot: 3, label: "第三镜" }];
    expect(resolveVoiceTarget(targets, 2, 3).shot).toBe(3);
    expect(() => resolveVoiceTarget(targets, 1, 3)).toThrow();
    expect(creativeVoiceActionSchema.safeParse({ action: "note", text: "暗一点", shot: 3 }).success).toBe(false);
    expect(creativeVoiceActionSchema.safeParse({ action: "generate_video" }).success).toBe(false);
  });
  it("损坏清单抛错而非变成空稿，正常内容可完整恢复", () => {
    expect(() => parseVoiceReviewNotes('{broken')).toThrow();
    expect(() => parseVoiceReviewNotes('[{"text":"旧意见"}]')).toThrow();
    const row = { id: "n", text: "配乐遮住对白", createdAt: "2026-10-05", atSec: 42.5, episode: 2, shot: 3, source: "file:a", done: false };
    expect(parseVoiceReviewNotes(JSON.stringify([row]))).toEqual([row]);
  });
  it("时间点只定位到同一影片，拒绝越界和未载入播放器", () => {
    const note = { source: "file:a", atSec: 42.5 };
    expect(validateReviewSeek(note, "file:a", 60)).toBe(42.5);
    expect(() => validateReviewSeek(note, "file:b", 60)).toThrow();
    expect(() => validateReviewSeek(note, "file:a", 30)).toThrow();
    expect(() => validateReviewSeek(note, "file:a", NaN)).toThrow();
  });
  it("仅转发允许的工作流指令，不把模型任意函数名执行", () => {
    const msg = { toolCall: { functionCalls: [{ id: "n1", name: "creativeWorkflow", args: { action: "note", episode: 2, shot: 3, text: "减轻配乐" } }, { id: "n2", name: "executeShell", args: { command: "x" } }] } };
    expect(normalizeVoiceMessage(false, msg)).toEqual([{ type: "workflow", id: "n1", action: { action: "note", episode: 2, shot: 3, text: "减轻配乐" } }]);
  });
});

it("语音咨询禁止自动渲染标记在恢复后保留", () => {
  const value = { format: "manhua-advisor-pending-v1", request: { requestId: "6f9619ff-8b86-4d01-b42d-00cf4fc964ff", question: "请生成白模视频", rawQuestion: "请生成白模视频", label: "语音讨论", voiceConsultOnly: true }, confirmPaid: false };
  expect(parseAdvisorPendingRecovery(JSON.stringify(value))?.request.voiceConsultOnly).toBe(true);
});

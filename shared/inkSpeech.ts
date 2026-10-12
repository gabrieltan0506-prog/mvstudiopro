import { z } from "zod";

/** 仅内置普通男女声；不接受自定义模型路径或克隆音色。 */
export const inkSpeechLineSchema = z.object({
  at: z.number().finite().min(0).max(60),
  duration: z.number().finite().positive().max(60),
  text: z.string().trim().min(1).max(180),
  voice: z.enum(["female", "male"]),
}).strict();
export const inkSpeechSchema = z.object({
  engine: z.literal("kokoro-zh-v1.1"),
  lines: z.array(inkSpeechLineSchema).min(1).max(20),
}).strict().superRefine((value, ctx) => {
  if (value.lines.reduce((sum, line) => sum + line.text.length, 0) > 300)
    ctx.addIssue({ code: "custom", message: "免费配音合计最多300字，请缩短对白" });
  const ordered = [...value.lines].sort((a, b) => a.at - b.at);
  if (ordered.some((line, i) => i && ordered[i - 1].at + ordered[i - 1].duration > line.at))
    ctx.addIssue({ code: "custom", message: "对白时间重叠，请调整每句的秒窗" });
});
export type InkSpeech = z.infer<typeof inkSpeechSchema>;

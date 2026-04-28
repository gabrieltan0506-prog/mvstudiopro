/**
 * 半月刊定期提醒 + 选题建议
 *
 * 每次半月刊（magazine_single / magazine_sub）生成完成后，记录时间戳到
 * /data/growth/magazine-schedule/{userId}.json
 * 前端加载 GodViewPage 时调用 magazineReminder query：
 *   - 距上次生成 >= 10 天 → reminderDue = true，同时用 Gemini 生成 3-5 个选题
 *   - 否则 → reminderDue = false，返回剩余天数
 */

import fs from "node:fs/promises";
import path from "node:path";

const SCHEDULE_DIR =
  process.env.MAGAZINE_SCHEDULE_DIR || "/data/growth/magazine-schedule";
const REMINDER_INTERVAL_DAYS = 10;

const REMINDER_EMAIL = "benjamintan0506@163.com";

interface ScheduleFile {
  userId: string;
  lastGeneratedAt: string; // ISO 8601
  lastTopic?: string;
  reminderEmailSentAt?: string; // 本轮提醒已发邮件时间
}

async function ensureDir() {
  await fs.mkdir(SCHEDULE_DIR, { recursive: true });
}

function schedulePath(userId: string) {
  return path.join(SCHEDULE_DIR, `${userId}.json`);
}

export async function recordMagazineGenerated(userId: string, topic: string) {
  await ensureDir();
  const data: ScheduleFile = {
    userId,
    lastGeneratedAt: new Date().toISOString(),
    lastTopic: topic,
  };
  await fs.writeFile(schedulePath(userId), JSON.stringify(data, null, 2), "utf8");
}

export async function getMagazineSchedule(userId: string): Promise<ScheduleFile | null> {
  try {
    const raw = await fs.readFile(schedulePath(userId), "utf8");
    return JSON.parse(raw) as ScheduleFile;
  } catch {
    return null;
  }
}

/** 检查是否到期（>= 10 天），返回剩余天数（负数表示已过期） */
export function daysUntilReminder(lastGeneratedAt: string): number {
  const last = new Date(lastGeneratedAt).getTime();
  const now = Date.now();
  const elapsedDays = (now - last) / (1000 * 60 * 60 * 24);
  return REMINDER_INTERVAL_DAYS - elapsedDays; // 负数 = 已过期
}

/**
 * 若本轮提醒邮件尚未发送，则发送一封包含选题建议的提醒邮件，并记录发送时间。
 * 只要 reminderEmailSentAt 不在当前 lastGeneratedAt 之后，就发送。
 */
export async function sendReminderEmailIfNeeded(
  userId: string,
  topics: string[],
  lastTopic?: string,
): Promise<void> {
  try {
    await ensureDir();
    const schedule = await getMagazineSchedule(userId);
    const now = new Date();

    // 若已在本轮（lastGeneratedAt 之后）发过邮件，跳过
    if (
      schedule?.reminderEmailSentAt &&
      schedule.lastGeneratedAt &&
      new Date(schedule.reminderEmailSentAt) > new Date(schedule.lastGeneratedAt)
    ) {
      return;
    }

    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    const topicList = topics.length
      ? topics.map((t, i) => `${i + 1}. ${t}`).join("\n")
      : "（选题生成中，请登录平台查看）";
    const lastHint = lastTopic ? `上期主题：${lastTopic}\n\n` : "";
    const subject = `📋 战略半月刊提醒：${year} 年 ${month} 月新一期可以开始了`;
    const text = `您好，

距离上次生成战略半月刊已超过 10 天，是时候开始新一期了！

${lastHint}本期 AI 推荐选题：
${topicList}

请登录 MVStudioPro → 上帝视角 → 选择「战略半月刊」，
选定选题后可直接生成，或上传补充资料后再生成。

祝创作顺利！
—— MVStudioPro 战略研究中心`;

    const html = `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px">
  <h2 style="color:#7a5410">📋 战略半月刊提醒</h2>
  <p style="color:#555">距上次生成已超过 10 天，AI 为您推荐了以下选题：</p>
  ${lastTopic ? `<p style="color:#999;font-size:13px">上期主题：${lastTopic}</p>` : ""}
  <ol style="color:#1c1407;line-height:2">
    ${topics.map((t) => `<li>${t}</li>`).join("")}
  </ol>
  <a href="https://mvstudiopro.com/god-view" style="display:inline-block;margin-top:16px;padding:12px 28px;background:linear-gradient(135deg,#a8761b,#7a5410);color:#fff7df;border-radius:10px;text-decoration:none;font-weight:700">
    前往生成 →
  </a>
  <p style="margin-top:24px;color:#999;font-size:12px">MVStudioPro 战略研究中心 · 自动提醒</p>
</div>`;

    const { sendSimpleMail } = await import("./smtp-mailer");
    await sendSimpleMail({ to: REMINDER_EMAIL, subject, text, html });
    console.log(`[magazineScheduler] ✉️ 提醒邮件已发送至 ${REMINDER_EMAIL}`);

    // 记录已发送
    const updated: ScheduleFile = {
      ...(schedule ?? { userId, lastGeneratedAt: new Date(0).toISOString() }),
      reminderEmailSentAt: now.toISOString(),
    };
    await fs.writeFile(schedulePath(userId), JSON.stringify(updated, null, 2), "utf8");
  } catch (e: any) {
    console.warn("[magazineScheduler] 发送提醒邮件失败:", e?.message);
  }
}

/** 用 Gemini Flash 生成 3-5 个半月刊选题建议 */
export async function generateTopicSuggestions(lastTopic?: string): Promise<string[]> {
  const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) return [];

  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  const lastTopicHint = lastTopic
    ? `上期主题是「${lastTopic}」，请避免重复方向，选择互补或延伸角度。`
    : "";

  const prompt = `你是一位专注于中文内容创作行业的战略分析师。
现在是 ${year} 年 ${month} 月。请为一份面向内容创作者（主要是短视频/直播/图文创作者）的战略半月刊，
提出 5 个最值得深度研究的选题。

${lastTopicHint}

要求：
- 选题紧贴 ${year} 年的平台动态、政策、商业化趋势
- 每个选题一句话，20-40 字，有吸引力、有研究价值
- 优先选择能被 AI 深度检索到真实数据的方向
- 输出严格 JSON 数组，格式：["选题1","选题2","选题3","选题4","选题5"]
- 不要任何额外文字`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 512, temperature: 0.85 },
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const json = await res.json().catch(() => ({}));
    const raw = String(json?.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
    // 提取 JSON 数组
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return [];
    const topics: string[] = JSON.parse(match[0]);
    return topics.filter((t) => typeof t === "string" && t.trim()).slice(0, 5);
  } catch (e: any) {
    console.warn("[magazineScheduler] 选题生成失败:", e?.message);
    return [];
  }
}

export type MascotCareMessageInput = {
  userNote?: string;
  currentTime?: string;
  pagePath?: string;
  weather?: { condition: string; temperature: string; humidity: string };
  trafficSummary?: string;
  trafficAreas?: string[];
  newsLines?: string[];
  changeHints?: string[];
};

function safeParseCareJson(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  try {
    const o = JSON.parse(t) as { message?: string };
    return String(o.message ?? "").trim();
  } catch {
    return "";
  }
}

/**
 * 吉祥物「情绪关怀」短文案：仅走 Fly 上 tRPC（ambient.mascotCareMessage），不增加 Vercel api/*.ts 函数。
 * 单次 LLM、JSON 输出；无 KEY 时回退本地模板。
 */
export async function generateMascotCareMessage(input: MascotCareMessageInput): Promise<string> {
  const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) {
    const hints = input.changeHints?.length ? `（小提醒：${input.changeHints.join("；")}）` : "";
    return `夜深了就别硬撑啦，早点歇一歇。出门记得看眼天气，变了也别慌${hints}。喝杯温水或热茶，对自己好一点喔。`;
  }

  const model =
    String(
      process.env.GEMINI_MASCOT_CARE_MODEL ||
        process.env.GEMINI_DASHBOARD_TRAFFIC_MODEL ||
        "gemini-2.5-flash",
    ).trim() || "gemini-2.5-flash";
  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey });

  const blocks: string[] = [];
  if (input.pagePath) blocks.push(`目前頁面路徑：${input.pagePath}`);
  if (input.currentTime) blocks.push(`伺服器時間：${input.currentTime}`);
  if (input.weather) {
    blocks.push(
      `天氣：${input.weather.condition}，氣溫 ${input.weather.temperature}，濕度 ${input.weather.humidity}`,
    );
  }
  if (input.trafficSummary) {
    const areas =
      input.trafficAreas && input.trafficAreas.length
        ? `；擁堵路段：${input.trafficAreas.slice(0, 6).join("、")}`
        : "";
    blocks.push(`路況：${input.trafficSummary}${areas}`);
  }
  if (input.newsLines?.length) blocks.push(`新聞提要：\n- ${input.newsLines.slice(0, 8).join("\n- ")}`);
  if (input.changeHints?.length) blocks.push(`剛才偵測到的變化：${input.changeHints.join("；")}`);
  if (input.userNote?.trim()) blocks.push(`使用者想說的話：${input.userNote.trim()}`);

  const systemInstruction =
    "你是陪伴用户创作与办公的小伙伴，用简体中文像发微信那样说话。" +
    "根据下面给到的天气、路况、新闻提要、变化提示，写 2～4 句短话：生活化、温柔、略带俏皮，像熟人关心的口气。" +
    "可自然融入这些方向（有依据再用，不要编造未提供的信息）：" +
    "夜深了催人早点睡；快下雨提醒带伞；路堵了说句别急、留点时间；忙久了提醒喝水、起来动动、喝杯热茶暖暖身子。" +
    "不要用公文、汇报腔或分点列表，不要称呼「用户」「创作者」等敬语堆砌。" +
    "仅输出合法 JSON：{\"message\":\"...\"}，message 总长度不超过 380 字。";

  const userText = `请基于下列情境输出 JSON：\n${blocks.join("\n")}`;

  const response = await ai.models.generateContent({
    model,
    contents: [{ role: "user", parts: [{ text: userText }] }],
    config: {
      systemInstruction,
      responseMimeType: "application/json",
      temperature: 0.75,
      maxOutputTokens: 1024,
    } as any,
  });
  const text = String((response as { text?: string })?.text ?? "").trim();
  const msg = safeParseCareJson(text);
  return msg || "今天也辛苦了，别把自己绷太紧。想歇会儿就歇会儿，我等下还在，帮你念着天气和路况呢。";
}

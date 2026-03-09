export async function generateScriptWithGemini(input: {
  prompt: string;
  targetWords?: number;
}) {
  const prompt = String(input.prompt || "").trim();
  const targetWords = Number(input.targetWords || 900);
  if (!prompt) throw new Error("prompt is required");

  const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) {
    return {
      script: buildFallbackScript(prompt, targetWords),
      isFallback: true,
      errorMessage: "GEMINI_API_KEY is not configured",
      provider: "google",
      model: "gemini-1.5-pro",
    };
  }

  try {
    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: "gemini-1.5-pro",
      contents: [
        {
          role: "user",
          parts: [
            {
              text:
                `请写一个约 ${targetWords} 字的中文短视频分镜脚本，必须按“Scene 1: ...”连续编号输出。` +
                `\n主题：${prompt}`,
            },
          ],
        },
      ],
    });

    const script =
      response.candidates?.[0]?.content?.parts
        ?.map((p: any) => p?.text || "")
        .join("")
        .trim() || "";

    if (!script) throw new Error("empty script from gemini");

    return {
      script,
      isFallback: false,
      errorMessage: "",
      provider: "google",
      model: "gemini-1.5-pro",
    };
  } catch (error: any) {
    return {
      script: buildFallbackScript(prompt, targetWords),
      isFallback: true,
      errorMessage: error?.message || String(error),
      provider: "google",
      model: "gemini-1.5-pro",
    };
  }
}

function buildFallbackScript(prompt: string, targetWords: number) {
  const sceneLines = [
    `Scene 1: 开场建立世界观，主题围绕“${prompt}”。`,
    "Scene 2: 主角进入冲突，节奏加速，镜头快速切换。",
    "Scene 3: 中段推进任务，角色关系变化，情绪拉升。",
    "Scene 4: 冲突爆发，视觉强刺激，给出关键反转。",
    "Scene 5: 收束高潮并留钩子，形成可继续扩展的结尾。",
  ];
  const filler = `\n旁白补充：整体脚本控制在约 ${targetWords} 字，包含动作、镜头与情绪变化。`;
  return sceneLines.join("\n") + filler;
}

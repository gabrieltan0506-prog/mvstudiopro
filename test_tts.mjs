import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

try {
  const r = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ role: "user", parts: [{ text: "MVStudioPro.com" }] }],
    config: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: "Kore" }
        }
      }
    }
  });
  const audio = r.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
  console.log("TTS available:", !!audio, "mime:", audio?.inlineData?.mimeType, "size:", audio?.inlineData?.data?.length || 0);
} catch (e) {
  console.log("TTS error:", e.message);
}

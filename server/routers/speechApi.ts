import type { Express } from "express";
import speech from "@google-cloud/speech";
import multer from "multer";
import fs from "fs";
import path from "path";

function createSpeechClient() {
  const jsonEnv = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (jsonEnv) {
    try { return new speech.SpeechClient({ credentials: JSON.parse(jsonEnv) }); } catch {}
  }
  return new speech.SpeechClient();
}

const client = createSpeechClient();
const upload = multer({ storage: multer.memoryStorage() });

export function registerSpeechApiRoutes(app: Express) {
  app.post("/api/speech-to-text", upload.single("audio"), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No audio file" });

    // 🔴 关键调试：将收到的音频存到项目根目录
    const debugPath = path.join(process.cwd(), "debug-voice.webm");
    try {
      fs.writeFileSync(debugPath, req.file.buffer);
      console.log(`[Debug] 音频已存至 ${debugPath}，大小: ${req.file.buffer.length} bytes`);
    } catch (e) {
      console.error("保存调试音频失败:", e);
    }

    try {
      const audioBytes = req.file.buffer.toString("base64");
      const [response] = await client.recognize({
        audio: { content: audioBytes },
        config: {
          encoding: "WEBM_OPUS" as any,
          sampleRateHertz: 48000,
          languageCode: "zh-CN",
          alternativeLanguageCodes: ["zh-TW", "en-US"],
          enableAutomaticPunctuation: true,
        },
      });

      const transcription = response.results?.map((r) => r.alternatives?.[0]?.transcript ?? "").join("\n").trim() ?? "";
      console.log(`[GCP] 识别结果: "${transcription}"`);
      res.status(200).json({ text: transcription });
    } catch (error) {
      console.error("[GCP Error]:", error);
      res.status(500).json({ error: "Speech API Failed" });
    }
  });
}

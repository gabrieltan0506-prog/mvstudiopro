import type { Express } from "express";
import speech from "@google-cloud/speech";
import multer from "multer";

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
      console.log(`[GCP Speech] 识别结果: "${transcription}"`);
      res.status(200).json({ text: transcription });
    } catch (error) {
      console.error("[GCP Speech] Error:", error);
      res.status(500).json({ error: "Speech recognition failed" });
    }
  });
}

import type { Express } from "express";
import speech from "@google-cloud/speech";
import multer from "multer";

function createSpeechClient() {
  const jsonEnv = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (jsonEnv) {
    try {
      const credentials = JSON.parse(jsonEnv);
      return new speech.SpeechClient({ credentials });
    } catch {
      console.error("[Speech] Failed to parse GOOGLE_APPLICATION_CREDENTIALS_JSON");
    }
  }
  return new speech.SpeechClient();
}

const client = createSpeechClient();

// 使用 multer memoryStorage 直接把音頻存入 Buffer，與 Express 完全相容
const upload = multer({ storage: multer.memoryStorage() });

export function registerSpeechApiRoutes(app: Express) {
  app.post("/api/speech-to-text", upload.single("audio"), async (req, res) => {
    try {
      const file = req.file;
      console.log(`[GCP Speech] received file: size=${file?.size ?? 0} mimetype=${file?.mimetype ?? "none"}`);

      if (!file || file.size < 100) {
        res.status(400).json({ error: "No audio data found" });
        return;
      }

      const audioBytes = file.buffer.toString("base64");

      const [response] = await client.recognize({
        audio: { content: audioBytes },
        config: {
          encoding: "WEBM_OPUS" as any,
          sampleRateHertz: 48000,
          languageCode: "zh-CN",
          enableAutomaticPunctuation: true,
        },
      });

      const transcription =
        response.results
          ?.map((r) => r.alternatives?.[0]?.transcript ?? "")
          .join("\n")
          .trim() ?? "";

      console.log(`[GCP Speech] results=${response.results?.length ?? 0} text="${transcription}"`);
      res.status(200).json({ text: transcription });
    } catch (error) {
      console.error("[GCP Speech] Error:", error);
      res.status(500).json({ error: "Speech recognition failed" });
    }
  });
}

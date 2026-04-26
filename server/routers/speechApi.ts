import type { Express } from "express";
import speech from "@google-cloud/speech";
import Busboy from "busboy";

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
  // fallback: use file-based credentials (local dev)
  return new speech.SpeechClient();
}

const client = createSpeechClient();

export function registerSpeechApiRoutes(app: Express) {
  app.post("/api/speech-to-text", (req, res) => {
    const contentType = req.headers["content-type"] ?? "";
    if (!contentType.includes("multipart/form-data")) {
      res.status(400).json({ error: "Expected multipart/form-data" });
      return;
    }

    const chunks: Buffer[] = [];
    let found = false;

    const busboy = Busboy({ headers: req.headers });

    busboy.on("file", (fieldname, file) => {
      if (fieldname !== "audio") {
        file.resume();
        return;
      }
      found = true;
      file.on("data", (data: Buffer) => chunks.push(data));
    });

    busboy.on("finish", async () => {
      if (!found || chunks.length === 0) {
        res.status(400).json({ error: "No audio data found" });
        return;
      }

      try {
        const audioBuffer = Buffer.concat(chunks);
        const audioBytes = audioBuffer.toString("base64");

        // sampleRateHertz 不指定，讓 GCP 從 WebM 容器自動讀取
        const [response] = await client.recognize({
          audio: { content: audioBytes },
          config: {
            encoding: "WEBM_OPUS" as any,
            languageCode: "zh-CN",
            enableAutomaticPunctuation: true,
            model: "latest_long",
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

    busboy.on("error", (err) => {
      console.error("[Speech] Busboy error:", err);
      res.status(500).json({ error: "Failed to parse audio upload" });
    });

    req.pipe(busboy);
  });
}

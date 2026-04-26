import type { Express } from "express";
import speech from "@google-cloud/speech";
import multer from "multer";
import fs from "fs";
import path from "path";
import { exec } from "child_process";
import util from "util";

const execPromise = util.promisify(exec);

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
const upload = multer({ storage: multer.memoryStorage() });

export function registerSpeechApiRoutes(app: Express) {
  app.post("/api/speech-to-text", upload.single("audio"), async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "No audio file found" });
    }

    const id = Date.now() + "_" + Math.floor(Math.random() * 10000);
    const inPath = path.join(process.cwd(), `in_${id}.tmp`);
    const outPath = path.join(process.cwd(), `out_${id}.wav`);

    try {
      // 1. 将前端传来的文件（WebM / MP4 均可）写入临时文件
      fs.writeFileSync(inPath, req.file.buffer);

      // 2. FFmpeg 强制转成单声道 48000Hz 标准 WAV
      await execPromise(`ffmpeg -y -i ${inPath} -acodec pcm_s16le -ar 48000 -ac 1 ${outPath}`);

      // 3. 读取转好的 WAV 并转 base64
      const wavBuffer = fs.readFileSync(outPath);
      const audioBytes = wavBuffer.toString("base64");

      // 4. 发送给 GCP 识别（LINEAR16 格式最稳定）
      const [response] = await client.recognize({
        audio: { content: audioBytes },
        config: {
          encoding: "LINEAR16",
          sampleRateHertz: 48000,
          languageCode: "zh-CN",
          alternativeLanguageCodes: ["zh-TW", "en-US"],
          enableAutomaticPunctuation: true,
        },
      });

      const transcription =
        response.results
          ?.map((r) => r.alternatives?.[0]?.transcript ?? "")
          .join("\n")
          .trim() ?? "";

      console.log(`[GCP Speech] FFmpeg 转档识别成功，文字: "${transcription}"`);
      res.status(200).json({ text: transcription });

    } catch (error) {
      console.error("[GCP Speech] FFmpeg 转档或识别失败:", error);
      res.status(500).json({ error: "Speech recognition failed" });
    } finally {
      // 5. 严格清理临时文件，防止磁盘堆积
      try {
        if (fs.existsSync(inPath)) fs.unlinkSync(inPath);
        if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
      } catch (cleanupError) {
        console.error("[GCP Speech] 清理临时文件失败:", cleanupError);
      }
    }
  });
}

import type { VercelRequest, VercelResponse } from "@vercel/node";
import speech from "@google-cloud/speech";

const client = new speech.SpeechClient();

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // req.body is a Buffer when Content-Type is multipart
    // Parse multipart manually via the raw body
    const chunks: Buffer[] = [];
    for await (const chunk of req as any) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const rawBody = Buffer.concat(chunks);

    // Extract boundary from Content-Type header
    const contentType = (req.headers["content-type"] as string) ?? "";
    const boundaryMatch = contentType.match(/boundary=(.+)$/);
    if (!boundaryMatch) {
      return res.status(400).json({ error: "Missing multipart boundary" });
    }
    const boundary = `--${boundaryMatch[1]}`;

    // Split by boundary and find the audio part
    const parts = rawBody.toString("binary").split(boundary);
    let audioBuffer: Buffer | null = null;

    for (const part of parts) {
      if (part.includes('name="audio"') || part.includes("name='audio'")) {
        // Header ends at first double CRLF
        const headerEnd = part.indexOf("\r\n\r\n");
        if (headerEnd === -1) continue;
        const bodyBinary = part.slice(headerEnd + 4, part.endsWith("\r\n") ? -2 : undefined);
        audioBuffer = Buffer.from(bodyBinary, "binary");
        break;
      }
    }

    if (!audioBuffer || audioBuffer.length === 0) {
      return res.status(400).json({ error: "No audio data found" });
    }

    const audioBytes = audioBuffer.toString("base64");

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

    return res.status(200).json({ text: transcription });
  } catch (error) {
    console.error("[GCP Speech] Error:", error);
    return res.status(500).json({ error: "Speech recognition failed" });
  }
}

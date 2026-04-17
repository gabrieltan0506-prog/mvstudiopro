import type { VercelRequest, VercelResponse } from "@vercel/node";
import { exportSnapshotImageToPDF, exportToPDF, exportToWord } from "../server/storyboard-export.js";

function jparse(t: string): any { try { return JSON.parse(t); } catch { return null; } }
function getBody(req: VercelRequest): any {
  const b: any = (req as any).body;
  if (!b) return {};
  if (typeof b === "string") return jparse(b) ?? {};
  return b;
}
function s(v: any): string { if (v == null) return ""; if (Array.isArray(v)) return String(v[0] ?? ""); return String(v); }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

    const q: any = req.query || {};
    const b = getBody(req);
    const op = s(q.op || b.op).trim().toLowerCase();
    if (op !== "storyboard-pdf" && op !== "storyboard-docx" && op !== "analysis-page-pdf") {
      return res.status(400).json({ ok: false, error: "unsupported_op" });
    }

    if (op === "analysis-page-pdf") {
      const title = s(b.title).trim() || "MV Analysis Export";
      const imageDataUrl = s(b.imageDataUrl).trim();
      if (!imageDataUrl) return res.status(400).json({ ok: false, error: "image_data_required" });
      const result = await exportSnapshotImageToPDF({ title, imageDataUrl });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename=\"creator-growth-camp-analysis.pdf\"`);
      return res.status(200).send(result.buffer);
    }

    const scenesInput = Array.isArray(b.scenes) ? b.scenes : [];
    if (!scenesInput.length) return res.status(400).json({ ok: false, error: "scenes are required" });

    const storyboard = {
      title: s(b.title).trim() || "Storyboard Export",
      musicInfo: {
        bpm: Number(b.musicBpm || 110) || 110,
        emotion: s(b.musicMood).trim() || "cinematic",
        style: s(b.musicStyle).trim() || "trailer",
        key: s(b.musicKey).trim() || "C minor",
      },
      scenes: scenesInput.map((scene: any, idx: number) => {
        const imageUrls = Array.isArray(scene?.imageUrls) ? scene.imageUrls : [];
        const duration = Number(scene?.duration || 8) || 8;
        return {
          sceneNumber: Number(scene?.sceneIndex || idx + 1),
          timestamp: `Scene ${Number(scene?.sceneIndex || idx + 1)}`,
          duration: `${duration}s`,
          description: s(scene?.scenePrompt || scene?.description).trim(),
          cameraMovement: s(scene?.camera || scene?.cameraMovement).trim() || "medium",
          mood: s(scene?.mood).trim() || "cinematic",
          visualElements: [
            s(scene?.character).trim(),
            s(scene?.environment).trim(),
            s(scene?.action).trim(),
            s(scene?.lighting).trim(),
          ].filter(Boolean),
          transition: s(scene?.transition).trim() || undefined,
          previewImageUrl: s(imageUrls[0]).trim() || null,
          previewImageUrls: imageUrls.map((value: any) => s(value).trim()).filter(Boolean),
        };
      }),
      summary: s(b.script).trim() || "Storyboard export generated from workflow.",
    };

    const result = op === "storyboard-docx"
      ? await exportToWord(storyboard, { addWatermark: Boolean(b.isPaidUser) ? false : true })
      : await exportToPDF(storyboard, { addWatermark: Boolean(b.isPaidUser) ? false : true });

    return res.status(200).json({ ok: true, url: result.url, message: result.message });
  } catch (error: any) {
    return res.status(500).json({ ok: false, error: "export_failed", message: error?.message || String(error) });
  }
}

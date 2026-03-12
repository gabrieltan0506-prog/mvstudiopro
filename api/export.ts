import type { VercelRequest, VercelResponse } from "@vercel/node";
import { buildStoryboardDocx, buildStoryboardPdf } from "../server/export/docBuilders.js";
import { applyImageWatermark } from "../server/export/imageWatermark.js";
import { getExportWatermarkPolicy } from "../server/export/watermarkPolicy.js";
import type { StoryboardDocExport } from "../shared/export/types.js";

function s(v: unknown) {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return typeof v[0] === "string" ? v[0] : "";
  return "";
}

async function fetchBuffer(url: string) {
  const resp = await fetch(url, { headers: { "User-Agent": "mvstudiopro-export" } });
  if (!resp.ok) throw new Error(`download_failed:${resp.status}:${url}`);
  return Buffer.from(await resp.arrayBuffer());
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const body = typeof req.body === "object" && req.body ? req.body : {};
  const op = s(req.query?.op || (body as any).op).trim().toLowerCase();
  const isPaidUser = Boolean((body as any).isPaidUser);
  const policy = getExportWatermarkPolicy({ isPaidUser, brand: "MVStudioPro" });

  if (op === "storyboard-docx") {
    const payload: StoryboardDocExport = {
      title: s((body as any).title || "Storyboard Export"),
      script: s((body as any).script),
      scenes: Array.isArray((body as any).scenes) ? (body as any).scenes : [],
    };

    const buf = await buildStoryboardDocx(payload, policy.isPaidUser ? "" : policy.docWatermarkText);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", "attachment; filename=storyboard.docx");
    return res.status(200).send(buf);
  }

  if (op === "storyboard-pdf") {
    const payload: StoryboardDocExport = {
      title: s((body as any).title || "Storyboard Export"),
      script: s((body as any).script),
      scenes: Array.isArray((body as any).scenes) ? (body as any).scenes : [],
    };

    const buf = await buildStoryboardPdf(payload, policy.isPaidUser ? "" : policy.docWatermarkText);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=storyboard.pdf");
    return res.status(200).send(buf);
  }

  if (op === "storyboard-image") {
    const imageUrl = s((body as any).imageUrl || req.query?.imageUrl).trim();
    if (!imageUrl) return res.status(400).json({ ok: false, error: "missing_image_url" });

    const raw = await fetchBuffer(imageUrl);
    const out = policy.isPaidUser ? raw : await applyImageWatermark(raw, policy.imageWatermarkText);

    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Content-Disposition", "attachment; filename=storyboard-image.jpg");
    return res.status(200).send(out);
  }

  return res.status(400).json({ ok: false, error: `invalid_op:${op || "empty"}` });
}

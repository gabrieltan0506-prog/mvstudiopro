import type { VercelRequest, VercelResponse } from "@vercel/node";

function s(v: any): string | null {
  if (v == null) return null;
  if (Array.isArray(v)) return v[0] ? String(v[0]) : null;
  const t = String(v).trim();
  return t ? t : null;
}

export default function handler(_req: VercelRequest, res: VercelResponse) {
  const imageLocation = s(process.env.VERTEX_IMAGE_LOCATION) ?? s(process.env.VERTEX_LOCATION) ?? "global";
  const videoLocation = s(process.env.VERTEX_VIDEO_LOCATION) ?? s(process.env.VERTEX_LOCATION) ?? "us-central1";
  const klingBaseUrl = s(process.env.KLING_BASE_URL) ?? s(process.env.KLING_CN_BASE_URL) ?? "https://api-beijing.klingai.com";

  return res.status(200).json({
    ok: true,
    image: {
      flashModel: s(process.env.VERTEX_IMAGE_MODEL_FLASH),
      proModel: s(process.env.VERTEX_IMAGE_MODEL_PRO),
      location: imageLocation,
    },
    video: {
      veoModel: s(process.env.VERTEX_VEO_MODEL_PRO) ?? s(process.env.VERTEX_VEO_MODEL),
      location: videoLocation,
    },
    music: { enabled: true, provider: "aimusicapi", sunoCreateOp: "aimusicSunoCreate", sunoTaskOp: "aimusicSunoTask", creditsOp: "aimusicCredits" },
    kling: {
      baseUrl: klingBaseUrl,
    },
  });
}

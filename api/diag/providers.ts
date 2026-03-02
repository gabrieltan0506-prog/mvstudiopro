import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  return res.status(200).json({
    ok: true,
    image: {
      flashModel: process.env.VERTEX_IMAGE_MODEL_FLASH || null,
      proModel: process.env.VERTEX_IMAGE_MODEL_PRO || null,
      location: process.env.VERTEX_LOCATION || null
    },
    video: {
      veoModel: process.env.VERTEX_VIDEO_MODEL || null,
      location: process.env.VERTEX_LOCATION || null
    },
    kling: {
      baseUrl: process.env.KLING_CN_BASE_URL || null
    }
  });
}

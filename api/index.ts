import type { VercelRequest, VercelResponse } from "@vercel/node";

export default function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "GET") {
      return res.status(405).setHeader("Allow", "GET").send("Method Not Allowed");
    }

    const requestUrl = req.url ?? "";
    const pathname = requestUrl.split("?")[0] ?? "";
    const headerPaths = [
      req.headers["x-original-url"],
      req.headers["x-rewrite-url"],
      req.headers["x-matched-path"],
      req.headers["x-forwarded-uri"],
    ]
      .flatMap(value => (Array.isArray(value) ? value : [value]))
      .filter((value): value is string => typeof value === "string")
      .map(value => value.split("?")[0]);
    const pathCandidates = [pathname, ...headerPaths];
    const isDiagProviders = pathCandidates.includes("/api/diag/providers");

    if (isDiagProviders) {
      const routingMap = {
        free: {
          image: ["forge", "nano-banana-pro", "kling_image"],
          video: ["kling_beijing", "fal_kling_video", "veo_3_1", "cometapi"],
          text: ["basic_model", "gemini_3_flash", "gemini_3_pro", "gpt_5_1"],
        },
        beta: {
          image: ["forge", "nano-banana-pro", "kling_image"],
          video: ["kling_beijing", "fal_kling_video", "veo_3_1", "cometapi"],
          text: ["gemini_3_flash", "basic_model", "gemini_3_pro", "gpt_5_1"],
        },
        paid: {
          image: ["nano-banana-pro", "forge", "kling_image"],
          video: ["veo_3_1", "fal_kling_video", "kling_beijing", "cometapi"],
          text: ["gemini_3_pro", "gpt_5_1", "gemini_3_flash", "basic_model"],
        },
        supervisor: {
          image: ["nano-banana-pro", "forge", "kling_image"],
          video: ["veo_3_1", "kling_beijing", "fal_kling_video", "cometapi"],
          text: ["gemini_3_pro", "gpt_5_1", "gemini_3_flash", "basic_model"],
        },
      };

      return res.status(200).json({
        status: "ok",
        timestamp: new Date().toISOString(),
        providers: [],
        routing: routingMap,
        routingMap,
        supervisorAllowlist: ["g***6@gmail.com", "b***6@163.com"],
        effectiveTier: "unknown",
      });
    }

    res.setHeader("Content-Security-Policy", "default-src 'self'");
    return res.status(200).send("ok");
  } catch (error) {
    console.error(error);
    return res.status(500).send("Internal Server Error");
  }
}

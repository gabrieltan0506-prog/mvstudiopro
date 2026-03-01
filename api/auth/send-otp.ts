import type { VercelRequest, VercelResponse } from "@vercel/node";

type RequestBody = {
  email?: unknown;
};

function parseBody(req: VercelRequest): RequestBody {
  if (req.body && typeof req.body === "object") {
    return req.body as RequestBody;
  }

  if (typeof req.body === "string" && req.body.trim()) {
    try {
      return JSON.parse(req.body) as RequestBody;
    } catch {
      return {};
    }
  }

  return {};
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "仅支持 POST" });
  }

  try {
    const { email } = parseBody(req);

    if (typeof email !== "string" || !email.trim()) {
      return res.status(400).json({ ok: false, error: "缺少邮箱" });
    }

    return res.status(200).json({ ok: true });
  } catch {
    return res.status(500).json({ ok: false, error: "服务器错误" });
  }
}

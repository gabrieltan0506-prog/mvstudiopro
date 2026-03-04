import type { VercelRequest, VercelResponse } from "@vercel/node";
import { aimusicFetch } from "./_core/aimusicapi.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const op = req.query.op;

    if (op === "credits") {
      const r = await aimusicFetch("/api/v1/get-credits");
      return res.status(200).json(r);
    }

    if (op === "sunoCreate") {
      const r = await aimusicFetch("/api/v1/sonic/create", req.body);
      return res.status(200).json(r);
    }

    if (op === "sunoTask") {
      const id = req.query.taskId;
      const r = await aimusicFetch(`/api/v1/sonic/task/${id}`);
      return res.status(200).json(r);
    }

    return res.status(400).json({error:"invalid op"});
  } catch(e:any) {
    return res.status(500).json({error:e.message});
  }
}
